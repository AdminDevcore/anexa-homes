import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "../extension";
import { runInVertical, CrossVerticalAccessError } from "../context";
import { TEST_DATABASE_URL } from "./global-setup";

/**
 * Unique operations (findUnique, update, delete, upsert) against scoped models,
 * inside a workspace.
 *
 * WHY THIS FILE EXISTS. Prisma requires a unique field (`id`) at the TOP level
 * of a `WhereUniqueInput`. The SCOPED_OPTIONAL filter used to rewrite every
 * where as `{ AND: [base, { OR: [...] }] }`, burying `id` one level down, so in
 * production — flag on — `prisma.task.update({ where: { id } })` and
 * `prisma.task.delete({ where: { id } })` threw a validation error before
 * reaching the database. Ticking a task done and deleting one both broke, and
 * the task_assigned notification's `task.findUnique` failed silently inside
 * fireEvent's catch.
 *
 * Every case runs through the extended client inside runInVertical("roofing"),
 * which is exactly the shape a portal server action has.
 *
 * It also pins a second SCOPED_OPTIONAL rule: an edit never re-stamps a
 * company-level task (vertical NULL) into the workspace the editor has open,
 * which would silently remove it from every other workspace.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

const roofing = <T>(fn: () => Promise<T>) => runInVertical("roofing", fn);

let companyId = "";
let roofTask = "";
let solarTask = "";
let companyTask = "";

beforeAll(async () => {
  const c = await raw.company.create({
    data: { name: "Unique Ops Co", slug: `uniq-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
});

beforeEach(async () => {
  await raw.task.deleteMany({ where: { companyId } });
  await raw.lead.deleteMany({ where: { companyId } });
  const mk = async (title: string, vertical: "roofing" | "solar" | null) =>
    (await raw.task.create({ data: { companyId, title, vertical } })).id;
  roofTask = await mk("Roof task", "roofing");
  solarTask = await mk("Solar task", "solar");
  companyTask = await mk("Company task", null);
});

afterAll(async () => {
  await raw.company.deleteMany({ where: { id: companyId } });
  await raw.$disconnect();
});

describe("SCOPED_OPTIONAL: unique ops by id work inside a workspace", () => {
  it("findUnique reaches this workspace's task and the company task, not the other workspace's", async () => {
    const [roof, company, solar] = await roofing(async () => [
      await db.task.findUnique({ where: { id: roofTask } }),
      await db.task.findUnique({ where: { id: companyTask } }),
      await db.task.findUnique({ where: { id: solarTask } }),
    ]);
    expect(roof?.id).toBe(roofTask);
    expect(company?.id).toBe(companyTask);
    expect(solar).toBeNull();
  });

  it("findUniqueOrThrow refuses the other workspace's task as not found", async () => {
    await expect(
      roofing(() => db.task.findUniqueOrThrow({ where: { id: solarTask } }))
    ).rejects.toMatchObject({ code: "P2025" });
    const company = await roofing(() => db.task.findUniqueOrThrow({ where: { id: companyTask } }));
    expect(company.id).toBe(companyTask);
  });

  it("update by id succeeds for a workspace task and a company task", async () => {
    const [roof, company] = await roofing(async () => [
      await db.task.update({ where: { id: roofTask }, data: { status: "done" } }),
      await db.task.update({ where: { id: companyTask }, data: { status: "done" } }),
    ]);
    expect(roof.status).toBe("done");
    expect(company.status).toBe("done");
  });

  it("update by id refuses the other workspace's task (P2025) and leaves it untouched", async () => {
    await expect(
      roofing(() => db.task.update({ where: { id: solarTask }, data: { status: "done" } }))
    ).rejects.toMatchObject({ code: "P2025" });
    const after = await raw.task.findUniqueOrThrow({ where: { id: solarTask } });
    expect(after.status).toBe("todo");
    expect(after.vertical).toBe("solar");
  });

  it("delete by id succeeds for a workspace task and a company task", async () => {
    await roofing(async () => {
      await db.task.delete({ where: { id: roofTask } });
      await db.task.delete({ where: { id: companyTask } });
    });
    const left = await raw.task.findMany({ where: { companyId }, select: { id: true } });
    expect(left.map((t) => t.id)).toEqual([solarTask]);
  });

  it("delete by id refuses the other workspace's task (P2025) and it survives", async () => {
    await expect(
      roofing(() => db.task.delete({ where: { id: solarTask } }))
    ).rejects.toMatchObject({ code: "P2025" });
    expect(await raw.task.count({ where: { id: solarTask } })).toBe(1);
  });

  it("upsert by id takes the update branch for a reachable task", async () => {
    const up = await roofing(() =>
      db.task.upsert({
        where: { id: companyTask },
        create: { companyId, title: "Should not be created" },
        update: { title: "Company task (renamed)" },
      })
    );
    expect(up.id).toBe(companyTask);
    expect(up.title).toBe("Company task (renamed)");
    expect(await raw.task.count({ where: { companyId } })).toBe(3);
  });
});

describe("SCOPED_OPTIONAL: the caller's own filters still narrow", () => {
  it("a caller OR next to a unique id narrows the match rather than widening it", async () => {
    const [miss, hit, solar] = await roofing(async () => [
      await db.task.findUnique({ where: { id: roofTask, OR: [{ title: "nope" }, { title: "nor this" }] } }),
      await db.task.findUnique({ where: { id: roofTask, OR: [{ title: "nope" }, { title: "Roof task" }] } }),
      // The OR matches the solar row, but the workspace filter must still apply.
      await db.task.findUnique({ where: { id: solarTask, OR: [{ title: "Solar task" }] } }),
    ]);
    expect(miss).toBeNull();
    expect(hit?.id).toBe(roofTask);
    expect(solar).toBeNull();
  });

  it("a caller OR on an update by id is honoured (P2025 when it does not match)", async () => {
    await expect(
      roofing(() =>
        db.task.update({ where: { id: roofTask, OR: [{ title: "nope" }] }, data: { status: "done" } })
      )
    ).rejects.toMatchObject({ code: "P2025" });
    expect((await raw.task.findUniqueOrThrow({ where: { id: roofTask } })).status).toBe("todo");
  });

  it("a caller OR on findMany still narrows (the Tasks page shape)", async () => {
    const found = await roofing(() =>
      db.task.findMany({ where: { companyId, OR: [{ title: "Company task" }, { title: "Solar task" }] } })
    );
    expect(found.map((t) => t.title)).toEqual(["Company task"]);
  });

  it("a caller AND, in object or array form, is kept alongside the workspace filter", async () => {
    const [asArray, asObject] = await roofing(async () => [
      await db.task.findFirst({ where: { AND: [{ id: solarTask }, { companyId }] } }),
      await db.task.findUnique({ where: { id: roofTask, AND: { title: "nope" } } }),
    ]);
    expect(asArray).toBeNull();
    expect(asObject).toBeNull();

    const both = await roofing(() =>
      db.task.findMany({ where: { AND: [{ companyId }, { title: { endsWith: "task" } }] }, orderBy: { title: "asc" } })
    );
    expect(both.map((t) => t.title)).toEqual(["Company task", "Roof task"]);
  });

  it("an explicit vertical next to a unique id is still honoured, and a foreign one still throws", async () => {
    const [companyOnly, roofAsCompany] = await roofing(async () => [
      await db.task.findUnique({ where: { id: companyTask, vertical: null } }),
      await db.task.findUnique({ where: { id: roofTask, vertical: null } }),
    ]);
    expect(companyOnly?.id).toBe(companyTask);
    expect(roofAsCompany).toBeNull();

    await expect(
      roofing(() => db.task.findUnique({ where: { id: solarTask, vertical: "solar" } }))
    ).rejects.toBeInstanceOf(CrossVerticalAccessError);
  });
});

describe("SCOPED_OPTIONAL: an edit keeps a company task company-level", () => {
  it("update from a workspace does not re-stamp a company task into it", async () => {
    const edited = await roofing(() =>
      db.task.update({ where: { id: companyTask }, data: { status: "done" } })
    );
    expect(edited.vertical).toBeNull();

    // …so it is still on the OTHER workspace's list.
    const fromSolar = await runInVertical("solar", () =>
      db.task.findMany({ where: { companyId }, select: { id: true } })
    );
    expect(fromSolar.map((t) => t.id).sort()).toEqual([solarTask, companyTask].sort());
  });

  it("updateMany and upsert's update branch leave company tasks company-level too", async () => {
    await roofing(() => db.task.updateMany({ where: { companyId }, data: { priority: "high" } }));
    await roofing(() =>
      db.task.upsert({
        where: { id: companyTask },
        create: { companyId, title: "unused" },
        update: { description: "touched" },
      })
    );
    const rows = await raw.task.findMany({ where: { companyId }, orderBy: { title: "asc" } });
    expect(rows.map((t) => [t.title, t.vertical, t.priority])).toEqual([
      ["Company task", null, "high"],
      ["Roof task", "roofing", "high"],
      ["Solar task", "solar", "medium"], // outside the workspace: untouched
    ]);
  });

  it("a deliberate move is still possible, and a move into a foreign workspace still throws", async () => {
    const moved = await roofing(() =>
      db.task.update({ where: { id: companyTask }, data: { vertical: "roofing" } })
    );
    expect(moved.vertical).toBe("roofing");

    const toCompany = await roofing(() =>
      db.task.update({ where: { id: roofTask }, data: { vertical: null } })
    );
    expect(toCompany.vertical).toBeNull();

    await expect(
      roofing(() => db.task.update({ where: { id: companyTask }, data: { vertical: "solar" } }))
    ).rejects.toBeInstanceOf(CrossVerticalAccessError);
  });

  it("create still stamps the active workspace when the caller says nothing", async () => {
    const created = await roofing(() => db.task.create({ data: { companyId, title: "Ambient" } }));
    expect(created.vertical).toBe("roofing");
    const upserted = await roofing(() =>
      db.task.upsert({
        where: { id: "00000000-0000-0000-0000-000000000000" },
        create: { companyId, title: "Upsert-created" },
        update: {},
      })
    );
    expect(upserted.vertical).toBe("roofing");
  });
});

describe("SCOPED: unique ops by id keep working with the top-level vertical", () => {
  // stampWhere spreads `vertical` next to the caller's keys. Prisma 5+ accepts
  // non-unique filters alongside a unique one in a WhereUniqueInput, so this has
  // never had the SCOPED_OPTIONAL problem — pinned here so it cannot regress.
  async function leads() {
    const roof = await raw.lead.create({
      data: { companyId, firstName: "Roof", lastName: "Lead", vertical: "roofing" },
    });
    const solar = await raw.lead.create({
      data: { companyId, firstName: "Sun", lastName: "Lead", vertical: "solar" },
    });
    return { roof: roof.id, solar: solar.id };
  }

  it("findUnique / update / delete by id work in-workspace and refuse across it", async () => {
    const { roof, solar } = await leads();

    const found = await roofing(() => db.lead.findUnique({ where: { id: roof } }));
    expect(found?.id).toBe(roof);
    expect(await roofing(() => db.lead.findUnique({ where: { id: solar } }))).toBeNull();

    const updated = await roofing(() => db.lead.update({ where: { id: roof }, data: { city: "Tulsa" } }));
    expect(updated.city).toBe("Tulsa");
    await expect(
      roofing(() => db.lead.update({ where: { id: solar }, data: { city: "Nope" } }))
    ).rejects.toMatchObject({ code: "P2025" });

    await expect(roofing(() => db.lead.delete({ where: { id: solar } }))).rejects.toMatchObject({
      code: "P2025",
    });
    await roofing(() => db.lead.delete({ where: { id: roof } }));
    const left = await raw.lead.findMany({ where: { companyId }, select: { id: true, city: true } });
    expect(left).toEqual([{ id: solar, city: null }]);
  });
});
