import type { ProjectStatus } from "@prisma/client";
import { fireEvent } from "@/server/modules/notifications/engine";

/**
 * Announce that a job's status moved.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `project_status_changed` is one of the fourteen events an admin can build a
 * notification rule on in Settings → Notifications. Until now it could never
 * fire: the ONLY caller of `fireEvent` for it was
 * `projects/actions.ts:updateProjectStatusAction`, which no UI has reached
 * since the job editor replaced it. A rule you can configure and that can never
 * fire is worse than no rule at all — it reads as "we are watching this" and
 * nobody is.
 *
 * There is no single canonical status transition in this application. As of
 * 2026-09-05 the live writers of `Project.status` are:
 *
 *   1. `projects/actions.ts:updateProjectAction`      — the admin Edit Job dialog
 *   2. `automations/actions/set-project-status.ts`    — an automation rule
 *   3. `leads/actions.ts` (cancel deal)               — cascades to `cancelled`
 *
 * plus `updateProjectStatusAction`, which is unreachable, and project creation,
 * which is not a transition. Rather than resurrect the dead action or invent a
 * fourth mechanism, all three live paths call this.
 *
 * ── WHY IT TAKES `from` ────────────────────────────────────────────────────
 * A no-op write is not a transition. The Edit Job dialog saves fifteen fields
 * at once and usually does not touch the status; firing on every save would put
 * "status changed to In production" in somebody's inbox because an address was
 * corrected. Callers pass the value they read BEFORE the write, and this
 * returns silently when nothing moved — which is also what stops a
 * double-notification if two of these paths ever run over one another.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────
 * `fireEvent` is already best-effort (it swallows its own errors) and no-ops
 * entirely when the company has no active rule for the event. So wiring this in
 * changes nothing for anybody who has not deliberately turned the rule on —
 * `project_status_changed` is not among the defaults seeded by
 * `notifications/defaults.ts`.
 *
 * Never call this inside a transaction: a notification for a change that then
 * rolls back is a lie. All three call sites fire after their write commits.
 */
export async function notifyProjectStatusChanged(args: {
  companyId: string;
  projectId: string;
  actorId: string | null;
  from: ProjectStatus | null | undefined;
  to: ProjectStatus;
}): Promise<void> {
  if (args.from === args.to) return;
  await fireEvent({
    companyId: args.companyId,
    event: "project_status_changed",
    actorId: args.actorId,
    projectId: args.projectId,
    status: args.to,
  });
}
