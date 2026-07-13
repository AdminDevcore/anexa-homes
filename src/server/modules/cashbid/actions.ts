"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser, type SessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";

function fail(error: string) {
  return { ok: false as const, error };
}

/** The lead must be in the user's scope (company + role visibility). */
async function leadInScope(user: SessionUser, leadId: string) {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  return prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
}

function canManage(user: SessionUser) {
  return can(user, "create", "Proposal") || can(user, "update", "Proposal");
}

const createSchema = z.object({
  leadId: z.string().min(1),
  workDescription: z.string().trim().min(3, "Add a short description of the work.").max(3000),
  totalCents: z.coerce.number().int().min(0).max(1_000_000_00),
  depositPercent: z.coerce.number().int().min(0).max(100).default(50),
  warrantyWorkmanshipYears: z.coerce.number().int().min(0).max(99).default(5),
  warrantyManufacturerYears: z.coerce.number().int().min(0).max(99).default(30),
});

export async function createCashBidAction(input: z.infer<typeof createSchema>) {
  const user = await requireUser();
  if (!canManage(user)) return fail("Not allowed.");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;
  if (!(await leadInScope(user, d.leadId))) return fail("Deal not found.");

  const bid = await prisma.cashBid.create({
    data: {
      companyId: user.companyId,
      leadId: d.leadId,
      createdById: user.userId,
      workDescription: d.workDescription,
      totalCents: d.totalCents,
      depositPercent: d.depositPercent,
      warrantyWorkmanshipYears: d.warrantyWorkmanshipYears,
      warrantyManufacturerYears: d.warrantyManufacturerYears,
      status: "sent",
      sentAt: new Date(),
    },
    select: { id: true, token: true },
  });
  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const, id: bid.id, token: bid.token };
}

const updateSchema = createSchema.extend({ id: z.string().min(1) }).omit({ leadId: true });

export async function updateCashBidAction(input: z.infer<typeof updateSchema>) {
  const user = await requireUser();
  if (!canManage(user)) return fail("Not allowed.");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;
  const bid = await prisma.cashBid.findFirst({
    where: { id: d.id, companyId: user.companyId },
    select: { id: true, leadId: true, status: true },
  });
  if (!bid) return fail("Bid not found.");
  if (bid.status === "signed") return fail("This bid is already signed and can't be changed.");
  await prisma.cashBid.update({
    where: { id: bid.id },
    data: {
      workDescription: d.workDescription,
      totalCents: d.totalCents,
      depositPercent: d.depositPercent,
      warrantyWorkmanshipYears: d.warrantyWorkmanshipYears,
      warrantyManufacturerYears: d.warrantyManufacturerYears,
    },
  });
  revalidatePath(`/portal/leads/${bid.leadId}`);
  return { ok: true as const };
}

export async function deleteCashBidAction(id: string) {
  const user = await requireUser();
  if (!canManage(user)) return fail("Not allowed.");
  const bid = await prisma.cashBid.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, leadId: true } });
  if (!bid) return fail("Bid not found.");
  await prisma.cashBid.delete({ where: { id: bid.id } });
  revalidatePath(`/portal/leads/${bid.leadId}`);
  return { ok: true as const };
}

const signSchema = z.object({
  token: z.string().min(1),
  signerName: z.string().trim().min(2, "Please type your full name.").max(120),
});

/** Public homeowner sign — token-gated, no auth. */
export async function signCashBidAction(input: z.infer<typeof signSchema>) {
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please type your full name.");
  const { token, signerName } = parsed.data;
  const bid = await prisma.cashBid.findUnique({ where: { token }, select: { id: true, status: true } });
  if (!bid) return fail("This bid could not be found.");
  if (bid.status === "signed") return fail("This bid has already been signed.");

  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null;

  await prisma.cashBid.update({
    where: { id: bid.id },
    data: { status: "signed", signerName, signerIp: ip, signedAt: new Date() },
  });
  return { ok: true as const };
}
