import { prisma } from "@/server/db/client";
import { recomputeStormMatches } from "@/server/modules/storm/matches";
import { assertCronRequest } from "@/server/auth/cron";

// Safety-net daily recompute of storm→property matches across all companies
// (imports already recompute inline; this catches new/geocoded leads + knocks).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    const companies = await prisma.company.findMany({ select: { id: true } });
    let leadMatches = 0;
    let knockMatches = 0;
    for (const c of companies) {
      const r = await recomputeStormMatches(c.id);
      leadMatches += r.leadMatches;
      knockMatches += r.knockMatches;
    }
    return Response.json({ ok: true, companies: companies.length, leadMatches, knockMatches });
  } catch (err) {
    console.error("[cron:storm-matches] failed", err);
    return new Response("Error", { status: 500 });
  }
}
