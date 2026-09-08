import { prisma } from "@/server/db/client";
import { getStormConfig } from "@/server/modules/storm/config";
import { importSpcDay } from "@/server/modules/storm/import-spc";
import { recomputeStormMatches } from "@/server/modules/storm/matches";
import { assertCronRequest } from "@/server/auth/cron";

// Daily SPC storm-report ingest. Pulls today's (rolling alias) and yesterday's
// (finalized) hail/wind/tornado reports for every company, within each company's
// search region, then recomputes property matches. Vercel Cron + Bearer CRON_SECRET
// (required — the route refuses when it is unset).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    const companies = await prisma.company.findMany({ select: { id: true } });
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);

    let imported = 0;
    for (const c of companies) {
      const cfg = await getStormConfig(c.id);
      const a = await importSpcDay(c.id, today, cfg.center, cfg.radiusMiles, true);
      const b = await importSpcDay(c.id, yesterday, cfg.center, cfg.radiusMiles, false);
      imported += [...a, ...b].reduce((n, r) => n + r.imported, 0);
      await recomputeStormMatches(c.id);
    }

    return Response.json({ ok: true, companies: companies.length, imported });
  } catch (err) {
    console.error("[cron:storm-spc] failed", err);
    return new Response("Error", { status: 500 });
  }
}
