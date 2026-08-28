import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { checklistJustCompleted } from "../checklist";

/**
 * "Just" completed — the transition, not the state.
 *
 * The two tests that matter are the last two: a crew re-shooting a slot on a
 * finished checklist must not recompile the report and move the job again.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let templateId: string;
let required1: string;
let required2: string;
let optional: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Checklist Co", slug: `cl-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const t = await db.photoTemplate.create({
    data: { companyId, vertical: "solar", name: "Install", kind: "install" },
  });
  templateId = t.id;
  required1 = (
    await db.photoTemplateItem.create({
      data: { templateId, label: "Array", required: true, position: 0 },
    })
  ).id;
  required2 = (
    await db.photoTemplateItem.create({
      data: { templateId, label: "Inverter", required: true, position: 1 },
    })
  ).id;
  optional = (
    await db.photoTemplateItem.create({
      data: { templateId, label: "Extra", required: false, position: 2 },
    })
  ).id;
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.photoTemplateItem.deleteMany({ where: { templateId } });
  await db.photoTemplate.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  leadId = (
    await db.lead.create({
      data: { companyId, vertical: "solar", firstName: "C", lastName: "L" },
    })
  ).id;
});

async function shoot(itemId: string) {
  await db.fileAsset.create({
    data: {
      companyId,
      leadId,
      kind: "photo",
      name: `${itemId}.jpg`,
      storageKey: `k/${itemId}/${Math.random()}`,
      mimeType: "image/jpeg",
      size: 10,
      photoTemplateItemId: itemId,
      category: "install_photos",
    },
  });
}

const check = (itemId: string) =>
  runInVertical("solar", () => checklistJustCompleted(companyId, leadId, itemId));

describe("checklistJustCompleted", () => {
  it("is false while a required slot is still empty", async () => {
    await shoot(required1);
    expect(await check(required1)).toBe(null);
  });

  it("returns the kind on the upload that completes it", async () => {
    await shoot(required1);
    await shoot(required2);
    expect(await check(required2)).toBe("install");
  });

  it("ignores optional slots", async () => {
    await shoot(required1);
    await shoot(required2);
    expect(await check(required2)).toBe("install");
    // Still complete, but this upload did not complete it.
    await shoot(optional);
    expect(await check(optional)).toBe(null);
  });

  it("does not re-fire on a second shot into an already-full slot", async () => {
    await shoot(required1);
    await shoot(required2);
    expect(await check(required2)).toBe("install");
    await shoot(required2);
    expect(await check(required2)).toBe(null);
  });
});
