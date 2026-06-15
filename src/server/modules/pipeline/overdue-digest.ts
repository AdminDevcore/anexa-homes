import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { stageTiming } from "@/lib/stage-status";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUPE_DAYS = 3;
// Marker prefix on the digest notification so we can dedupe a double cron fire
// without needing a dedicated NotificationEvent value.
const DIGEST_TITLE = "📋 Overdue jobs digest";

type Overdue = { customer: string; stage: string; position: number; days: number; target: number; over: number; rep: string };

/**
 * Scheduled "overdue jobs" digest. Rolls up EVERY open deal that's past its
 * stage day-limit, grouped by stage, and emails + in-app notifies each company's
 * managers/admins/super-admins. Complements the per-deal stage-alert cron (which
 * fires once when a single deal crosses its threshold) with a leadership rollup.
 * Companies can switch it off via CompanySettings.overdueDigestEnabled.
 */
export async function runOverdueDigest(now: number = Date.now()) {
  const leads = await prisma.lead.findMany({
    where: { status: "open", stage: { targetDays: { gt: 0 } } },
    select: {
      companyId: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      stageChangedAt: true,
      assignedRep: { select: { firstName: true, lastName: true } },
      stage: { select: { name: true, targetDays: true, position: true } },
    },
  });

  // Keep only overdue, grouped by company.
  const byCompany = new Map<string, Overdue[]>();
  for (const l of leads) {
    if (!l.stage) continue;
    const t = stageTiming(l.stageChangedAt, l.createdAt, l.stage.targetDays, now);
    if (t.status !== "overdue") continue;
    const arr = byCompany.get(l.companyId) ?? [];
    arr.push({
      customer: `${l.firstName} ${l.lastName}`.trim() || "Unnamed deal",
      stage: l.stage.name,
      position: l.stage.position,
      days: t.daysInStage,
      target: t.targetDays,
      over: t.overdueBy,
      rep: l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}`.trim() : "Unassigned",
    });
    byCompany.set(l.companyId, arr);
  }

  if (byCompany.size === 0) return { companies: 0, digests: 0, overdueJobs: 0 };

  // Companies that switched the digest off.
  const settings = await prisma.companySettings.findMany({
    where: { companyId: { in: [...byCompany.keys()] } },
    select: { companyId: true, overdueDigestEnabled: true },
  });
  const disabled = new Set(settings.filter((s) => !s.overdueDigestEnabled).map((s) => s.companyId));

  // Guard a double cron fire: who already got a digest in the last few days.
  const recent = await prisma.notification.findMany({
    where: { title: { startsWith: DIGEST_TITLE }, createdAt: { gte: new Date(now - DEDUPE_DAYS * DAY_MS) } },
    select: { userId: true },
  });
  const alreadyNotified = new Set(recent.map((r) => r.userId));

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  let digests = 0;
  let skippedCompanies = 0;

  for (const [companyId, rows] of byCompany) {
    if (disabled.has(companyId)) { skippedCompanies++; continue; }

    // Per-stage rollup (pipeline order), worst-over first within each.
    const byStage = new Map<string, { position: number; count: number; worst: number; target: number }>();
    for (const r of rows) {
      const e = byStage.get(r.stage) ?? { position: r.position, count: 0, worst: 0, target: r.target };
      e.count += 1; e.worst = Math.max(e.worst, r.over);
      byStage.set(r.stage, e);
    }
    const stageLines = [...byStage.entries()]
      .sort((a, b) => a[1].position - b[1].position)
      .map(([stage, e]) => `${stage} — ${e.count} job${e.count === 1 ? "" : "s"} stuck, worst ${e.worst}d over (limit ${e.target}d)`);

    // Top offenders across all stages.
    const offenders = [...rows].sort((a, b) => b.over - a.over).slice(0, 10)
      .map((r) => `${r.customer} — ${r.stage} · ${r.over}d over · ${r.rep}`);

    const total = rows.length;
    const heading = `${total} job${total === 1 ? "" : "s"} past their stage day-limit`;
    const lines = [
      ...stageLines,
      "—",
      "Worst offenders:",
      ...offenders,
    ];
    const subject = `${DIGEST_TITLE}: ${total} stuck`;

    const overseers = await prisma.user.findMany({
      where: { companyId, status: "active", deletedAt: null, role: { in: ["manager", "admin", "super_admin"] } },
      select: { id: true, email: true },
    });
    if (overseers.length === 0) continue;

    const brand = await emailBrandFor(companyId);
    for (const o of overseers) {
      if (alreadyNotified.has(o.id)) continue;
      alreadyNotified.add(o.id);
      await prisma.notification.create({
        data: { companyId, userId: o.id, event: "stage_changed", title: subject, body: heading, link: "/portal/reports/delinquency", channel: "in_app" },
      });
      if (o.email) {
        const tpl = brandedEmailTemplate({
          brand: brand.brand,
          subject,
          heading,
          paragraphs: lines,
          cta: { label: "View Overdue Jobs report", url: `${appUrl}/portal/reports/delinquency` },
        });
        await sendEmail(o.email, tpl.subject, tpl.text, { fromName: brand.fromName, html: tpl.html });
      }
      digests++;
    }
  }

  return { companies: byCompany.size, skippedCompanies, digests, overdueJobs: [...byCompany.values()].reduce((s, r) => s + r.length, 0) };
}
