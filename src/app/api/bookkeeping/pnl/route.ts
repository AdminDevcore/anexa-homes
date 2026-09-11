import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getBookkeepingData } from "@/server/modules/bookkeeping/queries";
import { buildPnlPdf } from "@/server/modules/bookkeeping/pdf";

export async function GET(req: Request) {
  const user = await getSessionUser();
  // A download is `export`, not `read`. Same grant list either way today
  // (super_admin + accounting), but the 1099 CSV carries recipient TINs and
  // the books leave the product as a file — so the verb that exists to be
  // withheld is the one that has to be asked for.
  if (!user || !can(user, "export", "Bookkeeping")) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const startMs = url.searchParams.get("start");
  const endMs = url.searchParams.get("end");
  const period = startMs || endMs ? { startMs: startMs ? Number(startMs) : null, endMs: endMs ? Number(endMs) : null } : undefined;
  const [company, data] = await Promise.all([
    prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true, address: true, city: true, state: true, zip: true, phone: true, email: true } }),
    getBookkeepingData(user.companyId, period),
  ]);
  if (!company) return new Response("Not found", { status: 404 });
  const asOf = url.searchParams.get("label") || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const pdf = await buildPnlPdf(company, data.pnl, asOf);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="profit-and-loss-${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}
