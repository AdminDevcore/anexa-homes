import type { ActiveVertical } from "@/lib/vertical";
import { runInVertical } from "@/server/vertical/context";

/**
 * Tell people a run failed or needs a human.
 *
 * Inside the run's workspace, because NotificationRule is workspace-scoped and
 * fireEvent swallows the missing-workspace error: fired outside one, it would
 * notify nobody and say nothing (agents-access-recipients.itest.ts proves it).
 *
 * Loaded lazily and wrapped: the run row is the record, and must survive the
 * notifier failing to load.
 */
export async function notifyRun(run: {
  companyId: string;
  vertical: ActiveVertical;
  leadId: string | null;
  status: "failed" | "needs_human";
  summary: string;
  agentName: string;
}): Promise<void> {
  try {
    const { fireEvent } = await import("@/server/modules/notifications/engine");
    await runInVertical(run.vertical, () =>
      fireEvent({
        companyId: run.companyId,
        event: run.status === "failed" ? "agent_run_failed" : "agent_needs_human",
        leadId: run.leadId,
        vertical: run.vertical,
        status: run.summary,
        agentName: run.agentName,
      })
    );
  } catch (err) {
    console.error("[agents] could not send a run notification", run.agentName, err);
  }
}
