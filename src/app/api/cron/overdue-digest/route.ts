import { runOverdueDigest } from "@/server/modules/pipeline/overdue-digest";
import { assertCronRequest } from "@/server/auth/cron";

// Weekly "overdue jobs" digest to managers/admins. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>`. Refuses when CRON_SECRET is unset.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    const result = await runOverdueDigest();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:overdue-digest] failed", err);
    return new Response("Error", { status: 500 });
  }
}
