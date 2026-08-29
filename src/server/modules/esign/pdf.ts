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
/**
 * One PDF inside an envelope. A template can bundle several, and they are sent,
 * signed, and filed as a single document — so `documents` is what a signer
 * scrolls through and what the merged, signed PDF is assembled from.
 *
 * Page numbers on a field are PER DOCUMENT: `page: 1` means the first page of
 * THIS document, not of the bundle.
 */
export type SnapshotDocument = {
  id: string;
  name: string;
  order: number;
  pages: SnapshotPage[];
  body: SnapshotBody[];
  fields: SnapshotField[];
  sourcePdfKey?: string | null;
};

export type Snapshot = {
  pages: SnapshotPage[];
  body: SnapshotBody[];
  fields: SnapshotField[];
  sourcePdfKey?: string | null;
  /**
   * The bundle. Absent (or empty) on every package sent before multi-document
   * templates existed, and on any single-PDF template — the top-level
   * pages/body/fields/sourcePdfKey are then the whole document. Read this
   * through `envelopeDocuments()` rather than directly, so both shapes are
   * handled in one place.
   *
   * When present, the top-level fields are the FLATTENED union across every
   * document (the signer-role filter and the field-value store both key off it),
   * and the top-level pages/sourcePdfKey mirror the first document.
   */
  documents?: SnapshotDocument[];
};

/**
 * The documents in an envelope, in bundle order — always at least one.
 *
 * A single-PDF template has no `documents` array, so its top-level snapshot IS
 * document 1. Collapsing both shapes here is what keeps every caller (render,
 * signing UI, PDF serving) free of the legacy branch.
 */
export function envelopeDocuments(snapshot: Snapshot, fallbackName = "Document"): SnapshotDocument[] {
  const docs = snapshot.documents ?? [];
  if (docs.length > 0) return [...docs].sort((a, b) => a.order - b.order);
  return [
    {
      id: "primary",
      name: fallbackName,
      order: 1,
      pages: snapshot.pages ?? [],
      body: snapshot.body ?? [],
      fields: snapshot.fields ?? [],
      sourcePdfKey: snapshot.sourcePdfKey ?? null,
    },
  ];
}

export type FilledValue = { value: string; type: SnapshotField["type"] };

