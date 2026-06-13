import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import type { ReportResult, MasterReport } from "./builders";

// Strip non-WinAnsi chars so drawText never throws.
function safe(s: string): string {
  return String(s ?? "").replace(/[^\x20-\x7E]/g, (c) => ({ "—": "-", "–": "-", "•": "*", "·": "-", "→": "->", "’": "'", "“": '"', "”": '"' } as Record<string, string>)[c] ?? "");
}

export type ReportCompany = { name: string; address: string | null; city: string | null; state: string | null; zip: string | null };

export async function buildReportPdf(company: ReportCompany, report: ReportResult): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4
  const M = 48;
  let y = 842 - M;

  const ink = rgb(0.1, 0.1, 0.11);
  const muted = rgb(0.45, 0.45, 0.48);
  const line = rgb(0.85, 0.85, 0.87);

  const text = (s: string, x: number, size: number, f: PDFFont, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const ensure = (need: number) => {
    if (y - need < M) { page = doc.addPage([595, 842]); y = 842 - M; }
  };

  // Logo (optional)
  try {
    const png = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "anexa-mark.png")));
    const w = 28; const h = (png.height / png.width) * w;
    page.drawImage(png, { x: M, y: y - h + 6, width: w, height: h });
  } catch { /* no logo */ }

  text(company.name, M + 36, 16, bold);
  y -= 22;
  const addr = [company.address, [company.city, company.state, company.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  if (addr) { text(addr, M + 36, 9, font, muted); }
  y -= 24;

  text(report.title, M, 20, bold);
  y -= 18;
  text(`${report.periodLabel}  ·  ${report.scopeLabel}`, M, 10, font, muted);
  y -= 24;

  // Metrics — two columns of label / value.
  page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: line });
  y -= 18;
  const colW = (595 - M * 2) / 2;
  for (let i = 0; i < report.metrics.length; i += 2) {
    ensure(20);
    const a = report.metrics[i];
    const b = report.metrics[i + 1];
    text(a.label + (a.hint ? ` (${a.hint})` : ""), M, 10, font, muted);
    page.drawText(safe(a.value), { x: M + colW - 8 - bold.widthOfTextAtSize(safe(a.value), 12), y, size: 12, font: bold, color: ink });
    if (b) {
      text(b.label + (b.hint ? ` (${b.hint})` : ""), M + colW + 8, 10, font, muted);
      page.drawText(safe(b.value), { x: 595 - M - bold.widthOfTextAtSize(safe(b.value), 12), y, size: 12, font: bold, color: ink });
    }
    y -= 20;
  }
  y -= 8;

  // Tables
  for (const t of report.tables) {
    ensure(40);
    page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: line });
    y -= 16;
    text(t.title, M, 12, bold);
    y -= 16;
    // header
    const cols = t.columns.length;
    const w = (595 - M * 2) / cols;
    t.columns.forEach((c, i) => {
      const x = i === 0 ? M : M + i * w + w - 6 - font.widthOfTextAtSize(safe(c), 9);
      page.drawText(safe(c), { x, y, size: 9, font, color: muted });
    });
    y -= 14;
    for (const row of t.rows) {
      ensure(16);
      row.forEach((cell, i) => {
        const s = String(cell);
        const x = i === 0 ? M : M + i * w + w - 6 - font.widthOfTextAtSize(safe(s), 10);
        page.drawText(safe(s), { x, y, size: 10, font, color: ink });
      });
      y -= 16;
    }
    if (t.rows.length === 0) { text("No data for this period.", M, 10, font, muted); y -= 16; }
    y -= 8;
  }

  return doc.save();
}

/** One combined PDF: company header once, then each allowed report section. */
export async function buildMasterReportPdf(company: ReportCompany, master: MasterReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  const M = 48;
  let y = 842 - M;

  const ink = rgb(0.1, 0.1, 0.11);
  const muted = rgb(0.45, 0.45, 0.48);
  const line = rgb(0.85, 0.85, 0.87);

  const text = (s: string, x: number, size: number, f: PDFFont, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const ensure = (need: number) => { if (y - need < M) { page = doc.addPage([595, 842]); y = 842 - M; } };
  const rule = () => { page.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 1, color: line }); };

  // Company header
  try {
    const png = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "anexa-mark.png")));
    const w = 28; const h = (png.height / png.width) * w;
    page.drawImage(png, { x: M, y: y - h + 6, width: w, height: h });
  } catch { /* no logo */ }
  text(company.name, M + 36, 16, bold);
  y -= 22;
  const addr = [company.address, [company.city, company.state, company.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  if (addr) text(addr, M + 36, 9, font, muted);
  y -= 24;

  text(master.title, M, 20, bold);
  y -= 18;
  text(`${master.periodLabel}  ·  ${master.scopeLabel}`, M, 10, font, muted);
  y -= 24;

  for (const section of master.sections) {
    ensure(60);
    rule();
    y -= 18;
    text(section.title, M, 14, bold);
    y -= 20;

    // Metrics — two columns of label / value.
    const colW = (595 - M * 2) / 2;
    for (let i = 0; i < section.metrics.length; i += 2) {
      ensure(20);
      const a = section.metrics[i];
      const b = section.metrics[i + 1];
      text(a.label + (a.hint ? ` (${a.hint})` : ""), M, 10, font, muted);
      page.drawText(safe(a.value), { x: M + colW - 8 - bold.widthOfTextAtSize(safe(a.value), 12), y, size: 12, font: bold, color: ink });
      if (b) {
        text(b.label + (b.hint ? ` (${b.hint})` : ""), M + colW + 8, 10, font, muted);
        page.drawText(safe(b.value), { x: 595 - M - bold.widthOfTextAtSize(safe(b.value), 12), y, size: 12, font: bold, color: ink });
      }
      y -= 20;
    }
    y -= 6;

    // Tables
    for (const t of section.tables) {
      ensure(40);
      text(t.title, M, 12, bold);
      y -= 16;
      const cols = t.columns.length;
      const w = (595 - M * 2) / cols;
      t.columns.forEach((c, i) => {
        const x = i === 0 ? M : M + i * w + w - 6 - font.widthOfTextAtSize(safe(c), 9);
        page.drawText(safe(c), { x, y, size: 9, font, color: muted });
      });
      y -= 14;
      for (const row of t.rows) {
        ensure(16);
        row.forEach((cellv, i) => {
          const s = String(cellv);
          const x = i === 0 ? M : M + i * w + w - 6 - font.widthOfTextAtSize(safe(s), 10);
          page.drawText(safe(s), { x, y, size: 10, font, color: ink });
        });
        y -= 16;
      }
      if (t.rows.length === 0) { text("No data for this period.", M, 10, font, muted); y -= 16; }
      y -= 8;
    }
    y -= 8;
  }

  return doc.save();
}
