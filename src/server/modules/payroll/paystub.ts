import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/server/db/client";
import { formatCents, formatDate } from "@/lib/format";

// Strip characters StandardFonts (WinAnsi) can't encode so drawText never throws.
function safe(s: string): string {
  return (s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, "");
}

export type PayStubData = Awaited<ReturnType<typeof getPayStubData>>;

/** Run + company + one employee's line items + YTD — everything a pay stub needs. */
export async function getPayStubData(companyId: string, runId: string, userId: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, companyId },
    include: {
      company: { select: { name: true, address: true, city: true, state: true, zip: true, phone: true } },
      items: {
        where: { userId },
        orderBy: { createdAt: "asc" },
        include: {
          commission: {
            include: {
              project: { select: { projectNumber: true, lead: { select: { firstName: true, lastName: true } } } },
              rule: { select: { type: true, percent: true } },
            },
          },
          // The other kind of line a run can hold. Without it a contractor's
          // stub printed "-" where the job should be, on the one document in
          // this whole flow that he actually receives.
          contractorPay: {
            select: {
              project: { select: { projectNumber: true, lead: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      },
    },
  });
  if (!run || run.items.length === 0) return null;
  const employee = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: { firstName: true, lastName: true, email: true, title: true },
  });
  if (!employee) return null;

  const year = run.periodEnd.getFullYear();
  const ytdItems = await prisma.payrollItem.findMany({
    where: { userId, payrollRun: { companyId, periodEnd: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } },
    select: { amount: true },
  });
  const ytdGross = ytdItems.reduce((s, i) => s + i.amount, 0);

  return { run, company: run.company, employee, items: run.items, ytdGross, year };
}

export async function getRunStubList(companyId: string, runId: string): Promise<NonNullable<PayStubData>[]> {
  const items = await prisma.payrollItem.findMany({ where: { payrollRun: { id: runId, companyId } }, select: { userId: true } });
  const userIds = [...new Set(items.map((i) => i.userId))];
  const out: NonNullable<PayStubData>[] = [];
  for (const uid of userIds) {
    const d = await getPayStubData(companyId, runId, uid);
    if (d) out.push(d);
  }
  return out;
}

const ORANGE = rgb(0.957, 0.388, 0.118);
const DARK = rgb(0.09, 0.09, 0.11);
const INK = rgb(0.13, 0.13, 0.16);
const GRAY = rgb(0.45, 0.45, 0.5);
const FAINT = rgb(0.965, 0.965, 0.975);
const LINE = rgb(0.86, 0.86, 0.9);
const W = 612, H = 792, M = 48;
const CW = W - 2 * M;

async function loadLogo(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(await readFile(path.join(process.cwd(), "public", "anexa-mark.png")));
  } catch {
    return null;
  }
}

function basisFor(it: NonNullable<PayStubData>["items"][number]): string {
  // A contractor line has no rule and no pool — the basis IS the invoice he
  // sent, so say that rather than printing the "-" that means "unknown".
  if (it.contractorPayId) return "Submitted invoice";
  const c = it.commission;
  const base = c?.baseAmount ?? 0;
  if (c?.rule?.type === "flat") return "Flat amount";
  if (base > 0) return `${Math.round((it.amount / base) * 100)}% of ${formatCents(base)}`;
  return "-";
}

/** The job a line was earned on, whichever kind of line it is. */
function jobFor(it: NonNullable<PayStubData>["items"][number]) {
  return it.commission?.project ?? it.contractorPay?.project ?? null;
}

