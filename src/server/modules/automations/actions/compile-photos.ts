import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { renderPhotoReport, type ReportPhoto } from "@/server/modules/photos/report";
import { PHOTO_GROUPS, photoGroupFor } from "@/lib/photo-groups";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ kind: z.enum(["site", "install"]) });

/**
 * Compile a deal's photos into the branded report and FILE it.
 *
 * The renderer is the one the download route has always used. The only new
 * thing here is that the bytes are stored as a FileAsset instead of streamed to
 * whoever clicked, which is the whole difference between "somebody remembered"
 * and "it happened".
 *
 * The folder key comes from `photoGroupFor(vertical, kind)` — the same inverse
 * mapping the uploader uses — so the report lands in the folder its own photos
 * are in, under either vertical's spelling. Hard-coding one spelling would
 * strand every solar report in "Other".
 */
export const compilePhotosAction: AutomationActionModule = {
  type: "compile_photos",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick which photo checklist to compile." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no checklist.");

    const group = photoGroupFor(ctx.vertical, parsed.data.kind);
    const def = PHOTO_GROUPS[group];

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: { firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
    });
    if (!lead) return fail("Deal not found.");

    const photos = await prisma.fileAsset.findMany({
      where: { companyId: ctx.companyId, leadId: ctx.leadId, kind: "photo", category: group },
      orderBy: { createdAt: "asc" },
      select: { storageKey: true, name: true },
    });
    // An empty report is a PDF of nothing filed on a customer's job. Fail so
    // somebody sees why, and so a later action in the rule does not run either.
    if (photos.length === 0) return fail(`No photos in ${def.label} to compile.`);

    const reportPhotos: ReportPhoto[] = photos.map((p) => ({
      storageKey: p.storageKey,
      label: def.reportSection,
      caption: p.name.replace(/\.[a-z0-9]+$/i, ""),
    }));

    const customer = `${lead.firstName} ${lead.lastName}`.trim();
    const address = [lead.address, [lead.city, lead.state, lead.zip].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join("  -  ");

    const bytes = await renderPhotoReport(reportPhotos, {
      reference: customer,
      customer,
      address,
      setLabel: def.label,
    });
    const buffer = Buffer.from(bytes);

    const name = `${def.label} Report.pdf`;
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
        category: group,
        leadId: ctx.leadId,
        uploadedById: null,
      },
    });

    return {
      type: "compile_photos",
      ok: true,
      detail: `Compiled ${photos.length} ${def.label.toLowerCase()} into a PDF.`,
    };
  },
};

function fail(detail: string): StepResult {
  return { type: "compile_photos", ok: false, detail };
}
