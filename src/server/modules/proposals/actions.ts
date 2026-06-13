"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { defaultProposalContent, requiredPhotosMet, type ProposalContent } from "@/lib/proposal";

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

/** Mark a proposal generated once all required photos are present. Returns the token. */
export async function generateProposalAction(proposalId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");

  const proposal = await prisma.proposal.findFirst({ where: { id: proposalId, companyId: user.companyId }, select: { id: true, leadId: true, publicToken: true } });
  if (!proposal) return fail("Proposal not found.");

  // Gate: every required site/inspection slot must have at least one photo.
  const template = await prisma.photoTemplate.findFirst({ where: { companyId: user.companyId, kind: "site" }, include: { items: { select: { id: true, required: true } } } });
  if (template) {
    const counts = await prisma.fileAsset.groupBy({
      by: ["photoTemplateItemId"],
      where: { companyId: user.companyId, leadId: proposal.leadId, kind: "photo", photoTemplateItemId: { not: null } },
      _count: { _all: true },
    });
    const countMap: Record<string, number> = {};
    for (const c of counts) if (c.photoTemplateItemId) countMap[c.photoTemplateItemId] = c._count._all;
    if (!requiredPhotosMet(template.items, countMap)) return fail("Upload all required photos before generating.");
  }

  await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "generated" } });
  revalidatePath(`/portal/leads/${proposal.leadId}/presentation`);
  return { ok: true as const, token: proposal.publicToken };
}

// --- Public (token-authed) customer replies -------------------------------

const replySchema = z.object({
  token: z.string().min(1),
  message: z.string().min(1, "Message is required").max(2000),
});

async function postCustomerNote(token: string, message: string, kind: "Change request" | "Question") {
  const proposal = await prisma.proposal.findUnique({ where: { publicToken: token }, select: { companyId: true, leadId: true, customerName: true } });
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

export type { ProposalContent };
