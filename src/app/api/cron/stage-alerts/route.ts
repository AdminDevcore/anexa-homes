import { runStageAlerts } from "@/server/modules/pipeline/stage-alerts";
import { runChaseReminders } from "@/server/modules/pipeline/chase-reminders";
import { runUnscoped } from "@/server/vertical/context";
import { assertCronRequest } from "@/server/auth/cron";

// Daily pipeline sweep. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>`. Refuses when CRON_SECRET is unset.
//
// Two passes, deliberately separate:
//   runStageAlerts     — internally-owned stages: hard SLA, escalating to the
//                        owning department role when we blow our own deadline.
//   runChaseReminders  — externally-blocked stages: follow-up cadence measured
//                        from our last touch. Never reports a deal as overdue,
//                        because a utility's queue is not our team being late.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    // Sweeps every vertical: each stage carries its own type, owner and cadence,
    // so roofing and solar are handled correctly by the same pass.
    const result = await runUnscoped(
      "cron: pipeline SLA + follow-up sweep, all verticals",
      async () => {
        const alerts = await runStageAlerts();
        const chases = await runChaseReminders();
        return { alerts, chases };
      }
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:stage-alerts] failed", err);
    return new Response("Error", { status: 500 });
  }
}
