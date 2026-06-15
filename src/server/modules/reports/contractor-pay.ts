import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { Period, RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** Project ids inside the scope, or null for whole-company (no filter). */
async function scopeProjectIds(scope: ResolvedScope): Promise<string[] | null> {
  if (scope.isCompany) return null;
  const projects = await prisma.project.findMany({ where: { lead: scope.leadWhere }, select: { id: true } });
  return projects.map((p) => p.id);
}

/**
 * Money paid and still owed to the crews and contractors who do the work:
 *  - installer/crew payouts tracked as commissions (`rule.role = "installer"`)
 *  - 1099-vendor / labor payments from the bookkeeping ledger
 * Paid figures are for the selected period; owed is the current outstanding balance.
 */
export async function buildContractorPayReport(
  user: ReportUser,
  period: Period,
  scope: ResolvedScope,
): Promise<RenderableReport> {
  const inPeriod = { gte: period.from, lte: period.to };
  const projIds = await scopeProjectIds(scope);
  const txnProjectFilter = projIds ? { projectId: { in: projIds } } : {};

  const vendors1099 = await prisma.bookkeepingVendor.findMany({
    where: { companyId: user.companyId, is1099: true },
    select: { name: true },
  });
  const contractorNames = new Set(vendors1099.map((v) => v.name.toLowerCase()));

  const installerWhere: Prisma.CommissionWhereInput = {
    companyId: user.companyId,
    rule: { role: "installer" },
    ...(scope.isCompany ? {} : { project: { lead: scope.leadWhere } }),
  };

  const [installerComms, txns] = await Promise.all([
    prisma.commission.findMany({
      where: installerWhere,
      select: {
        amount: true,
        status: true,
        paidAt: true,
        user: { select: { firstName: true, lastName: true } },
        project: { select: { projectNumber: true, lead: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.transaction.findMany({
      where: { companyId: user.companyId, date: inPeriod, amountCents: { lt: 0 }, ...txnProjectFilter },
      select: { amountCents: true, vendor: true, category: { select: { name: true } } },
    }),
  ]);

  // Per-contractor tallies: installer name or 1099-vendor/category bucket.
  const byContractor = new Map<string, { paid: number; owed: number }>();
  const bump = (name: string, key: "paid" | "owed", cents: number) => {
    const e = byContractor.get(name) ?? { paid: 0, owed: 0 };
    e[key] += cents;
    byContractor.set(name, e);
  };

  // Installer/crew commissions.
  const jobRows: { project: string; customer: string; installer: string; amount: number; status: string }[] = [];
  for (const c of installerComms) {
    const name = `${c.user.firstName} ${c.user.lastName}`.trim() || "Crew";
    const paidInPeriod = c.status === "paid" && c.paidAt && c.paidAt >= period.from && c.paidAt <= period.to;
    if (paidInPeriod) bump(name, "paid", c.amount);
    if (c.status !== "paid") bump(name, "owed", c.amount);
    jobRows.push({
      project: c.project?.projectNumber ?? "—",
      customer: c.project?.lead ? `${c.project.lead.firstName} ${c.project.lead.lastName}`.trim() : "—",
      installer: name,
      amount: c.amount,
      status: c.status === "paid" ? "Paid" : "Owed",
    });
  }

  // 1099 vendor / labor payments from the ledger (paid, in period).
  for (const t of txns) {
    const out = -t.amountCents;
    const cat = t.category?.name ?? "";
    const is1099Vendor = !!(t.vendor && contractorNames.has(t.vendor.toLowerCase()));
    const isContractor = is1099Vendor || /contractor|subcontractor|labor|crew/i.test(cat);
    if (!isContractor) continue;
    const bucket = is1099Vendor ? t.vendor! : cat || "Contractor / labor";
    bump(bucket, "paid", out);
  }

  const contractorRows = [...byContractor.entries()]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => b.paid + b.owed - (a.paid + a.owed));

  const totalPaid = contractorRows.reduce((s, r) => s + r.paid, 0);
  const totalOwed = contractorRows.reduce((s, r) => s + r.owed, 0);

  jobRows.sort((a, b) => b.amount - a.amount);

  return {
    title: "Contractor Pay Report",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Paid to contractors", value: usd(totalPaid), tone: "neg", hint: "in period" },
      { label: "Owed to contractors", value: usd(totalOwed), hint: "outstanding" },
      { label: "Contractors", value: String(contractorRows.length), hint: "with activity" },
    ],
    tables: [
      {
        title: "Pay by contractor",
        columns: ["Contractor", "Paid (in period)", "Owed", "Total"],
        rows: [
          ...contractorRows.map((r) => [r.name, usd(r.paid), usd(r.owed), usd(r.paid + r.owed)]),
          ...(contractorRows.length ? [["Total", usd(totalPaid), usd(totalOwed), usd(totalPaid + totalOwed)]] : []),
        ],
      },
      {
        title: "Installer payouts by job",
        columns: ["Job #", "Customer", "Installer", "Amount", "Status"],
        rows: jobRows.map((r) => [r.project, r.customer, r.installer, usd(r.amount), r.status]),
      },
    ],
  };
}
