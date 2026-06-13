import { prisma } from "@/server/db/client";

// 1099-NEC threshold: report nonemployee compensation at $600+ for the year.
export const REPORTABLE_THRESHOLD_CENTS = 600_00;

export type Vendor1099Row = {
  vendorId: string;
  name: string;
  legalName: string | null;
  einTaxId: string | null;
  address: string;
  totalCents: number; // Box 1 — nonemployee compensation paid this year
  reportable: boolean; // total >= $600
  missing: string[]; // info needed before filing
};

export type Report1099 = {
  year: number;
  payer: { name: string; einTaxId: string | null; address: string };
  rows: Vendor1099Row[];
  reportableCount: number;
  totalCents: number;
};

function addr(a: string | null, city: string | null, state: string | null, zip: string | null): string {
  const line2 = [city, state, zip].filter(Boolean).join(", ");
  return [a, line2].filter(Boolean).join(" · ");
}

/**
 * Year-end 1099-NEC roll-up: for each vendor flagged `is1099`, total the BOOKED
 * money-out transactions paid to them in the tax year (matched by vendor name),
 * with the recipient data and a readiness check. Matched by name because
 * transactions store the vendor as text, not a FK.
 */
export async function get1099Report(companyId: string, year: number): Promise<Report1099> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const [company, vendors, txns] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, city: true, state: true, zip: true, einTaxId: true },
    }),
    prisma.bookkeepingVendor.findMany({
      where: { companyId, is1099: true },
      select: { id: true, name: true, companyName: true, einTaxId: true, address: true, city: true, state: true, zip: true },
    }),
    prisma.transaction.findMany({
      where: { companyId, approved: true, amountCents: { lt: 0 }, date: { gte: start, lt: end } },
      select: { vendor: true, amountCents: true },
    }),
  ]);

  // Total money-out by normalized vendor name.
  const paidByName = new Map<string, number>();
  for (const t of txns) {
    if (!t.vendor) continue;
    const key = t.vendor.trim().toLowerCase();
    paidByName.set(key, (paidByName.get(key) ?? 0) + -t.amountCents);
  }

  const rows: Vendor1099Row[] = vendors
    .map((v) => {
      const totalCents = paidByName.get(v.name.trim().toLowerCase()) ?? 0;
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
