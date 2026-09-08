import { runUnscoped } from "@/server/vertical/context";
import { runStageAgeAutomations } from "@/server/modules/automations/stage-age";
import { assertCronRequest } from "@/server/auth/cron";

// Daily sweep for "deal has sat in this stage too long" automations. Vercel
// Cron calls this with `Authorization: Bearer <CRON_SECRET>`. Refuses when
// CRON_SECRET is unset.
//
// The other three triggers ride on something a person did and fire instantly.
// This one has nobody behind it, so it needs a clock.
//
// VERIFY ANY CHANGE ON A PRODUCTION BUILD. `next dev` loads context.ts twice,
// so runInVertical silently no-ops there — a solar rule would appear to work
// while firing on roofing deals, with nothing in the log to say so.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    // Unscoped to FIND the work — one pass has to see every workspace's rules.
    // Acting on it is scoped again inside runAutomations.
    const fired = await runUnscoped(
      "cron: stage-age automation sweep, all verticals",
      () => runStageAgeAutomations()
    );
    return Response.json({ ok: true, fired });
  } catch (err) {
    console.error("[cron:automations] failed", err);
    return new Response("Error", { status: 500 });
  }
}
