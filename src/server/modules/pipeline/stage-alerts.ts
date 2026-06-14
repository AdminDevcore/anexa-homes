import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { daysInStage } from "@/lib/stage-status";

/**
 * Scan open deals in SLA-tracked stages and fire stage-duration alerts +
 * escalations per each stage's settings. Idempotent across runs via the lead's
 * stageAlertLevel (0 none -> 1 target alert -> 2 escalation), which resets on
 * every stage move. Designed to run daily from a cron route.
 */
export async function runStageAlerts(now: number = Date.now()) {
  const leads = await prisma.lead.findMany({
    where: { status: "open", stageAlertLevel: { lt: 2 }, stage: { targetDays: { gt: 0 } } },
    select: {
      id: true, companyId: true, firstName: true, lastName: true, createdAt: true,
      stageChangedAt: true, stageAlertLevel: true, assignedRepId: true, createdById: true,
      assignedRep: { select: { managerId: true } },
      stage: {
        select: {
          name: true, targetDays: true, escalationDays: true, notificationRecipient: true,
          sendInApp: true, sendEmail: true, markOverdue: true,
        },
      },
    },
  });

  const deptCache = new Map<string, string[]>();
  const everyoneCache = new Map<string, string[]>();
  const brandCache = new Map<string, Awaited<ReturnType<typeof emailBrandFor>>>();
  let alerts = 0;

  for (const lead of leads) {
    const stage = lead.stage;
    if (!stage) continue;
    const days = daysInStage(lead.stageChangedAt, lead.createdAt, now);
    const target = stage.targetDays;
    const escDays = stage.escalationDays;
    const escalating = escDays > 0 && days >= target + escDays && lead.stageAlertLevel < 2;
    const targeting = days >= target && lead.stageAlertLevel < 1;
    if (!targeting && !escalating) continue;

    const level = escalating ? 2 : 1;
    const overdueData = stage.markOverdue && days > target ? { stageOverdue: true } : {};

    if (stage.notificationRecipient === "none" || (!stage.sendInApp && !stage.sendEmail)) {
      // Advance the level so we don't reconsider every run; still flag overdue.
      await prisma.lead.update({ where: { id: lead.id }, data: { stageAlertLevel: level, ...overdueData } });
      continue;
    }

    // Resolve recipients from the stage setting.
    const ids = new Set<string>();
    const r = stage.notificationRecipient;
    if (r === "assigned_user" && lead.assignedRepId) ids.add(lead.assignedRepId);
    if (r === "team_manager" && lead.assignedRep?.managerId) ids.add(lead.assignedRep.managerId);
    if (r === "project_owner" && lead.createdById) ids.add(lead.createdById);
    if (r === "department_manager") {
      let d = deptCache.get(lead.companyId);
      if (!d) {
        d = (await prisma.user.findMany({ where: { companyId: lead.companyId, status: "active", deletedAt: null, role: { in: ["manager", "admin", "super_admin"] } }, select: { id: true } })).map((u) => u.id);
        deptCache.set(lead.companyId, d);
      }
      d.forEach((id) => ids.add(id));
    }
    if (r === "everyone") {
      let e = everyoneCache.get(lead.companyId);
      if (!e) {
        e = (await prisma.user.findMany({ where: { companyId: lead.companyId, status: "active", deletedAt: null, role: { not: "customer" } }, select: { id: true } })).map((u) => u.id);
        everyoneCache.set(lead.companyId, e);
      }
      e.forEach((id) => ids.add(id));
    }

    const recipients = await prisma.user.findMany({
      where: { id: { in: [...ids] }, companyId: lead.companyId, status: "active", deletedAt: null },
      select: { id: true, email: true },
    });

    if (recipients.length) {
      const customer = `${lead.firstName} ${lead.lastName}`.trim() || "Deal";
      const link = `/portal/leads/${lead.id}`;
      const title = escalating ? `⏱ Escalation: ${customer} — ${stage.name}` : `⏱ ${customer} — ${stage.name} overdue`;
      const body = escalating
        ? `${customer} exceeded the allowed time in "${stage.name}" by ${days - target} day${days - target === 1 ? "" : "s"} (target ${target}).`
        : `${customer} has been in "${stage.name}" for ${days} day${days === 1 ? "" : "s"} and requires attention (target ${target}).`;

      if (stage.sendInApp) {
        await prisma.notification.createMany({
          data: recipients.map((u) => ({ companyId: lead.companyId, userId: u.id, event: "stage_changed" as const, title, body, link, channel: "in_app" as const })),
        });
      }
      if (stage.sendEmail) {
        let brand = brandCache.get(lead.companyId);
        if (!brand) { brand = await emailBrandFor(lead.companyId); brandCache.set(lead.companyId, brand); }
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
        const tpl = brandedEmailTemplate({ brand: brand.brand, subject: title, heading: title, paragraphs: [body], cta: { label: "View in portal", url: `${appUrl}${link}` } });
        for (const u of recipients) if (u.email) await sendEmail(u.email, tpl.subject, tpl.text, { fromName: brand.fromName, html: tpl.html });
      }
      alerts++;
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { stageAlertLevel: level, ...overdueData } });
  }

  return { processed: leads.length, alerts };
}
