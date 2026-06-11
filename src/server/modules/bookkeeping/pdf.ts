import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";

// Strip non-WinAnsi chars so drawText never throws (mirror paystub.ts).
function safe(s: string): string {
  return (s ?? "").replace(/[^\x20-\x7E]/g, (c) => ({ "—": "-", "–": "-", "•": "*", "·": "-", "&": "&" } as Record<string, string>)[c] ?? "");
}
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type ReportCompany = {
  name: string; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; email: string | null;
};
type Section = { heading: string; rows: { label: string; amount: number }[]; total: number; tone: "pos" | "neg" };

async function loadLogo(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(await readFile(path.join(process.cwd(), "public", "anexa-mark.png")));
  } catch {
    return null;
  }
}

async function buildReport(company: ReportCompany, title: string, asOf: string, sections: Section[], finalLabel: string, finalAmount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${company.name} — ${title}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(doc);
  const page = doc.addPage([612, 792]);
  const W = 612, H = 792, M = 56;
  const INK = rgb(0.07, 0.07, 0.08), MUT = rgb(0.45, 0.45, 0.5), GOLD = rgb(0.75, 0.63, 0.37), POS = rgb(0.05, 0.5, 0.3), NEG = rgb(0.7, 0.15, 0.15);
  const text = (t: string, x: number, y: number, s: number, f: PDFFont = font, c = INK) => page.drawText(safe(t), { x, y, size: s, font: f, color: c });
  const right = (t: string, rx: number, y: number, s: number, f: PDFFont = font, c = INK) => page.drawText(safe(t), { x: rx - f.widthOfTextAtSize(safe(t), s), y, size: s, font: f, color: c });

  // Header band
  page.drawRectangle({ x: 0, y: H - 100, width: W, height: 100, color: INK });
  let hx = M;
  if (logo) {
    const lw = 30, lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: M, y: H - 58 - lh / 2, width: lw, height: lh });
    hx = M + 42;
  }
  text(company.name, hx, H - 50, 18, bold, rgb(1, 1, 1));
  const addr = [company.address, [company.city, company.state].filter(Boolean).join(", "), company.zip].filter(Boolean).join("  ");
  if (addr) text(addr, hx, H - 66, 8, font, rgb(0.82, 0.82, 0.86));
  const contact = [company.phone, company.email].filter(Boolean).join("   ");
  if (contact) text(contact, hx, H - 78, 8, font, rgb(0.82, 0.82, 0.86));
  right(title, W - M, H - 52, 15, bold, GOLD);
  right(`Cash basis  ·  As of ${asOf}`, W - M, H - 68, 8.5, font, rgb(0.82, 0.82, 0.86));

  // Body
  let y = H - 140;
  for (const sec of sections) {
    text(sec.heading.toUpperCase(), M, y, 10, bold, MUT);
    right(usd(sec.total), W - M, y, 10, bold, sec.tone === "neg" ? NEG : POS);
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.86, 0.86, 0.89) });
    y -= 18;
    if (sec.rows.length === 0) { text("None", M + 10, y, 9.5, font, MUT); y -= 18; }
    for (const r of sec.rows) {
      text(r.label, M + 10, y, 10, font, INK);
      right(usd(r.amount), W - M, y, 10, font, INK);
      y -= 17;
    }
    y -= 12;
  }

  // Final / total line
  y -= 4;
  page.drawRectangle({ x: M, y: y - 10, width: W - 2 * M, height: 34, color: rgb(0.98, 0.97, 0.94), borderColor: GOLD, borderWidth: 1 });
  text(finalLabel, M + 14, y + 2, 12, bold, INK);
  right(usd(finalAmount), W - M - 14, y, 15, bold, finalAmount >= 0 ? POS : NEG);

  // Footer
  text(`Generated ${asOf}  ·  ${company.name} — Confidential`, M, 42, 8, font, MUT);
  return doc.save();
}

export function buildPnlPdf(company: ReportCompany, pnl: { income: { name: string; total: number }[]; expense: { name: string; total: number }[]; totalIncome: number; totalExpense: number; netProfit: number }, asOf: string) {
  return buildReport(
    company,
    "Profit & Loss Statement",
    asOf,
    [
      { heading: "Income", rows: pnl.income.map((r) => ({ label: r.name, amount: r.total })), total: pnl.totalIncome, tone: "pos" },
      { heading: "Expenses", rows: pnl.expense.map((r) => ({ label: r.name, amount: r.total })), total: pnl.totalExpense, tone: "neg" },
    ],
    "NET PROFIT",
    pnl.netProfit
  );
}

export function buildBalanceSheetPdf(company: ReportCompany, bs: { assets: { name: string; total: number }[]; liabilities: { name: string; total: number }[]; equity: { name: string; total: number }[]; totalAssets: number; totalLiabilities: number; totalEquity: number }, asOf: string) {
  return buildReport(
    company,
    "Balance Sheet",
    asOf,
    [
      { heading: "Assets", rows: bs.assets.map((r) => ({ label: r.name, amount: r.total })), total: bs.totalAssets, tone: "pos" },
      { heading: "Liabilities", rows: bs.liabilities.map((r) => ({ label: r.name, amount: r.total })), total: bs.totalLiabilities, tone: "neg" },
      { heading: "Equity", rows: bs.equity.map((r) => ({ label: r.name, amount: r.total })), total: bs.totalEquity, tone: "pos" },
    ],
    "TOTAL ASSETS",
    bs.totalAssets
  );
}
