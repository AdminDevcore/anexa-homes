import { prisma } from "@/server/db/client";
import { chaseTiming } from "@/lib/stage-status";
import { stageOwnerRbacRole, stageOwnerLabel, BLOCKER_LABEL } from "@/lib/solar-pipeline";

/**
 * Follow-up reminders for deals sitting in EXTERNALLY-BLOCKED stages.
 *
 * The counterpart to runStageAlerts(), and deliberately a different mechanism.
 * A permit in plan review for 21 days is not late — plan review takes what it
 * takes. What is actionable is whether anyone has chased it recently, so this
 * job measures days since OUR last touch and nags on a repeating cadence.
 *
 * Three things it deliberately does NOT do:
 *   • never sets stageOverdue — the deal is not late, we are just waiting
 *   • never escalates as a failure — the copy says "follow up", not "overdue"
 *   • never fires for internally-owned stages (runStageAlerts owns those)
 *
 * Repeats rather than firing once: `lastChaseAlertAt` advances each time, so a
 * deal waiting three months on a utility gets chased every cadence instead of
 * being reminded once in week one and then forgotten.
 */
export async function runChaseReminders(now: number = Date.now()) {
  const leads = await prisma.lead.findMany({
    where: {
      status: "open",
      stage: { stageType: "externally_blocked", followUpDays: { gt: 0 } },
    },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      stageChangedAt: true,
      lastTouchAt: true,
      lastChaseAlertAt: true,
      blockedBy: true,
      blockerNote: true,
      assignedRepId: true,
      stage: {
        select: { name: true, followUpDays: true, ownerRole: true, defaultBlocker: true },
      },
    },
  });

  const ownerCache = new Map<string, string[]>();
  let reminders = 0;

  for (const lead of leads) {
    const stage = lead.stage;
    if (!stage) continue;

    const timing = chaseTiming(
      lead.lastTouchAt,
      lead.stageChangedAt,
      lead.createdAt,
      stage.followUpDays,
      now
    );
    if (timing.status !== "chase_due" && timing.status !== "chase_overdue") continue;

    // Don't re-nag inside the same cadence window.
    if (lead.lastChaseAlertAt) {
      const sinceAlert = (now - new Date(lead.lastChaseAlertAt).getTime()) / 86_400_000;
      if (sinceAlert < stage.followUpDays) continue;
    }

    // Route to the stage's owning department role — the Interconnection
    // Coordinator chases the utility, not the deal's sales rep.
    const ids = new Set<string>();
    const ownerRbac = stageOwnerRbacRole(stage.ownerRole);
    if (ownerRbac) {
      const cacheKey = `${lead.companyId}:${ownerRbac}`;
      let owners = ownerCache.get(cacheKey);
      if (!owners) {
        owners = (
          await prisma.user.findMany({
            where: { companyId: lead.companyId, status: "active", deletedAt: null, role: ownerRbac },
            select: { id: true },
          })
        ).map((u) => u.id);
        ownerCache.set(cacheKey, owners);
      }
      owners.forEach((id) => ids.add(id));
    }
    if (ids.size === 0 && lead.assignedRepId) ids.add(lead.assignedRepId);
    if (ids.size === 0) {
      await prisma.lead.update({ where: { id: lead.id }, data: { lastChaseAlertAt: new Date(now) } });
      continue;
    }

    const customer = `${lead.firstName} ${lead.lastName}`.trim() || "Deal";
    const blocker = lead.blockedBy ?? stage.defaultBlocker;
    const waitingOn = blocker ? BLOCKER_LABEL[blocker] : "a third party";
    const owner = stageOwnerLabel(stage.ownerRole);

    const title = `📞 Follow up: ${customer} — waiting on ${waitingOn}${owner ? ` [${owner}]` : ""}`;
    const body = timing.neverTouched
      ? `${customer} has been in "${stage.name}" for ${timing.daysSinceTouch} day${timing.daysSinceTouch === 1 ? "" : "s"} with no follow-up logged. Waiting on ${waitingOn}.${lead.blockerNote ? ` Note: ${lead.blockerNote}` : ""}`
      : `${timing.daysSinceTouch} day${timing.daysSinceTouch === 1 ? "" : "s"} since we last chased ${waitingOn} on ${customer} ("${stage.name}").${lead.blockerNote ? ` Note: ${lead.blockerNote}` : ""}`;

    await prisma.notification.createMany({
      data: [...ids].map((userId) => ({
        companyId: lead.companyId,
        userId,
        event: "stage_changed" as const,
        title,
        body,
        link: `/portal/leads/${lead.id}`,
        channel: "in_app" as const,
      })),
    });

    await prisma.lead.update({ where: { id: lead.id }, data: { lastChaseAlertAt: new Date(now) } });
    reminders++;
  }

  return { processed: leads.length, reminders };
}
