"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { runUnscoped } from "@/server/vertical/context";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { defaultProposalContent } from "@/lib/proposal";
import { getPublicProposal } from "./queries";
import { proposalEmail } from "./email";

function fail(error: string) {
  return { ok: false as const, error };
}

async function leadInScope(user: { companyId: string }, scope: Prisma.LeadWhereInput, leadId: string) {
  return prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true, firstName: true, lastName: true, address: true, city: true, state: true, zip: true, assignedRepId: true } });
}

function formatAddress(l: { address: string | null; city: string | null; state: string | null; zip: string | null }): string {
  return [l.address, l.city, l.state, l.zip].filter(Boolean).join(", ");
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Get-or-create a draft proposal for a lead. Returns the proposal id. */
export async function ensureProposalAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Proposal") && !can(user, "update", "Proposal")) return fail("Not allowed.");
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await leadInScope(user, scope, leadId);
  if (!lead) return fail("Deal not found.");

  const existing = await prisma.proposal.findFirst({ where: { companyId: user.companyId, leadId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (existing) return { ok: true as const, id: existing.id };

  const created = await prisma.proposal.create({
    data: {
      companyId: user.companyId,
      leadId,
      publicToken: newToken(),
      customerName: `${lead.firstName} ${lead.lastName}`.trim(),
      propertyAddress: formatAddress(lead),
      content: defaultProposalContent() as unknown as Prisma.InputJsonValue,
      createdById: user.userId,
    },
    select: { id: true },
  });
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const, id: created.id };
}

const contentSchema = z.object({
  proposalId: z.string().min(1),
  content: z.record(z.string(), z.unknown()),
});

/** Persist the editable content blob (merged client-side; replaced wholesale here). */
export async function updateProposalContentAction(input: z.infer<typeof contentSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid content.");

  const proposal = await prisma.proposal.findFirst({ where: { id: parsed.data.proposalId, companyId: user.companyId }, select: { id: true, leadId: true } });
  if (!proposal) return fail("Proposal not found.");

  await prisma.proposal.update({ where: { id: proposal.id }, data: { content: parsed.data.content as Prisma.InputJsonValue } });
  revalidatePath(`/portal/leads/${proposal.leadId}/presentation`);
  return { ok: true as const };
}

/**
 * Mark a proposal generated. Returns the token.
 *
 * Photos are NOT a gate. A rep is often standing on the driveway with a customer
 * who already has their own inspection, or the roof photos land later from the
 * inspector — blocking the price on a photo checklist stops the sale for a
 * reason the customer never sees. The builder still shows which required slots
 * are empty; the empty photo section simply doesn't render on the presentation.
 */
export async function generateProposalAction(proposalId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");

  const proposal = await prisma.proposal.findFirst({ where: { id: proposalId, companyId: user.companyId }, select: { id: true, leadId: true, publicToken: true, status: true } });
  if (!proposal) return fail("Proposal not found.");

  // Never walk the status backwards: once the customer has viewed or signed it,
  // re-generating refreshes the content, not the milestone.
  if (proposal.status === "draft" || proposal.status === "generated") {
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "generated" } });
  }
  revalidatePath(`/portal/leads/${proposal.leadId}/presentation`);
  return { ok: true as const, token: proposal.publicToken };
}

const emailSchema = z.object({
  proposalId: z.string().min(1),
  email: z.string().trim().email("Enter a valid email address."),
  message: z.string().trim().max(1000).optional(),
});

/**
 * Email the customer their proposal — the same link the rep would text, wrapped
 * in the branded template with the numbers spelled out so it reads like a copy
 * of the proposal even before they click.
 *
 * Sending IS generating: a rep who types an address and hits send means the
 * proposal is done, so we mark it generated on the way out rather than making
 * them press two buttons in the right order.
 */