export type SignedPdfArgs = {
  title: string;
  snapshot: Snapshot;
  ctx: AutofillContext;
  values: Record<string, FilledValue>;
  signers: {
    name: string;
    email: string | null;
    signedAt: Date | null;
    ip: string | null;
    role?: string | null;
    status?: string | null;
    userAgent?: string | null;
    consentAt?: Date | null;
    viewedAt?: Date | null;
    latitude?: number | null;
    longitude?: number | null;
    geoAccuracy?: number | null;
    // Human-readable approximate location resolved from the signer's IP when GPS
    // was not shared (e.g. "Round Rock, TX, US (via IP)").
    locationLabel?: string | null;
  }[];
  events: { type: string; actor: string | null; ip: string | null; createdAt: Date; metadata: unknown }[];
  // When provided, fields are stamped onto this existing PDF instead of generated pages.
  sourcePdf?: Buffer | null;
  // Append the signer/audit certificate page (default true). Off for previews.
  certificate?: boolean;
  // Metadata for the certificate of completion.
  documentId?: string | null;
  completedAt?: Date | null;
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

  // Certificate of completion (appended in both modes, unless previewing).
  if (args.certificate !== false) {
    const contentPages = doc.getPageCount();
    renderCertificate(doc, { font, bold, oblique }, args, contentPages);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/** Concatenate PDFs, in order, into one file. */
export async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

/**
 * Render a whole envelope — every document in the bundle — as one PDF.
 *
 * Each document is stamped on its own (its fields' page numbers are relative to
 * it), the results are concatenated in bundle order, and ONE certificate of
 * completion closes the file. The certificate covers the envelope, not each
 * document, because the envelope is what the parties signed: one consent, one
 * audit trail, one set of signers.
 *
 * A single-document envelope takes the same path as before — stamp, certify —
 * so nothing about an existing template's output changes.
 *
 * `loadSource` is injected rather than importing storage here, which keeps this
 * module free of I/O and testable with plain buffers.
 */
export async function generateEnvelopePdf(
  args: Omit<SignedPdfArgs, "sourcePdf"> & { loadSource: (key: string) => Promise<Buffer | null> },
): Promise<Buffer> {
  const docs = envelopeDocuments(args.snapshot, args.title);

  const load = async (key: string | null | undefined) => {
    if (!key) return null;
    try {
      return await args.loadSource(key);
    } catch {
      return null;
    }
  };

  if (docs.length === 1) {
    const only = docs[0];
    return generateSignedPdf({
      ...args,
      snapshot: { pages: only.pages, body: only.body, fields: only.fields, sourcePdfKey: only.sourcePdfKey },
      sourcePdf: await load(only.sourcePdfKey),
    });
  }

  const parts: Buffer[] = [];
  for (const d of docs) {
    parts.push(
      await generateSignedPdf({
        ...args,
        title: `${args.title} — ${d.name}`,
        snapshot: { pages: d.pages, body: d.body, fields: d.fields, sourcePdfKey: d.sourcePdfKey },
        sourcePdf: await load(d.sourcePdfKey),
        // The certificate belongs to the assembled bundle, not to each part.
        certificate: false,
      }),
    );
  }

  const merged = await mergePdfs(parts);
  if (args.certificate === false) return merged;

  const doc = await PDFDocument.load(merged);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  renderCertificate(doc, { font, bold, oblique }, args as SignedPdfArgs, doc.getPageCount());
  return Buffer.from(await doc.save());
}

// WinAnsi-safe + compact device string from a user agent.
function safe(s: string): string {
  return (s ?? "").replace(/[^\x20-\x7E]/g, (c) => (({ "—": "-", "–": "-", "·": "-", "•": "*" } as Record<string, string>)[c] ?? ""));
}
// Timestamps display in US Central with an explicit CDT/CST label.
function fmtTs(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
    timeZone: "America/Chicago", timeZoneName: "short",
  });
}
function deviceFrom(ua: string | null | undefined): string {
  // Never leave the certificate's Device field blank — fall back to a neutral,
  // non-misleading descriptor when no user agent was captured.
  if (!ua) return "Desktop browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Linux|CrOS/.test(ua) ? "Linux" : "desktop";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "browser";
  return `${br} on ${os}`;
}

