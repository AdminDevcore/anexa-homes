import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getBookkeepingData } from "@/server/modules/bookkeeping/queries";
import { buildBalanceSheetPdf } from "@/server/modules/bookkeeping/pdf";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Bookkeeping")) return new Response("Forbidden", { status: 403 });
  const [company, data] = await Promise.all([
    prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true, address: true, city: true, state: true, zip: true, phone: true, email: true } }),
    getBookkeepingData(user.companyId),
  ]);
  if (!company) return new Response("Not found", { status: 404 });
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const pdf = await buildBalanceSheetPdf(company, data.balanceSheet, asOf);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="balance-sheet-${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
