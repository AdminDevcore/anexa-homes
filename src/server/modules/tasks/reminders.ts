import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import {
  ageDays,
  isOverdue,
  buildRepDigest,
  buildManagerRollup,
  type DigestTask,
  type RepRollup,
} from "./reminder-digest";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUPE_DAYS = 5;

function rollupFor(tasksByRep: Map<string, { name: string; tasks: DigestTask[] }>, now: number): RepRollup[] {
  return [...tasksByRep.values()].map(({ name, tasks }) => ({
    name,
    count: tasks.length,
    overdue: tasks.filter((t) => isOverdue(t.dueAt, now)).length,
    oldestDays: tasks.reduce((m, t) => Math.max(m, ageDays(t.createdAt, now)), 0),
  }));
}

// ---------------------------------------------------------------------------
// Orchestrator — runs weekly from the cron route.
// ---------------------------------------------------------------------------

const dealName = (lead: { firstName: string; lastName: string } | null) =>
  lead ? `${lead.firstName} ${lead.lastName}`.trim() || "Deal" : "General";

/**
 * Weekly digest of OPEN follow-up tasks. Each rep gets their own open tasks;
 * each manager gets a rollup of their team; admins/super_admins get the whole
 * company. A manager/admin who ALSO has tasks assigned to them gets ONE combined
 * email carrying both their own follow-ups and their team rollup (we send at most
 * one message per person per run).
 * Idempotent within a week via the schedule + a 5-day per-recipient dedupe.
 */
export async function runTaskReminders(now: number = Date.now()) {
  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["todo", "in_progress"] },
      assigneeId: { not: null },
      assignee: { status: "active", deletedAt: null },
    },
    select: {
      title: true,
      dueAt: true,
      createdAt: true,
      companyId: true,
      assigneeId: true,
      assignee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          managerId: true,
          salesRep: { select: { managerId: true } },
        },
      },
      lead: { select: { firstName: true, lastName: true } },
    },
  });

  // Recipients already reminded in the last few days — guards a double cron fire.
  const recent = await prisma.notification.findMany({
    where: { event: "task_reminder", createdAt: { gte: new Date(now - DEDUPE_DAYS * DAY_MS) } },
    select: { userId: true },
  });
  const alreadyNotified = new Set(recent.map((r) => r.userId));

  // Group tasks by company, then by assignee.
  type Assignee = NonNullable<(typeof tasks)[number]["assignee"]>;
  const byCompany = new Map<string, { byRep: Map<string, { assignee: Assignee; tasks: DigestTask[] }> }>();
  for (const t of tasks) {
    if (!t.assignee) continue;
    const co = byCompany.get(t.companyId) ?? { byRep: new Map() };
    byCompany.set(t.companyId, co);
    const rep = co.byRep.get(t.assignee.id) ?? { assignee: t.assignee, tasks: [] };
    rep.tasks.push({ title: t.title, dealName: dealName(t.lead), createdAt: t.createdAt, dueAt: t.dueAt });
    co.byRep.set(t.assignee.id, rep);
  }

  // Companies that turned the weekly reminder off in Settings → Notifications.
  const settings = await prisma.companySettings.findMany({
    where: { companyId: { in: [...byCompany.keys()] } },
    select: { companyId: true, weeklyTaskRemindersEnabled: true },
  });
  const disabled = new Set(settings.filter((s) => !s.weeklyTaskRemindersEnabled).map((s) => s.companyId));

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  let repDigests = 0; // personal-only emails
  let managerDigests = 0; // team-rollup-only emails
  let combinedDigests = 0; // one email carrying BOTH the person's own tasks and their team rollup
  let skippedCompanies = 0;

  for (const [companyId, { byRep }] of byCompany) {
    if (disabled.has(companyId)) {
      skippedCompanies++;
      continue;
    }
    const brand = await emailBrandFor(companyId);
    const send = async (userId: string, email: string | null, subject: string, heading: string, lines: string[]) => {
      if (alreadyNotified.has(userId)) return false;
      alreadyNotified.add(userId); // never double-send within one run either
      await prisma.notification.create({
        data: { companyId, userId, event: "task_reminder", title: subject, body: heading, link: "/portal/tasks", channel: "in_app" },
      });
      if (email) {
        const tpl = brandedEmailTemplate({
          brand: brand.brand,
          subject,
          heading,
          paragraphs: lines.length ? lines : ["No details available."],
          cta: { label: "View tasks", url: `${appUrl}/portal/tasks` },
        });
        await sendEmail(email, tpl.subject, tpl.text, { fromName: brand.fromName, html: tpl.html });
      }
      return true;
    };

    // Build each overseer's team rollup up front. Admins/super_admins see the whole
    // company; managers see their team. Skipped when they oversee nobody with open tasks.
    const overseers = await prisma.user.findMany({
      where: { companyId, status: "active", deletedAt: null, role: { in: ["manager", "admin", "super_admin"] } },
      select: { id: true, email: true, role: true },
    });
    type Roll = ReturnType<typeof buildManagerRollup>;
    const teamRollups = new Map<string, { email: string | null; roll: Roll; reps: number }>();
    for (const o of overseers) {
      const teamReps = [...byRep.values()].filter(({ assignee }) => {
        if (o.role === "admin" || o.role === "super_admin") return true;
        return assignee.id === o.id || assignee.managerId === o.id || assignee.salesRep?.managerId === o.id;
      });
      if (teamReps.length === 0) continue;
      const map = new Map(teamReps.map(({ assignee, tasks: rt }) => [assignee.id, { name: `${assignee.firstName} ${assignee.lastName}`.trim() || "—", tasks: rt }]));
      teamRollups.set(o.id, { email: o.email, roll: buildManagerRollup(rollupFor(map, now)), reps: teamReps.length });
    }

    // One message per person. Anyone who is both an assignee and an overseer gets a
    // single combined email (their own follow-ups + their team rollup).
    const recipientIds = new Set<string>([...byRep.keys(), ...teamRollups.keys()]);
    for (const uid of recipientIds) {
      const personal = byRep.get(uid);
      const team = teamRollups.get(uid);
      const email = personal?.assignee.email ?? team?.email ?? null;
      const own = personal ? buildRepDigest(personal.tasks, now) : null;
      const ownCount = personal?.tasks.length ?? 0;

      if (own && team) {
        const lines = [
          ...own.lines,
          `Your team — ${team.roll.total} open across ${team.reps} ${team.reps === 1 ? "rep" : "reps"}:`,
          ...team.roll.lines,
        ];
        const subject = `Weekly follow-ups: ${ownCount} yours · ${team.roll.total} on your team`;
        if (await send(uid, email, subject, own.heading, lines)) combinedDigests++;
      } else if (own) {
        const subject = `Weekly follow-ups: ${ownCount} open${own.overdue ? `, ${own.overdue} overdue` : ""}`;
        if (await send(uid, email, subject, own.heading, own.lines)) repDigests++;
      } else if (team) {
        const subject = `Team follow-ups: ${team.roll.total} open`;
        if (await send(uid, email, subject, team.roll.heading, team.roll.lines)) managerDigests++;
      }
    }
  }

  return { companies: byCompany.size, skippedCompanies, repDigests, managerDigests, combinedDigests };
}
