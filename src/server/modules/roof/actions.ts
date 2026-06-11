"use server";

import { z } from "zod";
import { nanoid } from "nanoid";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { putObject } from "@/server/storage";
import { computeRoof, type Facet, type LatLng } from "@/lib/roof";
import { brandingForCompany } from "@/server/branding/resolve";
import { formattersFor } from "@/lib/format-server";

function fail(error: string) {
  return { ok: false as const, error };
}

const facetSchema = z.object({
  id: z.string(),
  name: z.string().max(120).optional(),
  points: z.array(z.tuple([z.number(), z.number()])).min(3),
  pitch: z.string().regex(/^\d{1,2}\/12$/),
  edgeTypes: z.array(z.enum(["eave", "rake", "ridge", "hip", "valley", "other"])),
});

const saveSchema = z.object({
  leadId: z.string().min(1),
  facets: z.array(facetSchema).min(1, "Trace at least one roof facet."),
  wastePct: z.number().min(0).max(50).default(12),
  preparedBy: z.string().max(120).optional().nullable(),
});

async function leadInScope(user: Awaited<ReturnType<typeof requireUser>>, leadId: string) {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  return prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true, firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
  });
}

export async function saveRoofReportAction(
  input: z.infer<typeof saveSchema>
): Promise<{ ok: true; squares: number } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Lead")) return fail("You don't have access to edit this lead.");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid roof data.");

  const lead = await leadInScope(me, parsed.data.leadId);
  if (!lead) return fail("Lead not found or access denied.");

  // Authoritative recompute from geometry (don't trust client numbers).
  const r = computeRoof(parsed.data.facets as Facet[], parsed.data.wastePct);

  const data = {
    companyId: me.companyId,
    facets: parsed.data.facets as unknown as Prisma.InputJsonValue,
    footprintArea: r.footprintArea,
    roofArea: r.roofArea,
    squares: r.squares,
    facetCount: r.facetCount,
    predominantPitch: r.predominantPitch,
    perimeterFt: r.perimeterFt,
    ridgeFt: r.byEdge.ridge,
    hipFt: r.byEdge.hip,
    valleyFt: r.byEdge.valley,
    eaveFt: r.byEdge.eave,
    rakeFt: r.byEdge.rake,
    wastePct: r.wastePct,
    squaresToOrder: r.squaresToOrder,
    preparedBy: parsed.data.preparedBy ?? me.fullName,
  };

  await prisma.roofReport.upsert({
    where: { leadId: lead.id },
    update: data,
    create: { ...data, leadId: lead.id },
  });
  return { ok: true, squares: Math.round(r.squares * 10) / 10 };
}

// --- PDF report -----------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const ORANGE = rgb(0.957, 0.388, 0.118);
const DARK = rgb(0.1, 0.1, 0.12);
const INK = rgb(0.15, 0.15, 0.18);
const GRAY = rgb(0.45, 0.45, 0.5);

function ft(n: number) {
  return `${Math.round(n)} ft`;
}

