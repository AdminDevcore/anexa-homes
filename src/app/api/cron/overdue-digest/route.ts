import { runOverdueDigest } from "@/server/modules/pipeline/overdue-digest";

// Weekly "overdue jobs" digest to managers/admins. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await runOverdueDigest();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:overdue-digest] failed", err);
    return new Response("Error", { status: 500 });
  }
}
