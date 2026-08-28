import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getObject, putObject } from "@/server/storage";
import {
  COMPANY_CTX_SELECT,
  ctxForLead,
  LEAD_CTX_INCLUDE,
  type LeadForCtx,
} from "@/server/modules/esign/context";
import { generateSignedPdf, type Snapshot, type SnapshotField } from "@/server/modules/esign/pdf";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ templateId: z.string().min(1) });

/**
 * Fill a document template for this deal and file the PDF — no signature, no
 * signing link, nobody asked to click anything.
 *
 * This is `generateTemplatePreviewPdf`'s exact call into `generateSignedPdf`
 * (`signers: []`, `events: []`, `certificate: false`) with a real
 * AutofillContext instead of the sample one.
 *
 * No DocumentPackage row is created, deliberately: a package is an envelope
 * somebody has to sign, and one sitting permanently at `draft` would show up
 * forever under "Sent for Signature" for a document nobody is waiting on.
 */
export const generateDocumentAction: AutomationActionModule = {
  type: "generate_document",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick the document template to generate." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no template.");

    const template = await prisma.documentTemplate.findFirst({
      where: { id: parsed.data.templateId, companyId: ctx.companyId },
      include: { fields: true },
    });
    if (!template) return fail("That document template no longer exists.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      include: LEAD_CTX_INCLUDE,
    });
    if (!lead) return fail("Deal not found.");

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: COMPANY_CTX_SELECT,
    });

    const snapshot: Snapshot = {
      pages: (template.pages as unknown as Snapshot["pages"]) ?? [{ width: 612, height: 792 }],
      body: (template.body as unknown as Snapshot["body"]) ?? [],
      sourcePdfKey: template.sourcePdfKey ?? null,
      fields: template.fields.map((f) => ({
        id: f.id,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        type: f.type as SnapshotField["type"],
        signerRole: f.signerRole,
        label: f.label,
        valueToken: f.valueToken,
        defaultValue: f.defaultValue,
      })),
    };

    let sourcePdf: Buffer | null = null;
    if (template.sourcePdfKey) {
      try {
        sourcePdf = await getObject(template.sourcePdfKey);
      } catch {
        // A template whose uploaded PDF has gone missing would otherwise file a
        // blank generated page under a real document's name. Say so instead.
        return fail("The template's source PDF could not be read.");
      }
    }

    const buffer = await generateSignedPdf({
      title: template.name,
      snapshot,
      ctx: ctxForLead(lead as unknown as LeadForCtx, company ?? { name: "" }),
      values: {},
      sourcePdf,
      signers: [],
      events: [],
      certificate: false,
    });

    const name = `${template.name}.pdf`;
    const key = `companies/${ctx.companyId}/uploads/${nanoid()}-${name.replace(/[^a-z0-9.]+/gi, "-")}`;
    await putObject(key, buffer);

    await prisma.fileAsset.create({
      data: {
        companyId: ctx.companyId,
        kind: "document",
        name,
        storageKey: key,
        mimeType: "application/pdf",
        size: buffer.length,
        // A NULL folderKey means Contract, matching every template that predates
        // routing. See deal-folders.ts.
        category: template.folderKey ?? "contract",
        leadId: ctx.leadId,
        uploadedById: null,
      },
    });

    return { type: "generate_document", ok: true, detail: `Generated ${name}.` };
  },
};

function fail(detail: string): StepResult {
  return { type: "generate_document", ok: false, detail };
}
