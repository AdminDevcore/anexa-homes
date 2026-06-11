import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { fillTokens, type AutofillContext } from "./autofill";

export type SnapshotPage = { width: number; height: number };
export type SnapshotBody = { page: number; type: "heading" | "text"; text: string; x: number; y: number };
export type SnapshotField = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "text" | "date" | "checkbox" | "signature" | "initials";
  signerRole: string;
  label?: string | null;
  valueToken?: string | null;
  defaultValue?: string | null;
};
export type Snapshot = {
  pages: SnapshotPage[];
  body: SnapshotBody[];
  fields: SnapshotField[];
  sourcePdfKey?: string | null;
};

export type FilledValue = { value: string; type: SnapshotField["type"] };

export type SignedPdfArgs = {
  title: string;
  snapshot: Snapshot;
  ctx: AutofillContext;
  values: Record<string, FilledValue>;
  signers: { name: string; email: string | null; signedAt: Date | null; ip: string | null }[];
  events: { type: string; actor: string | null; ip: string | null; createdAt: Date; metadata: unknown }[];
  // When provided, fields are stamped onto this existing PDF instead of generated pages.
  sourcePdf?: Buffer | null;
  // Append the signer/audit certificate page (default true). Off for previews.
  certificate?: boolean;
};

const GOLD = rgb(0.75, 0.63, 0.37);
const INK = rgb(0.04, 0.04, 0.05);
const GRAY = rgb(0.45, 0.45, 0.45);

export async function generateSignedPdf(args: SignedPdfArgs): Promise<Buffer> {
  const fromSource = !!args.sourcePdf;
  const doc = fromSource ? await PDFDocument.load(args.sourcePdf as Buffer) : await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let pages: PDFPage[];
  if (fromSource) {
    // Stamp directly onto the uploaded PDF's existing pages.
    pages = doc.getPages();
  } else {
    pages = args.snapshot.pages.length
      ? args.snapshot.pages.map((p) => doc.addPage([p.width, p.height]))
      : [doc.addPage([612, 792])];

    // Header band on page 1 (generated docs only)
    const first = pages[0];
    const { height: fh } = first.getSize();
    first.drawRectangle({ x: 0, y: fh - 6, width: first.getWidth(), height: 6, color: GOLD });
    first.drawText("ANEXA HOMES", { x: 56, y: fh - 40, size: 16, font: bold, color: INK });
    first.drawText(args.title, { x: 56, y: fh - 58, size: 10, font, color: GRAY });

    // Body blocks (generated docs only)
    for (const block of args.snapshot.body) {
      const page = pages[(block.page ?? 1) - 1];
      if (!page) continue;
      const text = fillTokens(block.text ?? "", args.ctx);
      page.drawText(text, {
        x: block.x,
        y: block.y,
        size: block.type === "heading" ? 18 : 11,
        font: block.type === "heading" ? bold : font,
        color: INK,
      });
    }
  }

  // Fields — stamped in both modes.
  for (const f of args.snapshot.fields) {
    const page = pages[(f.page ?? 1) - 1];
    if (!page) continue;
    const filled = args.values[f.id];
    // Auto-fill from CRM token if mapped (server-authoritative); fall back to the
    // field's default value when the bound record field is empty.
    let tokenText = f.valueToken ? fillTokens(f.valueToken, args.ctx) : "";
    if (!tokenText && f.defaultValue) tokenText = fillTokens(f.defaultValue, args.ctx);

    if ((f.type === "text" || f.type === "date") && tokenText) {
      page.drawText(tokenText, { x: f.x + 2, y: f.y + 4, size: 11, font, color: INK });
      continue;
    }
    if (f.type === "checkbox" && tokenText) {
      const on = /^(true|yes|x|1)$/i.test(tokenText.trim());
      page.drawText(on ? "X" : "", { x: f.x + 2, y: f.y + 4, size: 12, font: bold, color: INK });
      continue;
    }

    if (!filled?.value) continue;

    if ((f.type === "signature" || f.type === "initials") && filled.value.startsWith("data:image")) {
      try {
        const png = await doc.embedPng(filled.value);
        const scale = Math.min(f.width / png.width, f.height / png.height, 1);
        page.drawImage(png, { x: f.x + 2, y: f.y + 2, width: png.width * scale, height: png.height * scale });
      } catch {
        page.drawText(args.ctx.customer.fullName, { x: f.x + 2, y: f.y + 4, size: 16, font: oblique, color: INK });
      }
    } else if (f.type === "checkbox") {
      page.drawText(filled.value === "true" ? "X" : "", { x: f.x + 2, y: f.y + 4, size: 12, font: bold, color: INK });
    } else {
      page.drawText(fillTokens(filled.value, args.ctx), { x: f.x + 2, y: f.y + 4, size: 11, font, color: INK });
    }
  }

  // Certificate of completion page (appended in both modes, unless previewing).
  if (args.certificate !== false) {
    drawCertificate(doc.addPage([612, 792]), { font, bold }, args);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function drawCertificate(
  page: PDFPage,
  fonts: { font: PDFFont; bold: PDFFont },
  args: SignedPdfArgs
) {
  const { font, bold } = fonts;
  const W = page.getWidth();
  let y = page.getHeight() - 60;

  page.drawRectangle({ x: 0, y: page.getHeight() - 6, width: W, height: 6, color: GOLD });
  page.drawText("Certificate of Completion", { x: 56, y, size: 18, font: bold, color: INK });
  y -= 22;
  page.drawText(`Document: ${args.title}`, { x: 56, y, size: 10, font, color: GRAY });
  y -= 30;

  page.drawText("Signers", { x: 56, y, size: 12, font: bold, color: INK });
  y -= 18;
  for (const s of args.signers) {
    const line = `${s.name}${s.email ? ` <${s.email}>` : ""} — signed ${
      s.signedAt ? s.signedAt.toISOString() : "—"
    } — IP ${s.ip ?? "—"}`;
    page.drawText(line, { x: 64, y, size: 9, font, color: INK });
    y -= 14;
  }

  y -= 16;
  page.drawText("Audit Trail (hash-chained, tamper-evident)", { x: 56, y, size: 12, font: bold, color: INK });
  y -= 16;
  for (const e of args.events) {
    const hash = ((e.metadata as { hash?: string }) ?? {}).hash ?? "";
    const line = `${e.createdAt.toISOString()}  ${e.type}  ${e.actor ?? "system"}  ${e.ip ?? ""}`;
    page.drawText(line, { x: 64, y, size: 8, font, color: INK });
    y -= 11;
    page.drawText(`   sha256: ${hash.slice(0, 64)}`, { x: 64, y, size: 7, font, color: GRAY });
    y -= 13;
    if (y < 90) break;
  }

  page.drawText(
    "Electronically signed under the U.S. ESIGN Act and UETA. Signers consented to use",
    { x: 56, y: 60, size: 8, font, color: GRAY }
  );
  page.drawText("electronic records and signatures. This certificate is part of the legal record.", {
    x: 56,
    y: 50,
    size: 8,
    font,
    color: GRAY,
  });
}