export async function generateRoofReportPdfAction(
  leadId: string
): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "create", "File")) return fail("No access.");
  const lead = await leadInScope(me, leadId);
  if (!lead) return fail("Lead not found.");

  const report = await prisma.roofReport.findFirst({ where: { companyId: me.companyId, leadId } });
  if (!report) return fail("Trace and save the roof first.");

  const branding = await brandingForCompany(me.companyId);
  const formatters = formattersFor(branding);
  const facets = (report.facets as unknown as Facet[]) ?? [];
  const r = computeRoof(facets, report.wastePct);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  // Header band
  page.drawRectangle({ x: 0, y: PAGE_H - 80, width: PAGE_W, height: 80, color: DARK });
  page.drawText(branding.companyName, { x: M, y: PAGE_H - 40, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Roof Measurement Report", { x: M, y: PAGE_H - 62, size: 12, font, color: ORANGE });
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  page.drawText(dateStr, { x: PAGE_W - M - font.widthOfTextAtSize(dateStr, 10), y: PAGE_H - 40, size: 10, font, color: rgb(1, 1, 1) });

  let y = PAGE_H - 110;
  const customer = `${lead.firstName} ${lead.lastName}`.trim();
  const addr = [lead.address, [lead.city, lead.state, lead.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  page.drawText(customer, { x: M, y, size: 13, font: bold, color: INK });
  y -= 16;
  page.drawText(addr || "—", { x: M, y, size: 10, font, color: GRAY });
  y -= 28;

  // --- Roof diagram (vector, from geo geometry) ---
  const diagBox = { x: M, y: y - 220, w: PAGE_W - M * 2, h: 220 };
  drawDiagram(page, facets, diagBox, font);
  y = diagBox.y - 24;

  // --- Totals strip ---
  const totals: [string, string][] = [
    ["Total roof area", `${Math.round(r.roofArea).toLocaleString()} sq ft`],
    ["Roofing squares", r.squares.toFixed(1)],
    ["Predominant pitch", r.predominantPitch],
    ["Facets", String(r.facetCount)],
    ["Waste", `${r.wastePct}%`],
    ["Squares to order", r.squaresToOrder.toFixed(1)],
  ];
  const colW = (PAGE_W - M * 2) / 3;
  totals.forEach(([label, val], i) => {
    const cx = M + (i % 3) * colW;
    const cy = y - Math.floor(i / 3) * 40;
    page.drawText(label.toUpperCase(), { x: cx, y: cy, size: 7, font, color: GRAY });
    page.drawText(String(val), { x: cx, y: cy - 14, size: 13, font: bold, color: INK });
  });
  y -= 92;

  // --- Per-facet table ---
  page.drawText("Per-facet breakdown", { x: M, y, size: 11, font: bold, color: INK });
  y -= 16;
  const cols = [
    { label: "Facet", x: M },
    { label: "Pitch", x: M + 120 },
    { label: "Footprint", x: M + 200 },
    { label: "Sloped area", x: M + 320 },
    { label: "Perimeter", x: M + 440 },
  ];
  cols.forEach((c) => page.drawText(c.label, { x: c.x, y, size: 8, font: bold, color: GRAY }));
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
  y -= 14;
  r.facets.forEach((f, i) => {
    page.drawText(`Facet ${i + 1}`, { x: cols[0].x, y, size: 9, font, color: INK });
    page.drawText(f.pitch, { x: cols[1].x, y, size: 9, font, color: INK });
    page.drawText(`${Math.round(f.footprint)} sq ft`, { x: cols[2].x, y, size: 9, font, color: INK });
    page.drawText(`${Math.round(f.sloped)} sq ft`, { x: cols[3].x, y, size: 9, font, color: INK });
    page.drawText(ft(f.perimeter), { x: cols[4].x, y, size: 9, font, color: INK });
    y -= 14;
  });

  y -= 10;
  page.drawText("Edge lengths", { x: M, y, size: 11, font: bold, color: INK });
  y -= 14;
  const edges = `Eaves ${ft(r.byEdge.eave)}   Rakes ${ft(r.byEdge.rake)}   Ridges ${ft(r.byEdge.ridge)}   Hips ${ft(r.byEdge.hip)}   Valleys ${ft(r.byEdge.valley)}   Total perimeter ${ft(r.perimeterFt)}`;
  page.drawText(edges, { x: M, y, size: 9, font, color: INK });
  y -= 26;

  // Disclaimer + prepared by
  page.drawText(`Prepared by ${report.preparedBy ?? me.fullName}`, { x: M, y, size: 9, font, color: GRAY });
  y -= 16;
  const disc = "Estimate based on aerial imagery and the pitch entered. Verify measurements on site before ordering.";
  page.drawText(disc, { x: M, y, size: 8, font, color: GRAY, maxWidth: PAGE_W - M * 2 });

  const bytes = await doc.save();
  const key = `companies/${me.companyId}/roof-reports/${nanoid()}.pdf`;
  await putObject(key, Buffer.from(bytes));

  const file = await prisma.fileAsset.create({
    data: {
      companyId: me.companyId,
      kind: "document",
      name: `Roof Measurement Report — ${customer}.pdf`,
      storageKey: key,
      mimeType: "application/pdf",
      size: bytes.length,
      category: "Roof Report",
      leadId: lead.id,
      uploadedById: me.userId,
    },
    select: { id: true },
  });
  await prisma.roofReport.update({ where: { leadId: lead.id }, data: { reportFileId: file.id } });
  return { ok: true, fileId: file.id };
}

/** Draw the traced facets as a scaled vector diagram (projected geo → page space). */
function drawDiagram(
  page: import("pdf-lib").PDFPage,
  facets: Facet[],
  box: { x: number; y: number; w: number; h: number },
  font: import("pdf-lib").PDFFont
) {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: rgb(0.97, 0.97, 0.98), borderColor: rgb(0.88, 0.88, 0.9), borderWidth: 0.5 });
  const all: LatLng[] = facets.flatMap((f) => f.points);
  if (all.length === 0) return;
  const lat0 = all[0][0];
  const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = facets.map((f) => f.points.map(([lat, lng]) => [(lng - all[0][1]) * mLng, (lat - all[0][0]) * 110574] as [number, number]));
  const flat = pts.flat();
  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const pad = 16;
  const scale = Math.min((box.w - pad * 2) / spanX, (box.h - pad * 2) / spanY);
  const offX = box.x + (box.w - spanX * scale) / 2;
  const offY = box.y + (box.h - spanY * scale) / 2;
  const tx = (x: number) => offX + (x - minX) * scale;
  const ty = (yv: number) => offY + (yv - minY) * scale;

  const colors = [rgb(0.95, 0.39, 0.12), rgb(0.23, 0.51, 0.96), rgb(0.13, 0.77, 0.37), rgb(0.66, 0.33, 0.97), rgb(0.92, 0.3, 0.3)];
  pts.forEach((poly, fi) => {
    const c = colors[fi % colors.length];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      page.drawLine({ start: { x: tx(a[0]), y: ty(a[1]) }, end: { x: tx(b[0]), y: ty(b[1]) }, thickness: 1.5, color: c });
    }
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    page.drawText(String(fi + 1), { x: tx(cx) - 3, y: ty(cy) - 4, size: 11, font, color: c });
  });
}
