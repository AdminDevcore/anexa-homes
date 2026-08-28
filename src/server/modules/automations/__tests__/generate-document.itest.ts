import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { generateDocumentAction } from "../actions/generate-document";
import type { ActionContext } from "../types";

/**
 * Filling a template for a real deal and filing the result.
 *
 * The PDF's bytes are not inspected — that is generateSignedPdf's own job, and
 * it is already exercised by the e-sign suite. What is checked here is
 * everything around it: that a real file lands, in the folder the TEMPLATE
 * names, attributed to nobody.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let templateId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Docgen Co", slug: `dg-${process.pid}-${Date.now()}` },
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
      zip: "75201",
    },
  });
  leadId = lead.id;
  const t = await db.documentTemplate.create({
    data: {
      companyId,
      vertical: "solar",
      name: "Certificate of Acceptance",
      folderKey: "certificate_of_acceptance",
      pages: [{ width: 612, height: 792 }],
      body: [{ page: 1, type: "heading", text: "Certificate of Acceptance", x: 60, y: 700 }],
    },
  });
  templateId = t.id;
  await db.documentTemplateField.create({
    data: { templateId, page: 1, x: 60, y: 640, type: "text", valueToken: "{{customer.fullName}}" },
  });
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.documentTemplateField.deleteMany({ where: { template: { companyId } } });
  await db.documentTemplate.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const run = (config: unknown, over: Partial<ActionContext> = {}) =>
  runInVertical("solar", () =>
    generateDocumentAction.run({ companyId, vertical: "solar", leadId, config, depth: 0, ...over })
  );

describe("generate_document", () => {
  it("files a real PDF into the template's folder", async () => {
    const res = await run({ templateId });
    expect(res.ok).toBe(true);

    const file = await db.fileAsset.findFirst({ where: { companyId, leadId } });
    expect(file?.category).toBe("certificate_of_acceptance");
    expect(file?.mimeType).toBe("application/pdf");
    expect(file?.name).toContain("Certificate of Acceptance");
    // Uploaded by nobody — an automation is not a person.
    expect(file?.uploadedById).toBeNull();
    expect(file!.size).toBeGreaterThan(500);
  });

  it("falls back to the Contract folder when the template names none", async () => {
    const t = await db.documentTemplate.create({
      data: { companyId, vertical: "solar", name: "Unfiled", pages: [{ width: 612, height: 792 }] },
    });
    const res = await run({ templateId: t.id });
    expect(res.ok).toBe(true);
    const file = await db.fileAsset.findFirst({ where: { companyId, name: { contains: "Unfiled" } } });
    expect(file?.category).toBe("contract");
  });

  it("fails when the template has been deleted", async () => {
    const res = await run({ templateId: "00000000-0000-0000-0000-000000000000" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/template/i);
  });

  it("does not offer a follow-up trigger", async () => {
    // Filing a document is not itself a trigger, so it must not re-enter the
    // engine. Only move_stage does.
    const res = await run({ templateId });
    expect(res.follow).toBeUndefined();
  });

  it("rejects a config with no template", () => {
    expect(generateDocumentAction.parseConfig({}).ok).toBe(false);
  });
});
