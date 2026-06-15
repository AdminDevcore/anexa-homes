import { prisma } from "@/server/db/client";
import type { RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

// Claims no longer in play — money is settled or the claim is dead.
const CLOSED = new Set(["paid", "closed", "denied"]);

/**
 * Insurance claims & supplement capture — a current snapshot (not period-bound,
 * so old open claims stay visible). Surfaces RCV/ACV exposure, recoverable
 * depreciation, the claim funnel by status, and how much of requested supplement
 * dollars are actually getting approved.
 */
export async function buildClaimsReport(user: ReportUser, scope: ResolvedScope): Promise<RenderableReport> {
  const claims = await prisma.claim.findMany({
    where: { companyId: user.companyId, ...(scope.isCompany ? {} : { lead: scope.leadWhere }) },
    select: {
      status: true,
      rcv: true,
      acv: true,
      depreciation: true,
      supplements: { select: { requestedAmount: true, approvedAmount: true } },
    },
  });

  let rcv = 0, acv = 0, depreciation = 0, suppReq = 0, suppApp = 0, active = 0;
  const byStatus = new Map<string, { count: number; rcv: number }>();
  for (const c of claims) {
    rcv += c.rcv; acv += c.acv; depreciation += c.depreciation;
    if (!CLOSED.has(c.status)) active++;
    for (const s of c.supplements) { suppReq += s.requestedAmount; suppApp += s.approvedAmount; }
    const e = byStatus.get(c.status) ?? { count: 0, rcv: 0 };
    e.count += 1; e.rcv += c.rcv;
    byStatus.set(c.status, e);
  }

  const captureRate = suppReq > 0 ? (suppApp / suppReq) * 100 : 0;
  const statusLabel = (s: string) => s.replace(/_/g, " ");
  // Claim funnel display order.
  const ORDER = ["not_filed", "filed", "adjuster_scheduled", "scope_received", "supplement_needed", "approved", "paid", "denied", "closed"];
  const statusRows = [...byStatus.entries()]
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([s, e]) => [statusLabel(s), e.count, usd(e.rcv)]);

  return {
    title: "Claims & Supplement Capture",
    periodLabel: "Current",
    scopeLabel: scope.label,
    metrics: [
      { label: "Active claims", value: String(active), hint: "open" },
      { label: "Total RCV", value: usd(rcv), tone: "pos" },
      { label: "Total ACV", value: usd(acv) },
      { label: "Recoverable depreciation", value: usd(depreciation), hint: "held by carrier" },
      { label: "Supplements requested", value: usd(suppReq) },
      { label: "Supplements approved", value: usd(suppApp), tone: "pos" },
      { label: "Capture rate", value: pct(captureRate), tone: captureRate >= 70 ? "pos" : "neg", hint: "approved / requested" },
      { label: "Claims", value: String(claims.length), hint: "total" },
    ],
    tables: [
      {
        title: "Claims by status",
        columns: ["Status", "Claims", "RCV"],
        rows: statusRows,
      },
      {
        title: "Supplement capture",
        columns: ["Metric", "Amount"],
        rows: [
          ["Requested", usd(suppReq)],
          ["Approved", usd(suppApp)],
          ["Outstanding", usd(Math.max(0, suppReq - suppApp))],
          ["Capture rate", pct(captureRate)],
        ],
      },
    ],
  };
}
