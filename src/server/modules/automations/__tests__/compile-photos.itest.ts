import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { putObject } from "@/server/storage";
import { compilePhotosAction } from "../actions/compile-photos";
import type { ActionContext } from "../types";

/**
 * Compiling a deal's photos into the branded report and FILING it.
 *
 * The renderer is the one the download route has always used, so what is tested
 * here is the part that is new: where the PDF lands. Roofing and solar spell
 * their two photo folders differently and a report filed under the wrong
 * spelling disappears into "Other".
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Photo Co", slug: `ph-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      firstName: "Nancy",
      lastName: "Moore",
      address: "107 Oak St",
      city: "Dallas",
      state: "TX",
    },
  });
  leadId = lead.id;

  const jpeg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();

  for (const n of [1, 2]) {
    const key = `companies/${companyId}/uploads/test-${n}.jpg`;
    await putObject(key, jpeg);
    await db.fileAsset.create({
      data: {
        companyId,
        leadId,
        kind: "photo",
        name: `Ridge ${n}.jpg`,
        storageKey: key,
        mimeType: "image/jpeg",
        size: jpeg.length,
        category: "install_photos",
      },
    });
  }
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const run = (config: unknown, over: Partial<ActionContext> = {}) =>
  runInVertical(over.vertical === "roofing" ? "roofing" : "solar", () =>
    compilePhotosAction.run({ companyId, vertical: "solar", leadId, config, depth: 0, ...over })
  );

describe("compile_photos", () => {
  it("files one PDF into the same folder the photos are in", async () => {
    const res = await run({ kind: "install" });
    expect(res.ok).toBe(true);

    const pdf = await db.fileAsset.findFirst({
      where: { companyId, leadId, mimeType: "application/pdf" },
    });
    expect(pdf?.category).toBe("install_photos");
    expect(pdf?.uploadedById).toBeNull();
    expect(pdf!.size).toBeGreaterThan(1000);
  });

  it("uses roofing's folder key on a roofing deal", async () => {
    const lead = await db.lead.create({
      data: { companyId, vertical: "roofing", firstName: "R", lastName: "Deal" },
    });
    const jpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 1, b: 1 } },
    })
      .jpeg()
      .toBuffer();
    const key = `companies/${companyId}/uploads/roof.jpg`;
    await putObject(key, jpeg);
    await db.fileAsset.create({
      data: {
        companyId,
        leadId: lead.id,
        kind: "photo",
        name: "Slope.jpg",
        storageKey: key,
        mimeType: "image/jpeg",
        size: jpeg.length,
        category: "install",
      },
    });

    const res = await run({ kind: "install" }, { vertical: "roofing", leadId: lead.id });
    expect(res.ok).toBe(true);
    const pdf = await db.fileAsset.findFirst({
      where: { companyId, leadId: lead.id, mimeType: "application/pdf" },
    });
    expect(pdf?.category).toBe("install");
  });

  it("fails rather than filing an empty report", async () => {
    const res = await run({ kind: "site" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no photos/i);
  });

  it("rejects a config with no checklist kind", () => {
    expect(compilePhotosAction.parseConfig({}).ok).toBe(false);
  });
});
