"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import {
  canCertifyFunding,
  FUNDING_AUTHORITY_ERROR,
} from "@/server/modules/payroll/funding-authority";
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
// The rep's commission
// ---------------------------------------------------------------------------

const commissionSchema = z.object({
  leadId: z.string().min(1),
  amountCents: z.number().int().min(0),
  trigger: z.string().max(120).nullable().optional(),
  expectedAt: z.string().nullable().optional(),
  paid: z.boolean().optional(),
});

/**
 * Set what the rep is owed on this deal, and whether the lender has funded it.
 *
 * ONE FIGURE, NOT A SCHEDULE. This wrote four rows once — M1/M2 for the rep and
 * two financier draws — because a solar deal was assumed to pay its rep in
 * tranches as the lender funded. It does not: the rep is paid out in full, one
 * time, so three of the four slots were a schedule nobody had a second entry
 * for, and every deal in production had all four sitting empty.
 *
 * The row is still a `SolarMilestone` (payee `rep`, sequence 1): the storage
 * was always general enough, it was the interface that asked for too much. The
 * payee and sequence are decided here rather than passed in, so no caller can
 * write a slot the deal will not show.
 *
 * ── TWO AUTHORITIES, NOT ONE ────────────────────────────────────────────────
 * The fields on this row are not all the same kind of fact, and until now they
 * were all written under `Lead:update`, which every `sales_rep` holds on their
 * own deals.
 *
 *   amount / trigger / expectedAt   a FORECAST. What the rep expects to earn
 *                                   and when. Theirs to keep up to date, and
 *                                   nothing downstream pays out of it.
 *
 *   paid                            a FINANCIAL EVENT. `paidAt` is one of the
 *                                   two conditions `generateCommissionsAction`
 *                                   reads to release commission, so a rep who
 *                                   could set it could certify the funding of
 *                                   their own deal. It now needs
 *                                   `Commission:approve` — the funding desk.
 *
 * See `payroll/funding-authority.ts` for who that is and why it is not a new
 * permission.
 *
 * ── AN OMITTED `paid` NO LONGER UN-FUNDS THE DEAL ───────────────────────────
 * `paidAt: d.paid ? new Date() : null` cleared the funding stamp on every save
 * that did not resend the flag — so a rep updating the expected amount silently
 * reversed a funding confirmation the desk had already made, and the only trace
 * was the commission quietly ceasing to generate. The column is now touched
 * ONLY when a caller who may certify funding says so explicitly.
 */
export async function upsertSolarCommissionAction(input: z.infer<typeof commissionSchema>) {
  const user = await requireUser();
  /**
   * EITHER authority opens the door, and each field is checked on its own below.
   *
   * `Lead:update` alone was the gate, and it excluded the very people this row
   * most concerns: `accounting` — the funding desk — holds no Lead grant at
   * all, so the role whose job it is to confirm M1 could not reach the action
   * that records it. Requiring both would have locked them out; requiring
   * `Lead:update` only would have kept the hole this fix closes.
   */
  const mayEditForecast = can(user, "update", "Lead");
  const mayCertify = canCertifyFunding(user);
  if (!mayEditForecast && !mayCertify) return fail("Not allowed.");

  const parsed = commissionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid commission.");
  const d = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await assertLead(user.companyId, scope, d.leadId);
  if (!lead) return fail("Deal not found.");

  /**
   * Is this call trying to move the funding stamp at all?
   *
   * Compared against what is already on the row rather than taken from the
   * request, so a form that faithfully echoes the current state back — which is
   * what the deal page does — is not treated as an attempt to change it. Only a
   * real transition needs the authority.
   */
  const existing = await prisma.solarMilestone.findUnique({
    where: { leadId_payee_sequence: { leadId: d.leadId, payee: "rep", sequence: 1 } },
    select: { paidAt: true },
  });
  const fundedNow = existing?.paidAt != null;
  const wantsFunded = d.paid === true;
  const movesFunding = d.paid !== undefined && wantsFunded !== fundedNow;

  if (movesFunding && !mayCertify) return fail(FUNDING_AUTHORITY_ERROR);

  const data = {
    label: "Commission",
    // The forecast, and only from somebody who may edit the deal. The funding
    // desk reaching in to confirm M1 leaves the rep's own figures untouched.
    ...(mayEditForecast
      ? {
          amountCents: d.amountCents,
          trigger: d.trigger ?? null,
          expectedAt: d.expectedAt ? new Date(d.expectedAt) : null,
        }
      : {}),
    // Only ever written by somebody who may certify funding, and only when they
    // actually moved it. Everyone else's save leaves the stamp exactly as the
    // desk left it.
    ...(movesFunding ? { paidAt: wantsFunded ? new Date() : null } : {}),
  };

  await prisma.solarMilestone.upsert({
    where: { leadId_payee_sequence: { leadId: d.leadId, payee: "rep", sequence: 1 } },
    create: {
      companyId: user.companyId,
      leadId: d.leadId,
      payee: "rep",
      sequence: 1,
      ...data,
      // A row created by somebody with no funding authority starts unfunded
      // rather than inheriting the spread above, which omits the key entirely.
      paidAt: movesFunding && wantsFunded ? new Date() : null,
    },
    update: data,
  });

  /**
   * A funding confirmation is a financial event and leaves a trail.
   *
   * Named, timestamped and attributed on the deal's own activity log, because
   * "who said this deal funded, and when" is the first question anybody asks
   * about a commission that should not have been paid.
   */
  if (movesFunding) {
    await prisma.activityLog.create({
      data: {
        companyId: user.companyId,
        type: "payment",
        message: wantsFunded
          ? `${user.fullName} confirmed M1 funding received on this deal`
          : `${user.fullName} withdrew the M1 funding confirmation on this deal`,
        actorId: user.userId,
        leadId: d.leadId,
      },
    });
  }

  revalidatePath(`/portal/leads/${d.leadId}`);
  return ok();
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

const postSchema = z.object({
  leadId: z.string().min(1),
  body: z.string().min(1).max(4000),
});

/** `@Firstname Lastname` or `@Firstname` — matched against the staff roster. */
function extractMentionNames(body: string): string[] {
  return [...body.matchAll(/@([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)/g)].map((m) => m[1].trim());
}

/**
 * Post to a deal's activity feed.
 *
 * Every post is `internal`, and the caller no longer chooses. The feed used to
 * offer three audiences, but two of them assumed a customer portal that does
 * not exist — nothing written here has ever been visible outside the company.
 * Deciding the audience here rather than in the client means a future caller
 * cannot get it wrong, and the column keeps recording what is true.
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
      channel: "internal",
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