function drawStub(doc: PDFDocument, font: PDFFont, bold: PDFFont, logo: PDFImage | null, data: NonNullable<PayStubData>) {
  const { run, company, employee, items, ytdGross, year } = data;
  const page = doc.addPage([W, H]);
  const text = (t: string, x: number, y: number, size: number, f = font, color = INK) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, rx: number, y: number, size: number, f = font, color = INK) => page.drawText(safe(t), { x: rx - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color });
  const fieldOn = (lab: string, value: string, x: number, y: number, vColor = INK) => {
    text(lab, x, y, 7.5, font, GRAY);
    text(value, x, y - 13, 10.5, bold, vColor);
  };

  // Header band
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: DARK });
  if (logo) {
    const lw = 26, lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: M, y: H - 60 - lh / 2 + 6, width: lw, height: lh });
  }
  text(company.name, M + (logo ? 36 : 0), H - 52, 16, bold, rgb(1, 1, 1));
  const addr = [company.address, [company.city, company.state, company.zip].filter(Boolean).join(", "), company.phone].filter(Boolean).join("  ·  ");
  text(addr, M + (logo ? 36 : 0), H - 68, 8, font, rgb(0.8, 0.8, 0.84));
  text("PAY STUB", W - M - bold.widthOfTextAtSize("PAY STUB", 18), H - 56, 18, bold, ORANGE);

  // Meta card
  const payDate = run.paidAt ?? run.periodEnd;
  let y = H - 120;
  const cardTop = y, cardH = 84;
  page.drawRectangle({ x: M, y: cardTop - cardH, width: CW, height: cardH, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) });
  const cA = M + 16, cB = M + 200, cC = W - M - 150;
  let ry = cardTop - 22;
  fieldOn("EMPLOYEE", `${employee.firstName} ${employee.lastName}`, cA, ry);
  fieldOn("PAY PERIOD", `${formatDate(run.periodStart)} - ${formatDate(run.periodEnd)}`, cB, ry);
  fieldOn("PAY DATE", formatDate(payDate), cC, ry);
  ry -= 44;
  fieldOn(employee.title ? "TITLE" : "EMAIL", employee.title ?? employee.email ?? "-", cA, ry);
  fieldOn("PAY FREQUENCY", "Per payroll run", cB, ry);
  fieldOn("STATUS", run.status.toUpperCase(), cC, ry, run.status === "paid" ? rgb(0.13, 0.6, 0.34) : INK);
  y = cardTop - cardH - 26;

  // Earnings
  text("EARNINGS", M, y, 10, bold);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: DARK });
  const projX = M + 8, descX = M + 120, basisX = M + 290, amtR = W - M - 8;
  page.drawRectangle({ x: M, y: y - 20, width: CW, height: 20, color: FAINT });
  text("PROJECT", projX, y - 14, 8, bold, GRAY);
  text("DESCRIPTION", descX, y - 14, 8, bold, GRAY);
  text("BASIS", basisX, y - 14, 8, bold, GRAY);
  right("AMOUNT", amtR, y - 14, 8, bold, GRAY);
  y -= 20;

  items.forEach((it, i) => {
    const rowH = 28;
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: CW, height: rowH, color: FAINT });
    const job = jobFor(it);
    const proj = job?.projectNumber ?? "-";
    const cust = job?.lead ? `${job.lead.firstName} ${job.lead.lastName}`.trim() : "";
    let desc = it.label ?? "";
    if (proj !== "-" && desc.endsWith(` - ${proj}`)) desc = desc.slice(0, -(` - ${proj}`).length);
    const cy = y - 12;
    text(proj, projX, cy, 9.5, bold);
    if (cust) text(cust, projX, cy - 11, 7.5, font, GRAY);
    text(desc, descX, cy, 9.5);
    text(basisFor(it), basisX, cy, 8.5, font, GRAY);
    right(formatCents(it.amount), amtR, cy, 9.5);
    y -= rowH;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE });
  });

  const gross = items.reduce((s, i) => s + i.amount, 0);

  // Lower two-column section: payment details (left) + summary (right)
  y -= 30;
  const sectionTop = y;
  const colW = (CW - 24) / 2;
  const leftX = M, rightX = M + colW + 24;

  // Payment details (left card)
  const pdH = 132;
  page.drawRectangle({ x: leftX, y: sectionTop - pdH, width: colW, height: pdH, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) });
  text("PAYMENT DETAILS", leftX + 14, sectionTop - 18, 8.5, bold, INK);
  const pdRows: [string, string][] = [
    ["Payment method", "Direct deposit"],
    ["Employer", company.name],
    ["Pay run", run.label],
    ["Pay date", formatDate(payDate)],
    ["YTD period", `Jan 1 - Dec 31, ${year}`],
  ];
  let py = sectionTop - 40;
  for (const [k, v] of pdRows) {
    text(k, leftX + 14, py, 8.5, font, GRAY);
    right(v, leftX + colW - 14, py, 8.5, font, INK);
    py -= 17;
  }

  // Summary (right): Current vs YTD
  const sumRight = rightX + colW;
  const curRight = sumRight - 90;
  let sy = sectionTop - 12;
  right("CURRENT", curRight, sy, 7.5, bold, GRAY);
  right("YTD", sumRight, sy, 7.5, bold, GRAY);
  sy -= 6;
  page.drawLine({ start: { x: rightX, y: sy }, end: { x: sumRight, y: sy }, thickness: 0.5, color: LINE });
  const sumRow = (lbl: string, cur: number, ytd: number) => {
    sy -= 19;
    text(lbl, rightX, sy, 9.5, font, GRAY);
    right(formatCents(cur), curRight, sy, 9.5, font, INK);
    right(formatCents(ytd), sumRight, sy, 9.5, font, INK);
  };
  sumRow("Gross earnings", gross, ytdGross);
  sumRow("Deductions / withholdings", 0, 0);
  sy -= 30;
  page.drawRectangle({ x: rightX - 8, y: sy - 8, width: sumRight - (rightX - 8) + 8, height: 30, color: DARK });
  text("NET PAY", rightX, sy + 2, 11.5, bold, rgb(1, 1, 1));
  right(formatCents(gross), curRight, sy + 2, 11.5, bold, rgb(1, 1, 1));
  right(formatCents(ytdGross), sumRight, sy + 2, 11.5, bold, ORANGE);

  // Acknowledgement / signature — anchored toward the bottom to balance the page.
  let ay = 168;
  text("ACKNOWLEDGEMENT", M, ay, 8.5, bold, INK);
  ay -= 14;
  text("I confirm the earnings shown above for this period are accurate.", M, ay, 8.5, font, GRAY);
  ay -= 44;
  page.drawLine({ start: { x: M, y: ay }, end: { x: M + 230, y: ay }, thickness: 0.6, color: INK });
  page.drawLine({ start: { x: W - M - 160, y: ay }, end: { x: W - M, y: ay }, thickness: 0.6, color: INK });
  text("Employee signature", M, ay - 12, 8, font, GRAY);
  text("Date", W - M - 160, ay - 12, 8, font, GRAY);

  // Footer
  page.drawLine({ start: { x: M, y: 60 }, end: { x: W - M, y: 60 }, thickness: 0.5, color: LINE });
  text(
    `Confidential  ·  Summary of earnings for the period; no taxes or withholdings are deducted by the platform.  ·  Generated ${formatDate(new Date())}.`,
    M, 49, 7.5, font, GRAY
  );
}

export async function buildPayStubPdf(data: NonNullable<PayStubData>): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(doc);
  drawStub(doc, font, bold, logo, data);
  return Buffer.from(await doc.save());
}

export async function buildCombinedPayStubsPdf(list: NonNullable<PayStubData>[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(doc);
  for (const data of list) drawStub(doc, font, bold, logo, data);
  return Buffer.from(await doc.save());
}
