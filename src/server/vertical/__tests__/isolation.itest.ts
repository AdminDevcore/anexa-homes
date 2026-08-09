import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "../extension";
import {
  runInVertical,
  runUnscoped,
  CrossVerticalAccessError,
  MissingVerticalContextError,
} from "../context";
import { TEST_DATABASE_URL } from "./global-setup";

/**
 * Proves the isolation guarantee against a real database.
 *
 * The claim under test is not "queries usually get filtered" — it is that a
 * vertical-scoped model CANNOT be read or written across workspaces through the
 * model API, including the two paths where a naive extension silently fails:
 *
 *   • inside $transaction(), both the array and interactive forms
 *   • nested writes, where a child row is created through its parent
 *
 * The flag is forced on for this file; the flag-off path is asserted at the end.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;

async function resetFixtures() {
  // The unextended client is used for setup/teardown so fixtures can span
  // verticals — this is the one place that is allowed to.
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Isolation Test Co", slug: `iso-${Date.now()}` },
  });
  companyId = company.id;

  await raw.lead.createMany({
    data: [
      { companyId, firstName: "Roof", lastName: "One", vertical: "roofing" },
      { companyId, firstName: "Roof", lastName: "Two", vertical: "roofing" },
      { companyId, firstName: "Sun", lastName: "One", vertical: "solar" },
    ],
  });
}

beforeAll(resetFixtures);
beforeEach(resetFixtures);
afterAll(async () => {
  await raw.$disconnect();
});

describe("reads are filtered to the active vertical", () => {
  it("roofing sees only roofing deals", async () => {
    const leads = await runInVertical("roofing", () => db.lead.findMany({ where: { companyId } }));
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.vertical === "roofing")).toBe(true);
  });

  it("solar sees only solar deals", async () => {
    const leads = await runInVertical("solar", () => db.lead.findMany({ where: { companyId } }));
    expect(leads).toHaveLength(1);
    expect(leads[0].lastName).toBe("One");
    expect(leads[0].vertical).toBe("solar");
  });

  it("count/aggregate are filtered too, not just findMany", async () => {
    const roofing = await runInVertical("roofing", () => db.lead.count({ where: { companyId } }));
    const solar = await runInVertical("solar", () => db.lead.count({ where: { companyId } }));
    expect([roofing, solar]).toEqual([2, 1]);
  });

  it("findUnique by id cannot reach across verticals", async () => {
    const solarLead = await raw.lead.findFirstOrThrow({ where: { vertical: "solar" } });
    const asSolar = await runInVertical("solar", () =>
      db.lead.findUnique({ where: { id: solarLead.id } })
    );
    const asRoofing = await runInVertical("roofing", () =>
      db.lead.findUnique({ where: { id: solarLead.id } })
    );
    expect(asSolar?.id).toBe(solarLead.id);
    expect(asRoofing).toBeNull(); // the id is known, the row is still unreachable
  });

  it("updateMany cannot mutate the other vertical's rows", async () => {
    await runInVertical("solar", () =>
      db.lead.updateMany({ where: { companyId }, data: { city: "Solarville" } })
    );
    const roofingCities = await raw.lead.findMany({
      where: { companyId, vertical: "roofing" },
      select: { city: true },
    });
    expect(roofingCities.every((l) => l.city === null)).toBe(true);
  });
});

describe("writes are stamped with the active vertical", () => {
  it("create stamps without the call site saying so", async () => {
    const lead = await runInVertical("solar", () =>
      db.lead.create({ data: { companyId, firstName: "New", lastName: "Solar" } })
    );
    expect(lead.vertical).toBe("solar");
  });

  it("createMany stamps every row", async () => {
    await runInVertical("solar", () =>
      db.lead.createMany({
        data: [
          { companyId, firstName: "A", lastName: "A" },
          { companyId, firstName: "B", lastName: "B" },
        ],
      })
    );
    const solar = await raw.lead.count({ where: { companyId, vertical: "solar" } });
    expect(solar).toBe(3); // 1 fixture + 2 new
  });
});

describe("cross-vertical access is a hard error", () => {
  it("rejects an explicit mismatched filter", async () => {
    await expect(
      runInVertical("roofing", () => db.lead.findMany({ where: { companyId, vertical: "solar" } }))
    ).rejects.toThrow(CrossVerticalAccessError);
  });

  it("rejects an explicit mismatched write", async () => {
    await expect(
      runInVertical("roofing", () =>
        db.lead.create({
          data: { companyId, firstName: "Sneaky", lastName: "Write", vertical: "solar" },
        })
      )
    ).rejects.toThrow(CrossVerticalAccessError);
  });

  it("refuses to touch a scoped model with no resolvable vertical", async () => {
    await expect(db.lead.findMany({ where: { companyId } })).rejects.toThrow(
      MissingVerticalContextError
    );
  });
});

// ── Condition 3a: $transaction ─────────────────────────────────────────────
describe("enforcement holds inside $transaction()", () => {
  it("interactive form: reads are filtered and writes are stamped", async () => {
    const { seen, created } = await runInVertical("solar", () =>
      db.$transaction(async (tx) => {
        const seen = await tx.lead.findMany({ where: { companyId } });
        const created = await tx.lead.create({
          data: { companyId, firstName: "Tx", lastName: "Solar" },
        });
        return { seen, created };
      })
    );
    expect(seen).toHaveLength(1); // only the solar fixture, inside the tx
    expect(seen[0].vertical).toBe("solar");
    expect(created.vertical).toBe("solar");
  });

  it("interactive form: cross-vertical access still throws (and rolls the tx back)", async () => {
    await expect(
      runInVertical("roofing", () =>
        db.$transaction(async (tx) => {
          await tx.lead.create({ data: { companyId, firstName: "Should", lastName: "Rollback" } });
          // This must abort the whole transaction.
          return tx.lead.findMany({ where: { companyId, vertical: "solar" } });
        })
      )
    ).rejects.toThrow(CrossVerticalAccessError);

    const rolledBack = await raw.lead.findFirst({ where: { companyId, lastName: "Rollback" } });
    expect(rolledBack).toBeNull();
  });

  it("array form: every operation in the batch is scoped", async () => {
    await runInVertical("solar", () =>
      db.$transaction([
        db.lead.create({ data: { companyId, firstName: "Batch", lastName: "A" } }),
        db.lead.create({ data: { companyId, firstName: "Batch", lastName: "B" } }),
      ])
    );
    const stamped = await raw.lead.findMany({
      where: { companyId, firstName: "Batch" },
      select: { vertical: true },
    });
    expect(stamped).toHaveLength(2);
    expect(stamped.every((l) => l.vertical === "solar")).toBe(true);
  });
});

// ── Condition 3b: nested writes ────────────────────────────────────────────
describe("enforcement holds for nested writes", () => {
  it("a child created through its parent inherits the parent's vertical", async () => {
    const lead = await runInVertical("solar", () =>
      db.lead.create({
        data: {
          companyId,
          firstName: "Nested",
          lastName: "Parent",
          // Project is itself a vertical-scoped model, created here only as a
          // nested write — the call site never mentions `vertical`.
          project: { create: { companyId, projectNumber: `P-${Date.now()}` } },
        },
        include: { project: true },
      })
    );
    expect(lead.vertical).toBe("solar");
    expect(lead.project?.vertical).toBe("solar");
  });

  it("a nested create cannot smuggle in a different vertical", async () => {
    await expect(
      runInVertical("solar", () =>
        db.lead.create({
          data: {
            companyId,
            firstName: "Smuggle",
            lastName: "Attempt",
            project: {
              create: { companyId, projectNumber: `P-${Date.now()}`, vertical: "roofing" },
            },
          },
        })
      )
    ).rejects.toThrow(CrossVerticalAccessError);
  });

  it("nested createMany stamps each child", async () => {
    const lead = await runInVertical("solar", () =>
      db.lead.create({
        data: {
          companyId,
          firstName: "Nested",
          lastName: "Many",
          tasks: {
            createMany: {
              data: [
                { companyId, title: "Site survey" },
                { companyId, title: "Design review" },
              ],
            },
          },
        },
        include: { tasks: true },
      })
    );
    expect(lead.tasks).toHaveLength(2);
    expect(lead.tasks.every((t) => t.vertical === "solar")).toBe(true);
  });
});

// ── Shared-but-segmented ───────────────────────────────────────────────────
describe("tagged models keep the books consolidated", () => {
  it("stamps on write but does NOT filter on read", async () => {
    const roofLead = await raw.lead.findFirstOrThrow({ where: { vertical: "roofing" } });
    const solarLead = await raw.lead.findFirstOrThrow({ where: { vertical: "solar" } });
    const mk = async (leadId: string, num: string) =>
      raw.project.create({
        data: { companyId, leadId, projectNumber: num, vertical: leadId === roofLead.id ? "roofing" : "solar" },
      });
    const roofProject = await mk(roofLead.id, `R-${Date.now()}`);
    const solarProject = await mk(solarLead.id, `S-${Date.now()}`);

    await runInVertical("roofing", () =>
      db.transaction.create({
        data: { companyId, projectId: roofProject.id, amountCents: 1000, description: "Shingles", date: new Date() },
      })
    );
    await runInVertical("solar", () =>
      db.transaction.create({
        data: { companyId, projectId: solarProject.id, amountCents: 2000, description: "Modules", date: new Date() },
      })
    );

    // Tagged for reporting…
    const tags = await raw.transaction.findMany({
      where: { companyId },
      select: { vertical: true, amountCents: true },
      orderBy: { amountCents: "asc" },
    });
    expect(tags).toEqual([
      { vertical: "roofing", amountCents: 1000 },
      { vertical: "solar", amountCents: 2000 },
    ]);

    // …but the ledger is NOT filtered: one company, one set of books.
    const fromRoofing = await runInVertical("roofing", () =>
      db.transaction.findMany({ where: { companyId } })
    );
    expect(fromRoofing).toHaveLength(2);
  });
});

// ── Tagged-model provenance ────────────────────────────────────────────────
describe("a tagged row's department comes from the job, not the toggle", () => {
  async function makeJobs() {
    const roofLead = await raw.lead.findFirstOrThrow({ where: { vertical: "roofing" } });
    const solarLead = await raw.lead.findFirstOrThrow({ where: { vertical: "solar" } });
    const roofJob = await raw.project.create({
      data: { companyId, leadId: roofLead.id, projectNumber: `R-${Date.now()}`, vertical: "roofing" },
    });
    const solarJob = await raw.project.create({
      data: { companyId, leadId: solarLead.id, projectNumber: `S-${Date.now()}`, vertical: "solar" },
    });
    return { roofJob, solarJob };
  }

  it("derives from the linked job even when the WRONG workspace is toggled", async () => {
    const { solarJob } = await makeJobs();
    // The bookkeeper has Roofing open, but is filing a cost against a SOLAR job.
    const txn = await runInVertical("roofing", () =>
      db.transaction.create({
        data: {
          companyId,
          projectId: solarJob.id,
          amountCents: -500_00,
          description: "Inverter",
          date: new Date(),
        },
      })
    );
    // Ambient said roofing; the job says solar. The job wins.
    expect(txn.vertical).toBe("solar");
  });

  it("derives commissions, invoices and job costs the same way", async () => {
    const { solarJob } = await makeJobs();
    const user = await raw.user.create({
      data: { companyId, email: `t${Date.now()}@x.test`, firstName: "T", lastName: "U" },
    });

    const [commission, invoice, cost] = await runInVertical("roofing", async () => [
      await db.commission.create({
        data: { companyId, projectId: solarJob.id, userId: user.id, amount: 100_00 },
      }),
      await db.invoice.create({
        data: { companyId, projectId: solarJob.id, invoiceNumber: `INV-${Date.now()}`, amount: 100_00 },
      }),
      await db.projectCost.create({
        data: { companyId, projectId: solarJob.id, label: "Racking", amount: 100_00 },
      }),
    ]);

    expect([commission.vertical, invoice.vertical, cost.vertical]).toEqual([
      "solar",
      "solar",
      "solar",
    ]);
  });

  it("falls back to the active workspace only when there is no linked job", async () => {
    const rent = await runInVertical("roofing", () =>
      db.transaction.create({
        data: { companyId, amountCents: -200_00, description: "Office rent", date: new Date() },
      })
    );
    expect(rent.vertical).toBe("roofing");
  });

  it("an unrelated edit does NOT re-tag the row from the ambient workspace", async () => {
    const { solarJob } = await makeJobs();
    const txn = await runInVertical("solar", () =>
      db.transaction.create({
        data: {
          companyId,
          projectId: solarJob.id,
          amountCents: -100_00,
          description: "Modules",
          date: new Date(),
        },
      })
    );
    expect(txn.vertical).toBe("solar");

    // Someone with Roofing open fixes a typo in the description.
    const edited = await runInVertical("roofing", () =>
      db.transaction.update({ where: { id: txn.id }, data: { description: "Solar modules" } })
    );
    // The department must survive the edit untouched.
    expect(edited.vertical).toBe("solar");
  });

  it("re-derives when the row is moved to a different job", async () => {
    const { roofJob, solarJob } = await makeJobs();
    const txn = await runInVertical("solar", () =>
      db.transaction.create({
        data: {
          companyId,
          projectId: solarJob.id,
          amountCents: -100_00,
          description: "Misfiled",
          date: new Date(),
        },
      })
    );
    const moved = await runInVertical("solar", () =>
      db.transaction.update({ where: { id: txn.id }, data: { projectId: roofJob.id } })
    );
    expect(moved.vertical).toBe("roofing");
  });

  it("an explicit tag still wins (seeds, imports, backfills)", async () => {
    const { solarJob } = await makeJobs();
    const txn = await runInVertical("roofing", () =>
      db.transaction.create({
        data: {
          companyId,
          projectId: solarJob.id,
          amountCents: -100_00,
          description: "Explicit",
          date: new Date(),
          vertical: "roofing",
        },
      })
    );
    expect(txn.vertical).toBe("roofing");
  });
});

// ── Crossover: the one place we cross the boundary on purpose ─────────────
describe("solar → roofing crossover", () => {
  it("creates the linked deal in the TARGET vertical, not the acting one", async () => {
    const solarLead = await raw.lead.findFirstOrThrow({ where: { vertical: "solar" } });

    // Acting in solar, spawn the roofing job (what createCrossoverDealAction
    // does internally: read here, write inside runInVertical("roofing")).
    const roofingDeal = await runInVertical("solar", async () => {
      const source = await db.lead.findUniqueOrThrow({ where: { id: solarLead.id } });
      return runInVertical("roofing", () =>
        db.lead.create({
          data: {
            companyId,
            firstName: source.firstName,
            lastName: source.lastName,
            address: source.address,
            linkedDealId: source.id,
          },
        })
      );
    });

    expect(roofingDeal.vertical).toBe("roofing");
    expect(roofingDeal.linkedDealId).toBe(solarLead.id);

    // And it is genuinely in the other workspace: invisible from solar…
    const fromSolar = await runInVertical("solar", () =>
      db.lead.findUnique({ where: { id: roofingDeal.id } })
    );
    expect(fromSolar).toBeNull();
    // …but visible from roofing.
    const fromRoofing = await runInVertical("roofing", () =>
      db.lead.findUnique({ where: { id: roofingDeal.id } })
    );
    expect(fromRoofing?.id).toBe(roofingDeal.id);
  });

  it("the linked-deal summary read is the ONLY way across, and is narrow", async () => {
    const solarLead = await raw.lead.findFirstOrThrow({ where: { vertical: "solar" } });
    const roofingDeal = await runInVertical("roofing", () =>
      db.lead.create({ data: { companyId, firstName: "Cross", lastName: "Sell" } })
    );
    await raw.lead.update({ where: { id: solarLead.id }, data: { linkedDealId: roofingDeal.id } });

    // A plain scoped read from solar cannot see it…
    await expect(
      runInVertical("solar", () => db.lead.findUniqueOrThrow({ where: { id: roofingDeal.id } }))
    ).rejects.toThrow();

    // …the deliberate, audited unscoped read can — identity and stage only.
    const summary = await runUnscoped("crossover display", () =>
      db.lead.findFirst({
        where: { id: roofingDeal.id, companyId },
        select: { id: true, vertical: true, firstName: true, lastName: true, status: true },
      })
    );
    expect(summary).toMatchObject({ id: roofingDeal.id, vertical: "roofing" });
    // The select carries no money and no documents by construction.
    expect(summary).not.toHaveProperty("claimPrice");
    expect(summary).not.toHaveProperty("value");
  });
});

describe("escape hatches", () => {
  it("runUnscoped reads across verticals", async () => {
    const all = await runUnscoped("test: company-wide rollup", () =>
      db.lead.findMany({ where: { companyId } })
    );
    expect(all).toHaveLength(3);
  });
});

// ── Condition 4: the flag-off guarantee, at the query layer ────────────────
describe("with the flag off the extension is inert", () => {
  it("does not filter, does not stamp, and needs no context", async () => {
    process.env.SOLAR_VERTICAL_ENABLED = "0";
    try {
      // No runInVertical() at all — would throw if the extension were active.
      const all = await db.lead.findMany({ where: { companyId } });
      expect(all).toHaveLength(3);

      const created = await db.lead.create({
        data: { companyId, firstName: "Flag", lastName: "Off" },
      });
      expect(created.vertical).toBe("roofing"); // the column default, not the extension

      // Even an explicit cross-vertical filter is passed straight through.
      const solar = await db.lead.findMany({ where: { companyId, vertical: "solar" } });
      expect(solar).toHaveLength(1);
    } finally {
      process.env.SOLAR_VERTICAL_ENABLED = "1";
    }
  });
});

// ── SCOPED_OPTIONAL: workspace rows isolate, company rows are visible to all ──
//
// Task is the first model in this class. The guarantee has two halves and both
// have a plausible failure mode:
//
//   • a workspace task must NOT leak — the normal isolation claim
//   • a company task (vertical NULL) must appear in EVERY workspace — which the
//     plain SCOPED filter would silently delete, because `WHERE vertical = 'x'`
//     is never true for NULL. That failure is invisible: the list still renders,
//     it is just quietly missing rows.
describe("SCOPED_OPTIONAL keeps company-level rows visible everywhere", () => {
  async function seedTasks() {
    await raw.task.createMany({
      data: [
        { companyId, title: "Roof task", vertical: "roofing" },
        { companyId, title: "Solar task", vertical: "solar" },
        { companyId, title: "Company task", vertical: null },
      ],
    });
  }

  it("shows this workspace's tasks plus the company ones, in both workspaces", async () => {
    await seedTasks();

    const roofing = await runInVertical("roofing", () => db.task.findMany({ where: { companyId } }));
    expect(roofing.map((t) => t.title).sort()).toEqual(["Company task", "Roof task"]);

    const solar = await runInVertical("solar", () => db.task.findMany({ where: { companyId } }));
    expect(solar.map((t) => t.title).sort()).toEqual(["Company task", "Solar task"]);
  });

  it("does not let a caller's own OR clause be clobbered by the filter", async () => {
    await seedTasks();
    // The Tasks page passes an RBAC scope shaped like this. A filter spread in
    // as a sibling `OR` would overwrite it and WIDEN the query instead of
    // narrowing it — the bug stampWhereOptional's AND-wrapping exists to prevent.
    const found = await runInVertical("roofing", () =>
      db.task.findMany({
        where: { companyId, OR: [{ title: "Company task" }, { title: "Solar task" }] },
      })
    );
    expect(found.map((t) => t.title)).toEqual(["Company task"]);
  });

  it("stamps the active workspace when the caller says nothing", async () => {
    const created = await runInVertical("solar", () =>
      db.task.create({ data: { companyId, title: "Ambient" } })
    );
    expect(created.vertical).toBe("solar");
  });

  it("honours an explicit null so a Company task can actually be created", async () => {
    const created = await runInVertical("solar", () =>
      db.task.create({ data: { companyId, title: "All hands", vertical: null } })
    );
    expect(created.vertical).toBeNull();

    // …and it is then readable from the OTHER workspace.
    const fromRoofing = await runInVertical("roofing", () =>
      db.task.findMany({ where: { companyId, title: "All hands" } })
    );
    expect(fromRoofing).toHaveLength(1);
  });

  it("still refuses a write aimed at someone else's workspace", async () => {
    await expect(
      runInVertical("roofing", () =>
        db.task.create({ data: { companyId, title: "Sneaky", vertical: "solar" } })
      )
    ).rejects.toBeInstanceOf(CrossVerticalAccessError);
  });
});
