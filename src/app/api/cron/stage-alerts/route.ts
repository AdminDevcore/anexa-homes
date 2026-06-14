import { runStageAlerts } from "@/server/modules/pipeline/stage-alerts";

// Daily stage-duration alert sweep. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await runStageAlerts();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:stage-alerts] failed", err);
    return new Response("Error", { status: 500 });
  }
}
