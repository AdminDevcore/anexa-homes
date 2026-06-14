import { prisma } from "@/server/db/client";

type Cat = { id: string; name: string };
type Vend = { id: string; name: string };

// Keyword → category-name rules. First match wins.
const CATEGORY_RULES: [RegExp, string][] = [
  [/insurance|state farm|allstate|farmers|claim|depreciation release/i, "Insurance Proceeds"],
  [/customer deposit|deposit from|payment received|invoice paid|zelle from|check from/i, "Job Revenue"],
  [/suppl(y|ier|ies)|shingle|material|beacon|srs|home depot|lowe'?s|abc supply|underlayment|gutter|flashing|drip edge/i, "Materials"],
  [/crew|sub-?contractor|labor|install(er)?|diaz|payout/i, "Subcontractor Labor"],
  [/payroll|salary|wages|adp|gusto|direct deposit payroll/i, "Payroll"],
  [/facebook|meta|google ?ads|adwords|marketing|lead ?gen|ad spend|hubspot|angi/i, "Marketing / Leads"],
  [/rent|office|overhead|utilit|electric|water bill|internet|plaza|insurance premium/i, "Office & Overhead"],
  [/equipment|tool|nail gun|ladder|compressor|trailer/i, "Equipment & Tools"],
];

const norm = (s: string) => s.toLowerCase().replace(/\d+/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Suggest a categoryId + vendor name for a transaction, using (in priority):
 *  1) history — a previously APPROVED transaction with the same normalized description,
 *  2) a known vendor name appearing in the text,
 *  3) keyword → category rules.
 */
export async function suggestForTransaction(
  companyId: string,
  description: string,
  account: string | null,
  categories: Cat[],
  vendors: Vend[]
): Promise<{ categoryId: string | null; vendor: string | null }> {
  const text = `${description} ${account ?? ""}`.toLowerCase();
  const byName = (n: string) => categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id ?? null;

  let categoryId: string | null = null;
  let vendor: string | null = null;

  // 1) History — same description booked before.
  const key = norm(description);
  if (key) {
    const prior = await prisma.transaction.findMany({
      where: { companyId, approved: true },
      orderBy: { date: "desc" },
      take: 300,
      select: { description: true, categoryId: true, vendor: true },
    });
    const match = prior.find((p) => norm(p.description) === key);
    if (match) { categoryId = match.categoryId; vendor = match.vendor; }
  }

  // 2) Vendor by name in the text.
  if (!vendor) {
    const v = vendors.find((vv) => vv.name && text.includes(vv.name.toLowerCase()));
    if (v) vendor = v.name;
  }

  // 2.5) Category from the vendor's history — the system "learns" each vendor's
  // usual category (e.g. ABC Supplier → Materials) from past approved transactions.
  if (!categoryId && vendor) {
    const prior = await prisma.transaction.findMany({
      where: { companyId, approved: true, vendor: { equals: vendor, mode: "insensitive" }, categoryId: { not: null } },
      orderBy: { date: "desc" },
      take: 200,
      select: { categoryId: true },
    });
    const counts = new Map<string, number>();
    for (const p of prior) if (p.categoryId) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n; }
    if (best) categoryId = best;
  }

  // 3) Category by keyword.
  if (!categoryId) {
    for (const [re, name] of CATEGORY_RULES) {
      if (re.test(text)) { const id = byName(name); if (id) { categoryId = id; break; } }
    }
  }

  return { categoryId, vendor };
}