function renderCertificate(
  doc: PDFDocument,
  fonts: { font: PDFFont; bold: PDFFont; oblique: PDFFont },
  args: SignedPdfArgs,
  contentPages: number,
) {
  const { font, bold } = fonts;
  const W = 612, H = 792, M = 56;
  const GREEN = rgb(0.05, 0.5, 0.3);
  let page = doc.addPage([W, H]);
  let y = H - 56;

  const head = (p: PDFPage) => {
    p.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GOLD });
  };
  head(page);
  const ensure = (need: number) => { if (y - need < 56) { page = doc.addPage([W, H]); head(page); y = H - 56; } };
  const txt = (t: string, x: number, size: number, f: PDFFont = font, c = INK) => page.drawText(safe(t), { x, y, size, font: f, color: c });
  const right = (t: string, rx: number, size: number, f: PDFFont = font, c = INK) => page.drawText(safe(t), { x: rx - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color: c });

  // Title
  txt("Certificate of Completion", M, 19, bold); y -= 16;
  txt("Electronic Record & Signature Audit Trail", M, 9.5, font, GRAY); y -= 24;

  // Document summary box
  const docId = (args.documentId ?? "").slice(0, 8).toUpperCase();
  const summary: [string, string][] = [
    ["Document", args.title],
    ["Document ID", docId ? `AH-DOC-${docId}` : "—"],
    ["Status", "Completed - all parties signed"],
    ["Completed", fmtTs(args.completedAt ?? args.signers.map((s) => s.signedAt).filter(Boolean).sort().at(-1) ?? null)],
    ["Pages", `${contentPages} content page${contentPages === 1 ? "" : "s"} + this certificate`],
    ["Signers", `${args.signers.length}`],
  ];
  const boxTop = y;
  const boxH = summary.length * 16 + 14;
  page.drawRectangle({ x: M, y: y - boxH + 6, width: W - 2 * M, height: boxH, color: rgb(0.975, 0.975, 0.98), borderColor: rgb(0.88, 0.88, 0.9), borderWidth: 0.6 });
  y = boxTop - 8;
  for (const [k, v] of summary) { txt(k, M + 12, 9, bold); txt(v, M + 130, 9, font, INK); y -= 16; }
  y -= 18;

  // Signers
  ensure(20);
  txt("Signers", M, 12.5, bold); y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.86, 0.86, 0.89) }); y -= 18;

  for (const s of args.signers) {
    // Viewed time: prefer the signer record; fall back to the audit "viewed"
    // event so the field is populated whenever a view was logged.
    const viewedAt = s.viewedAt
      ?? args.events.find((e) => e.type === "viewed" && (!e.actor || e.actor === s.name || e.actor === s.email))?.createdAt
      ?? null;
    const location = s.latitude != null && s.longitude != null
      ? `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)} (GPS${s.geoAccuracy != null ? `, +/- ${Math.round(s.geoAccuracy)} m` : ""})`
      : (s.locationLabel || "Approximate location unavailable");
    const rows: [string, string][] = [
      ["Email", s.email || "—"],
      ["Status", s.status === "signed" || s.signedAt ? "Signed" : (s.status ?? "—")],
      ["Consented", fmtTs(s.consentAt)],
      ["Viewed", fmtTs(viewedAt)],
      ["Signed", fmtTs(s.signedAt)],
      ["IP address", s.ip || "Not recorded"],
      ["Device", deviceFrom(s.userAgent)],
      ["Location", location],
    ];

    // Reserve the whole card so the header band never lands across a page break.
    const cardH = 17 + 16 + rows.length * 12.5 + 6;
    ensure(cardH + 8);
    const cardTop = y;
    // Header row sits a comfortable distance below the top border (this is the
    // gap that was missing before — the name used to overlap the border line).
    y -= 17;
    txt(s.name || "Signer", M + 14, 11, bold);
    if (s.role) right(safe(s.role).replace(/_/g, " "), W - M - 14, 8.5, bold, GOLD);
    y -= 16;
    for (const [k, v] of rows) { txt(k, M + 20, 8.5, font, GRAY); txt(v, M + 130, 8.5, font, INK); y -= 12.5; }
    // Card border, drawn from a padded bottom up to the top edge.
    const cardBottom = y + 4;
    page.drawRectangle({ x: M, y: cardBottom, width: W - 2 * M, height: cardTop - cardBottom, borderColor: rgb(0.88, 0.88, 0.9), borderWidth: 0.6 });
    y = cardBottom - 16;
  }

  // Audit trail
  ensure(30);
  y -= 4;
  txt("Audit Trail", M, 12.5, bold);
  right("hash-chained - tamper-evident", W - M, 8, font, GRAY); y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.86, 0.86, 0.89) }); y -= 16;
  for (const e of args.events) {
    ensure(22);
    const hash = ((e.metadata as { hash?: string }) ?? {}).hash ?? "";
    txt(fmtTs(e.createdAt), M + 4, 8, font, GRAY);
    txt(`${safe(e.type).replace(/_/g, " ")}  -  ${e.actor ?? "system"}${e.ip ? `  -  ${e.ip}` : ""}`, M + 150, 8, font, INK);
    y -= 10;
    if (hash) { txt(`sha256: ${hash.slice(0, 64)}`, M + 150, 6.5, font, GRAY); y -= 12; } else y -= 2;
  }

  // Legal footer (on the current/last cert page)
  ensure(40);
  y = Math.max(y, 70);
  page.drawLine({ start: { x: M, y: 64 }, end: { x: W - M, y: 64 }, thickness: 0.6, color: rgb(0.86, 0.86, 0.89) });
  page.drawText(safe("This document was executed electronically under the U.S. ESIGN Act and UETA. Each signer affirmatively"), { x: M, y: 52, size: 7.5, font, color: GRAY });
  page.drawText(safe("consented to use electronic records and signatures. The audit trail above - including timestamps, IP addresses,"), { x: M, y: 43, size: 7.5, font, color: GRAY });
  page.drawText(safe("device, and (where shared) geolocation - is hash-chained and forms part of the legal record."), { x: M, y: 34, size: 7.5, font, color: GRAY });
  void GREEN;
}
