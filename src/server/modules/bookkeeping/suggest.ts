import { prisma } from "@/server/db/client";

type Cat = { id: string; name: string };
type Vend = { id: string; name: string };

// Keyword → category-name rules. First match wins.
const CATEGORY_RULES: [RegExp, string][] = [
  [/insurance|state farm|allstate|farmers|claim|depreciation release/i, "Insurance Proceeds"],
  [/customer deposit|deposit from|payment received|invoice paid|zelle from|check from/i, "Job Revenue"],
  [/supply|shingle|material|beacon|srs|home depot|lowe'?s|abc supply|underlayment/i, "Materials"],
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

  // 3) Category by keyword.
  if (!categoryId) {
    for (const [re, name] of CATEGORY_RULES) {
      if (re.test(text)) { const id = byName(name); if (id) { categoryId = id; break; } }
    }
  }

  return { categoryId, vendor };
}
