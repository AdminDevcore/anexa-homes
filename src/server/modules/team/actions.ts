"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { sendEmail } from "@/server/modules/notifications/delivery";

function fail(error: string) {
  return { ok: false as const, error };
}

// --- Commission overrides (X earns off Y's deals) ---------------------------

const overrideSchema = z.object({
  beneficiaryId: z.string().min(1),
  sourceId: z.string().min(1),
  type: z.enum(["percentage", "flat"]),
  percent: z.number().min(0).max(100).default(0),
  flatAmount: z.number().int().min(0).default(0), // cents
});

/** Create/update an override: `beneficiary` earns off `source`'s deals. */
export async function setCommissionOverrideAction(input: z.infer<typeof overrideSchema>) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid override.");
  const { beneficiaryId, sourceId, type, percent, flatAmount } = parsed.data;
  if (beneficiaryId === sourceId) return fail("An override must be on a different person.");
  if (type === "percentage" && !(percent > 0)) return fail("Enter a percent above 0.");
  if (type === "flat" && !(flatAmount > 0)) return fail("Enter an amount above 0.");
  const both = await prisma.user.findMany({
    where: { companyId: me.companyId, id: { in: [beneficiaryId, sourceId] } },
    select: { id: true },
  });
  if (both.length < 2) return fail("User not found.");
  await prisma.commissionOverride.upsert({
    where: { companyId_beneficiaryId_sourceId: { companyId: me.companyId, beneficiaryId, sourceId } },
    create: { companyId: me.companyId, beneficiaryId, sourceId, type, percent, flatAmount },
    update: { type, percent, flatAmount },
  });
  revalidatePath(`/portal/team/${beneficiaryId}`);
  return { ok: true as const };
}

export async function deleteCommissionOverrideAction(id: string) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const o = await prisma.commissionOverride.findFirst({ where: { id, companyId: me.companyId }, select: { id: true, beneficiaryId: true } });
  if (!o) return fail("Override not found.");
  await prisma.commissionOverride.delete({ where: { id } });
  revalidatePath(`/portal/team/${o.beneficiaryId}`);
  return { ok: true as const };
}

const ROLE_VALUES = ["super_admin", "admin", "manager", "sales_rep", "canvasser", "marketing", "installer", "accounting"] as const;
const STATUS_VALUES = ["active", "invited", "suspended", "disabled"] as const;

const updateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLE_VALUES).optional(),
  title: z.string().max(120).optional().nullable(),
  status: z.enum(STATUS_VALUES).optional(),
  // Rep/manager profit-pool split %; null clears it.
  commissionSplitPct: z.number().min(0).max(100).optional().nullable(),
  providedLeadType: z.enum(["percentage", "flat"]).optional(),
  providedLeadSplitPct: z.number().min(0).max(100).optional().nullable(),
  providedLeadFlatCents: z.number().int().min(0).optional().nullable(),
  deductiblePct: z.number().min(0).max(100).optional().nullable(),
  // Industries this user may access (must grant at least one).
  industries: z.array(z.enum(["roofing", "solar", "water"])).min(1).optional(),
  // For canvassers: the sales rep they report to (their deals funnel to this rep).
  salesRepId: z.string().optional().nullable(),
  // For sales reps: the sales manager they report to (manager sees their team).
  managerId: z.string().optional().nullable(),
});

