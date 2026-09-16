import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * YEAR-END 1099-NEC, TOTALLED BY VENDOR ID.
 *
 * ── WHAT CHANGED, AND WHY IT MATTERED ───────────────────────────────────────
 * The previous roll-up matched a vendor to their money by NAME:
 *
 *     paidByName.set(txn.vendor.trim().toLowerCase(), …)
 *
 * because the single-entry ledger stored the vendor as free text. Every way
 * that can go wrong is a filing error. "Acme Roofing LLC" and "Acme Roofing"
 * were two payees; correcting a vendor's name orphaned every payment made
 * under the old spelling and the total silently fell — sometimes below the
 * $600 threshold, which does not produce a wrong form, it produces NO form.
 * `updateVendorAction` even re-pointed transactions on rename to paper over
 * this, which worked only for rows that already matched exactly.
 *
 * JournalLine.vendorId is a real foreign key, so this is now a GROUP BY on an
 * id. A renamed vendor keeps their history; two vendors with the same name stay
 * separate; a typo cannot invent a payee.
 *
 * ── BASIS ───────────────────────────────────────────────────────────────────
 * A 1099 reports what was PAID in the calendar year, so this totals cash: lines
 * on entries that actually moved money out of a bank or card account. Accruing
 * a bill in December and paying it in January is reportable in January, and
 * that is what the `paid` basis computes. `accrued` is offered for
 * reconciliation against the P&L, which is kept on accrual — the two will
 * legitimately differ, and being able to see by how much is the point.
 */

// 1099-NEC threshold: report nonemployee compensation at $600+ for the year.
export const REPORTABLE_THRESHOLD_CENTS = 600_00;

export type Tax1099Basis = "paid" | "accrued";

export type Vendor1099Row = {
  vendorId: string;
  name: string;
  legalName: string | null;
  einTaxId: string | null;
  address: string;
  totalCents: number; // Box 1 — nonemployee compensation
  reportable: boolean; // total >= $600
  missing: string[]; // info needed before filing
};

export type Report1099 = {
  year: number;
  basis: Tax1099Basis;
  payer: { name: string; einTaxId: string | null; address: string };
  rows: Vendor1099Row[];
  reportableCount: number;
  totalCents: number;
};

function addr(a: string | null, city: string | null, state: string | null, zip: string | null): string {
  const line2 = [city, state, zip].filter(Boolean).join(", ");
  return [a, line2].filter(Boolean).join(" · ");
}

export async function get1099Report(
  companyId: string,
  year: number,
  basis: Tax1099Basis = "paid"
): Promise<Report1099> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const [company, vendors] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, city: true, state: true, zip: true, einTaxId: true },
    }),
    prisma.bookkeepingVendor.findMany({
      where: { companyId, is1099: true },
      select: {
        id: true, name: true, companyName: true, einTaxId: true,
        address: true, city: true, state: true, zip: true,
      },
    }),
  ]);

  const totals = await totalsByVendor(companyId, start, end, basis);

  const rows: Vendor1099Row[] = vendors
    .map((v) => {
      const totalCents = totals.get(v.id) ?? 0;
      const reportable = totalCents >= REPORTABLE_THRESHOLD_CENTS;
      const missing: string[] = [];
      if (reportable) {
        if (!v.einTaxId) missing.push("EIN/TIN");
        if (!(v.address && v.city && v.state && v.zip)) missing.push("Address");
        if (!v.companyName) missing.push("Legal name");
      }
      return {
        vendorId: v.id,
        name: v.name,
        legalName: v.companyName,
        einTaxId: v.einTaxId,
        address: addr(v.address, v.city, v.state, v.zip),
        totalCents,
        reportable,
        missing,
      };
    })
    .filter((r) => r.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);

  return {
    year,
    basis,
    payer: {
      name: company?.name ?? "",
      einTaxId: company?.einTaxId ?? null,
      address: addr(company?.address ?? null, company?.city ?? null, company?.state ?? null, company?.zip ?? null),
    },
    rows,
    reportableCount: rows.filter((r) => r.reportable).length,
    totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
  };
}

/**
 * Money attributed to each vendor in the year, keyed by vendor ID.
 *
 * A VOID AND ITS REVERSAL BOTH COUNT, AND CANCEL. A voided cheque nets to zero
 * through its reversing entry, so it leaves the 1099 on its own. Filtering
 * `entry.status = posted` would drop the original while keeping the reversal
 * and take the vendor NEGATIVE by the amount of the voided cheque — which is
 * how a filing error gets made by a filter that reads like a safety check.
 */
async function totalsByVendor(
  companyId: string,
  start: Date,
  end: Date,
  basis: Tax1099Basis
): Promise<Map<string, number>> {
  /**
   * `paid` follows the money: the vendor's own line on an entry that ALSO moved
   * a bank or card account. That is what "paid" means, and it is why the filter
   * reaches through the entry rather than looking at the vendor's line alone.
   * `accrued` follows the expense, whenever it was recognised.
   *
   * DECLARED, NOT SPREAD INLINE. Built with conditional spreads inside the
   * `groupBy` call, the object's inferred type is a union that Prisma's
   * `Exact<>` constraint rejects — and the failure does not stop there: the
   * result type collapses to `{}` and every `_sum` read becomes an error
   * pointing at the wrong line. Naming the type puts the error where the
   * mistake is.
   */
  const settled: Prisma.JournalEntryWhereInput =
    basis === "paid"
      ? {
          lines: {
            some: {
              creditCents: { gt: 0 },
              account: { subtype: { in: ["bank", "credit_card"] } },
            },
          },
        }
      : {};

  const where: Prisma.JournalLineWhereInput = {
    companyId,
    vendorId: { not: null },
    entry: { date: { gte: start, lt: end }, ...settled },
    ...(basis === "accrued"
      ? { account: { type: { in: ["cogs", "expense", "other_expense"] } } }
      : {}),
  };

  const lines = await prisma.journalLine.groupBy({
    by: ["vendorId"],
    where,
    _sum: { debitCents: true, creditCents: true },
  });

  const totals = new Map<string, number>();
  for (const row of lines) {
    if (!row.vendorId) continue;
    // A vendor's compensation is a DEBIT to expense. A credit against them is a
    // refund or a correction and reduces the reportable total, which is why
    // this is a net rather than a sum of debits.
    const net = (row._sum.debitCents ?? 0) - (row._sum.creditCents ?? 0);
    if (net !== 0) totals.set(row.vendorId, net);
  }
  return totals;
}

/**
 * The individual lines behind one vendor's total — the drill-down Phase 3 needs,
 * and the thing that makes a disputed figure answerable.
 */
export async function vendor1099Detail(
  companyId: string,
  vendorId: string,
  year: number
): Promise<{ date: string; memo: string | null; accountName: string; amountCents: number }[]> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const lines = await prisma.journalLine.findMany({
    where: {
      companyId,
      vendorId,
      entry: { date: { gte: start, lt: end } },
    },
    orderBy: { entry: { date: "asc" } },
    select: {
      debitCents: true,
      creditCents: true,
      memo: true,
      entry: { select: { date: true, memo: true } },
      account: { select: { name: true } },
    },
  });

  return lines.map((l) => ({
    date: l.entry.date.toISOString(),
    memo: l.memo ?? l.entry.memo,
    accountName: l.account.name,
    amountCents: l.debitCents - l.creditCents,
  }));
}
