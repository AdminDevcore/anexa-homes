import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { checkGeoProviders } from "@/server/modules/geo/health";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { assertCronRequest } from "@/server/auth/cron";

/**
 * The address-lookup watchdog.
 *
 * Why it exists: Places API (New) was never enabled on the Google Cloud project
 * this app's key belongs to. From 2026-08-08 to 2026-08-24 every address
 * suggestion in the product was served by the free fallback geocoder, which has
 * no data for new-construction streets — so a rep typing a real Katy address
 * was told "No matching address". Nothing anywhere raised its hand. The failure
 * was a 403 in a server log, and server logs are not a monitoring system.
 *
 * So: probe the providers daily and tell the people who can act. An external
 * dependency that can be switched off by someone outside this repo needs a
 * watchdog, not a comment asking a future reader to remember.
 *
 * Alerts only while something is actually down, and at most once every three
 * days per person — enough to stay annoying until it is fixed, not enough to
 * train anyone to ignore it.
 */

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUPE_DAYS = 3;
// Title marker, so a repeat alert can be deduped without spending a Prisma enum
// migration on a new NotificationEvent — the same trick the overdue digest uses.
const ALERT_TITLE = "⚠️ Address lookup";

async function handler(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;

  try {
    const health = await checkGeoProviders();
    if (!health.degraded) return Response.json({ ok: true, alerted: 0, health });

    const down = health.providers.filter((p) => !p.ok);
    const heading = health.summary;
    const paragraphs = [
      health.ok
        ? "Address suggestions are still working, but not from the provider they should be coming from. Left alone this shows up as reps being unable to find brand-new houses."
        : "No address provider is answering. Every address field in the portal and on the website is currently unable to suggest anything.",
      "—",
      ...down.map((p) => `${p.label}: ${p.detail}`),
      "—",
      `Checked ${new Date(health.checkedAt).toUTCString()}.`,
    ];

    const recent = await prisma.notification.findMany({
      where: {
        title: { startsWith: ALERT_TITLE },
        createdAt: { gte: new Date(Date.now() - DEDUPE_DAYS * DAY_MS) },
      },
      select: { userId: true },
    });
    const alreadyNotified = new Set(recent.map((r) => r.userId));

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    // Only the people who can act on a Google Cloud project. A rep being told
    // the geocoder is down is noise; they already see it in the field.
    const admins = await prisma.user.findMany({
      where: {
        status: "active",
        deletedAt: null,
        role: { in: ["admin", "super_admin"] },
      },
      select: { id: true, email: true, companyId: true },
    });

    let alerted = 0;
    const brands = new Map<string, Awaited<ReturnType<typeof emailBrandFor>>>();
    for (const a of admins) {
      if (alreadyNotified.has(a.id)) continue;
      alreadyNotified.add(a.id);

      const subject = `${ALERT_TITLE}: ${down.map((p) => p.label).join(", ")} not answering`;
      await prisma.notification.create({
        data: {
          companyId: a.companyId,
          userId: a.id,
          // Reused value, not a claim about deals — see ALERT_TITLE above.
          event: "task_reminder",
          title: subject,
          body: heading,
          link: "/portal/settings",
          channel: "in_app",
        },
      });

      if (a.email) {
        let brand = brands.get(a.companyId);
        if (!brand) {
          brand = await emailBrandFor(a.companyId);
          brands.set(a.companyId, brand);
        }
        const tpl = brandedEmailTemplate({
          brand: brand.brand,
          subject,
          heading,
          paragraphs,
          ...(appUrl
            ? { cta: { label: "Open Settings", url: `${appUrl}/portal/settings` } }
            : {}),
          note: "Automated check of the address providers. It runs once a day.",
        });
        await sendEmail(a.email, tpl.subject, tpl.text, {
          fromName: brand.fromName,
          html: tpl.html,
        });
      }
      alerted++;
    }

    // Loud in the log too, for the case where email itself is what is broken.
    console.warn("[cron:geo-health]", health.summary, down.map((p) => p.detail).join(" | "));
    return Response.json({ ok: true, alerted, health });
  } catch (err) {
    console.error("[cron:geo-health] failed", err);
    return new Response("Error", { status: 500 });
  }
}

/** A platform-wide check, so it declares itself company-wide rather than
 *  inheriting a workspace it does not have. */
export async function GET(req: Request) {
  return runUnscoped("cron: probe address-lookup providers", () => handler(req));
}