/** Edit a team member's role / title / status (admins/Super Admin). */
export async function updateTeamMemberAction(input: z.infer<typeof updateSchema>) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid changes.");
  const { userId, role, title, status, commissionSplitPct, providedLeadType, providedLeadSplitPct, providedLeadFlatCents, deductiblePct, industries, salesRepId, managerId } = parsed.data;

  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId }, select: { id: true, role: true } });
  if (!target) return fail("User not found.");

  // Resolve the assigned sales rep (canvassers only). The effective role is the
  // new role if one is being set, otherwise the target's current role.
  const effectiveRole = role ?? target.role;
  let salesRepUpdate: string | null | undefined;
  if (salesRepId !== undefined) {
    if (effectiveRole !== "canvasser") {
      salesRepUpdate = null; // only canvassers report to a rep
    } else if (salesRepId) {
      if (salesRepId === target.id) return fail("A canvasser can't report to themselves.");
      const rep = await prisma.user.findFirst({
        where: { id: salesRepId, companyId: me.companyId, role: { in: ["sales_rep", "manager", "admin", "super_admin"] }, status: "active" },
        select: { id: true },
      });
      if (!rep) return fail("Pick a valid sales rep.");
      salesRepUpdate = rep.id;
    } else {
      salesRepUpdate = null;
    }
  } else if (role !== undefined && role !== "canvasser") {
    // Changing someone out of the canvasser role clears any rep assignment.
    salesRepUpdate = null;
  }

  // Resolve the assigned sales manager (sales reps only).
  let managerUpdate: string | null | undefined;
  if (managerId !== undefined) {
    if (effectiveRole !== "sales_rep") {
      managerUpdate = null; // only sales reps report to a manager
    } else if (managerId) {
      if (managerId === target.id) return fail("A rep can't report to themselves.");
      const mgr = await prisma.user.findFirst({
        where: { id: managerId, companyId: me.companyId, role: "manager", status: "active" },
        select: { id: true },
      });
      if (!mgr) return fail("Pick a valid sales manager.");
      managerUpdate = mgr.id;
    } else {
      managerUpdate = null;
    }
  } else if (role !== undefined && role !== "sales_rep") {
    managerUpdate = null;
  }

  // Only the Super Admin decides who can access which industries.
  if (industries !== undefined && me.role !== "super_admin") {
    return fail("Only the Super Admin can set industry access.");
  }

  // Safety: don't let someone lock themselves out by changing their own role/status.
  if (target.id === me.userId) {
    if ((role && role !== target.role) || (status && status !== "active")) {
      return fail("You can't change your own role or status.");
    }
  }
  // Only a Super Admin can grant Super Admin.
  if (role === "super_admin" && me.role !== "super_admin") {
    return fail("Only a Super Admin can grant the Super Admin role.");
  }

  const roleChanged = role != null && role !== target.role;
  const statusChanged = status != null;
  await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(role ? { role } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(status ? { status } : {}),
      ...(commissionSplitPct !== undefined ? { commissionSplitPct } : {}),
      ...(providedLeadType !== undefined ? { providedLeadType } : {}),
      ...(providedLeadSplitPct !== undefined ? { providedLeadSplitPct } : {}),
      ...(providedLeadFlatCents !== undefined ? { providedLeadFlatCents } : {}),
      ...(deductiblePct !== undefined ? { deductiblePct } : {}),
      ...(industries !== undefined ? { industries } : {}),
      ...(salesRepUpdate !== undefined ? { salesRepId: salesRepUpdate } : {}),
      ...(managerUpdate !== undefined ? { managerId: managerUpdate } : {}),
      // Force re-auth when role/status changes so a demoted/disabled session is invalidated.
      ...(roleChanged || statusChanged ? { sessionVersion: { increment: 1 } } : {}),
    },
  });
  revalidatePath("/portal/team");
  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

const inviteSchema = z.object({ email: z.string().email(), role: z.enum(ROLE_VALUES) });

/** Invite a new user — creates a pending invitation + returns a shareable link. */
export async function inviteUserAction(input: z.infer<typeof inviteSchema>) {
  const me = await requireUser();
  if (!can(me, "create", "User")) return fail("Not allowed.");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid email and role.");
  if (parsed.data.role === "super_admin" && me.role !== "super_admin") {
    return fail("Only a Super Admin can invite a Super Admin.");
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { companyId: me.companyId, email }, select: { id: true } });
  if (existing) return fail("A user with that email already exists.");

  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  await prisma.invitation.create({
    data: {
      companyId: me.companyId,
      email,
      role: parsed.data.role,
      tokenHash,
      invitedById: me.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const inviteLink = `${appUrl}/invite/${raw}`;
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { name: true } });
  // Activation email — set a password, then complete onboarding.
  await sendEmail(
    email,
    `You're invited to join ${company?.name ?? "the team"} on Anexa Homes`,
    `Hi,\n\nYou've been invited to join ${company?.name ?? "the team"} on the Anexa Homes portal.\n\n` +
      `Activate your account and set your password here:\n${inviteLink}\n\n` +
      `This link expires in 7 days. After signing in you'll complete a quick onboarding (your details for payroll/1099).\n\n— ${company?.name ?? "Anexa Homes"}`
  ).catch(() => { /* best-effort; the link is still returned for manual sharing */ });

  revalidatePath("/portal/team");
  return { ok: true as const, inviteLink };
}
