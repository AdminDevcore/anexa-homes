"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";

const fail = (error: string) => ({ ok: false as const, error });
const ok = () => ({ ok: true as const });

async function assertLead(companyId: string, scope: Prisma.LeadWhereInput, leadId: string) {
  return prisma.lead.findFirst({
    where: { ...scope, companyId, id: leadId },
    select: { id: true, firstName: true, lastName: true },
  });
}

// ---------------------------------------------------------------------------
// Payment milestones
// ---------------------------------------------------------------------------

const milestoneSchema = z.object({
  leadId: z.string().min(1),
  payee: z.enum(["rep", "financier"]),
  sequence: z.number().int().min(1).max(6),
  label: z.string().min(1).max(60),
  amountCents: z.number().int().min(0),
  trigger: z.string().max(120).nullable().optional(),
  expectedAt: z.string().nullable().optional(),
  paid: z.boolean().optional(),
});

/** Create or update one payment milestone (M1/M2/M3, or a financier draw). */
export async function upsertSolarMilestoneAction(input: z.infer<typeof milestoneSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid milestone.");
  const d = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  if (!(await assertLead(user.companyId, scope, d.leadId))) return fail("Deal not found.");

  const data = {
    label: d.label,
    amountCents: d.amountCents,
    trigger: d.trigger ?? null,
    expectedAt: d.expectedAt ? new Date(d.expectedAt) : null,
    // Marking paid stamps the date; un-marking clears it, so the two never drift.
    paidAt: d.paid ? new Date() : null,
  };

  await prisma.solarMilestone.upsert({
    where: { leadId_payee_sequence: { leadId: d.leadId, payee: d.payee, sequence: d.sequence } },
    create: { companyId: user.companyId, leadId: d.leadId, payee: d.payee, sequence: d.sequence, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return ok();
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

const postSchema = z.object({
  leadId: z.string().min(1),
  channel: z.enum(["external", "internal", "customer"]),
  body: z.string().min(1).max(4000),
});

/** `@Firstname Lastname` or `@Firstname` — matched against the staff roster. */
function extractMentionNames(body: string): string[] {
  return [...body.matchAll(/@([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)/g)].map((m) => m[1].trim());
}

/**
 * Post to a deal's activity feed.
 *
 * The channel is load-bearing: `internal` posts are staff-only and must never
 * reach the homeowner, so the audience is stored on the row rather than being a
 * rendering decision somebody can get wrong later.
 *
 * @mentions are resolved against the staff roster and emailed. Resolution runs
 * unscoped-by-name only — a mention cannot be used to discover whether a given
 * person exists, because unmatched names are silently ignored.
 */
export async function postDealFeedAction(input: z.infer<typeof postSchema>) {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) return fail("Not allowed.");
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid post.");
  const d = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await assertLead(user.companyId, scope, d.leadId);
  if (!lead) return fail("Deal not found.");

  // Resolve @mentions against active staff in this company.
  const names = extractMentionNames(d.body);
  const staff = names.length
    ? await prisma.user.findMany({
        where: { companyId: user.companyId, status: "active", deletedAt: null, role: { not: "customer" } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const mentioned = staff.filter((u) => {
    const full = `${u.firstName} ${u.lastName}`.toLowerCase();
    return names.some((n) => {
      const q = n.toLowerCase();
      return full === q || u.firstName.toLowerCase() === q;
    });
  });

  await prisma.dealFeedPost.create({
    data: {
      companyId: user.companyId,
      leadId: d.leadId,
      channel: d.channel,
      body: d.body,
      authorId: user.userId,
      mentions: mentioned.map((m) => m.id),
    },
  });

  // Notify the mentioned — in-app always, email because that is what actually
  // gets read when somebody is asking you to unblock a deal.
  if (mentioned.length) {
    const customer = `${lead.firstName} ${lead.lastName}`.trim();
    const title = `${user.fullName} mentioned you on ${customer}`;
    const link = `/portal/leads/${d.leadId}`;

    await prisma.notification.createMany({
      data: mentioned
        .filter((m) => m.id !== user.userId)
        .map((m) => ({
          companyId: user.companyId,
          userId: m.id,
          event: "stage_changed" as const,
          title,
          body: d.body.slice(0, 400),
          link,
          channel: "in_app" as const,
        })),
    });

    try {
      const brand = await emailBrandFor(user.companyId);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
      const tpl = brandedEmailTemplate({
        brand: brand.brand,
        subject: title,
        heading: title,
        paragraphs: [d.body],
        cta: { label: "Open the deal", url: `${appUrl}${link}` },
      });
      for (const m of mentioned) {
        if (m.id !== user.userId && m.email) {
          await sendEmail(m.email, tpl.subject, tpl.text, { fromName: brand.fromName, html: tpl.html });
        }
      }
    } catch {
      // A mail failure must not lose the post — it is already saved.
    }
  }

  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const, mentioned: mentioned.length };
}