export async function emailProposalAction(input: z.infer<typeof emailSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  const { email, message } = parsed.data;

  const proposal = await prisma.proposal.findFirst({
    where: { id: parsed.data.proposalId, companyId: user.companyId },
    select: { id: true, leadId: true, publicToken: true, status: true, customerName: true, vertical: true },
  });
  if (!proposal) return fail("Proposal not found.");

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${appUrl}/present/${proposal.publicToken}`;

  // The customer-safe view is the source of truth for the figures, so the email
  // can never quote a number the presentation itself doesn't show.
  const view = await getPublicProposal(proposal.publicToken);
  if (!view) return fail("Proposal not found.");

  const { brand, fromName } = await emailBrandFor(user.companyId, proposal.vertical);
  const tpl = proposalEmail({
    brand,
    customerName: view.customerName,
    propertyAddress: view.propertyAddress,
    dealType: view.dealType,
    repName: view.repName,
    outOfPocketCents: view.financials.estimatedOutOfPocketCents,
    financing: view.content.financing,
    url,
    ...(message ? { message } : {}),
  });

  const sent = await sendEmail(email, tpl.subject, tpl.text, { fromName, html: tpl.html });

  // Advance the status, never walk it backwards — a proposal the customer has
  // already viewed or signed stays at that milestone when the rep re-sends.
  if (proposal.status === "draft" || proposal.status === "generated") {
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "sent" } });
  }

  // The send belongs on the deal timeline: it's the moment the customer got the
  // price, and it's what a rep looks for when they ask "did we send it yet?".
  await prisma.note.create({
    data: {
      companyId: user.companyId,
      leadId: proposal.leadId,
      context: "proposal",
      body: `[Proposal · Emailed to ${email}]${message ? ` ${message}` : ""}`,
      authorId: user.userId,
    },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "note",
      message: `Proposal emailed to ${email}`,
      leadId: proposal.leadId,
      actorId: user.userId,
    },
  });

  // Fill a blank contact email from what the rep just typed — never overwrite
  // one that's already there.
  await prisma.lead.updateMany({ where: { id: proposal.leadId, companyId: user.companyId, email: null }, data: { email } });

  revalidatePath(`/portal/leads/${proposal.leadId}/presentation`);
  revalidatePath(`/portal/leads/${proposal.leadId}`);
  return {
    ok: true as const,
    token: proposal.publicToken,
    // False when no SMTP_*/RESEND_API_KEY is configured — the send was logged,
    // not delivered. Surfacing it beats a green toast that lied.
    delivered: sent,
  };
}

// --- Public (token-authed) customer replies -------------------------------

const replySchema = z.object({
  token: z.string().min(1),
  message: z.string().min(1, "Message is required").max(2000),
});

/**
 * Every public reply below runs unscoped, for the same reason getPublicProposal
 * does: the customer is anonymous. They have no session and no workspace
 * cookie, so there is no vertical to resolve, and Proposal is a vertical-scoped
 * model — an unwrapped read throws MissingVerticalContextError and the button
 * appears broken to the customer. The unguessable token IS the authorization
 * and identifies exactly one row, whose vertical is not known until it is read.
 */
const PUBLIC_TOKEN_REASON =
  "public proposal reply: the unguessable token is the authorization and identifies exactly one row, whose vertical is not known until it is read";

async function postCustomerNote(token: string, message: string, kind: "Change request" | "Question") {
  const proposal = await runUnscoped(PUBLIC_TOKEN_REASON, () =>
    prisma.proposal.findUnique({ where: { publicToken: token }, select: { companyId: true, leadId: true, customerName: true } }),
  );
  if (!proposal) return fail("Proposal not found.");

  await prisma.note.create({
    data: {
      companyId: proposal.companyId,
      leadId: proposal.leadId,
      context: "proposal",
      body: `[Proposal · ${kind} from ${proposal.customerName}] ${message.trim()}`,
      authorId: null,
    },
  });
  await prisma.activityLog.create({
    data: {
      companyId: proposal.companyId,
      type: "note",
      message: `${kind} on proposal from ${proposal.customerName}`,
      leadId: proposal.leadId,
    },
  });
  return { ok: true as const };
}

export async function requestChangesAction(input: z.infer<typeof replySchema>) {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  return postCustomerNote(parsed.data.token, parsed.data.message, "Change request");
}

export async function askQuestionAction(input: z.infer<typeof replySchema>) {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  return postCustomerNote(parsed.data.token, parsed.data.message, "Question");
}

const paymentSchema = z.object({
  token: z.string().min(1),
  mode: z.enum(["cash", "finance"]),
  // Only meaningful for "finance" — which term the customer picked.
  months: z.number().int().positive().max(600).optional(),
});

/**
 * The customer picked how they want to pay. Writes the choice onto the proposal
 * and tells the rep, on the same Note + ActivityLog path the other public
 * replies use — this is a buying signal, so it belongs on the deal timeline and
 * not just in a JSON blob.
 *
 * Re-picking overwrites and logs again: a changed mind is information too.
 */
export async function selectPaymentOptionAction(input: z.infer<typeof paymentSchema>) {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid selection.");
  const { token, mode, months } = parsed.data;

  const proposal = await runUnscoped(PUBLIC_TOKEN_REASON, () =>
    prisma.proposal.findUnique({
      where: { publicToken: token },
      select: { id: true, companyId: true, leadId: true, customerName: true, content: true },
    }),
  );
  if (!proposal) return fail("Proposal not found.");

  const content =
    proposal.content && typeof proposal.content === "object" && !Array.isArray(proposal.content)
      ? (proposal.content as Record<string, unknown>)
      : {};

  const selectedPayment = {
    mode,
    ...(mode === "finance" && months ? { months } : {}),
    at: new Date().toISOString(),
  };

  await runUnscoped(PUBLIC_TOKEN_REASON, () =>
    prisma.proposal.update({
      where: { id: proposal.id },
      data: { content: { ...content, selectedPayment } as Prisma.InputJsonValue },
    }),
  );

  const label = mode === "finance" ? `Monthly payments${months ? ` · ${months} months` : ""}` : "Pay in full";
  await prisma.note.create({
    data: {
      companyId: proposal.companyId,
      leadId: proposal.leadId,
      context: "proposal",
      body: `[Proposal · Payment choice from ${proposal.customerName}] ${label}`,
      authorId: null,
    },
  });
  await prisma.activityLog.create({
    data: {
      companyId: proposal.companyId,
      type: "note",
      message: `${proposal.customerName} chose ${label.toLowerCase()} on the proposal`,
      leadId: proposal.leadId,
    },
  });

  return { ok: true as const };
}
