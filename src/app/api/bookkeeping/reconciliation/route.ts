import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { buildReconciliationPdf } from "@/server/modules/bookkeeping/pdf";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Bookkeeping")) return new Response("Forbidden", { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const [company, recon] = await Promise.all([
    prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true, address: true, city: true, state: true, zip: true, phone: true, email: true } }),
    prisma.reconciliation.findFirst({
      where: { id, companyId: user.companyId },
      include: { transactions: { orderBy: { date: "asc" }, select: { date: true, description: true, amountCents: true } } },
    }),
  ]);
  if (!company || !recon) return new Response("Not found", { status: 404 });

  const statementDate = recon.statementDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const pdf = await buildReconciliationPdf(
    company,
    {
      account: recon.account,
      statementDate,
      beginningBalanceCents: recon.beginningBalanceCents,
      endingBalanceCents: recon.endingBalanceCents,
    },
    recon.transactions.map((t) => ({ date: t.date.toISOString(), description: t.description, amountCents: t.amountCents })),
  );
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reconciliation-${recon.statementDate.toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
