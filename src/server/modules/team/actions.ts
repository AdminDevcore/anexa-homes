"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { leadAdjustColumns } from "@/lib/solar-pay";
import { requireUser } from "@/server/auth/session";
import { resetEnrollment } from "@/server/auth/mfa";
import { can } from "@/server/rbac/guards";
import { isPayEligible, PAY_ELIGIBLE_ROLES, ROLES } from "@/server/rbac/matrix";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { inviteEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { ensureRepVendor } from "@/server/modules/bookkeeping/rep-vendor";
import { roleLabel, canAssignRole } from "@/lib/roles";
import { VERTICALS, VERTICAL_LABEL } from "@/lib/vertical";
import { userVerticals } from "@/server/auth/vertical";
import type { Prisma } from "@prisma/client";
import { AGENT_ACCESS_ROLE, withAgentsAccess, withoutAgentsAccess } from "@/server/modules/agents/access";

function fail(error: string) {
  return { ok: false as const, error };
}

// --- Commission overrides (X earns off Y's deals) ---------------------------

const overrideSchema = z.object({
  beneficiaryId: z.string().min(1),
  sourceId: z.string().min(1),
  // Roofing and Solar are separate businesses with separate pay. An override is
  // always written for one of them; `others` is retired and rejected here.
  vertical: z.enum(VERTICALS),
  // The three bases a manager's override can be written on. `job_cost` and
  // `margin` exist in the enum for roofing-era rules and are deliberately not
  // offered here — neither engine pays an override on them.
  type: z.enum(["percentage", "flat", "ppw"]),
  percent: z.number().min(0).max(100).default(0),
  flatAmount: z.number().int().min(0).default(0), // cents
  perWattMills: z.number().int().min(0).default(0), // tenths of a cent per watt
});

/**
 * Create/update an override: `beneficiary` earns off `source`'s deals in one
 * vertical. The same pair can hold a roofing rate and a solar rate at once —
 * they are separate rows, keyed by vertical, and never pay across sides.
 */
export async function setCommissionOverrideAction(input: z.infer<typeof overrideSchema>) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid override.");
  const { beneficiaryId, sourceId, vertical, type, percent, flatAmount, perWattMills } = parsed.data;
  if (beneficiaryId === sourceId) return fail("An override must be on a different person.");
  if (type === "percentage" && !(percent > 0)) return fail("Enter a percent above 0.");
  if (type === "flat" && !(flatAmount > 0)) return fail("Enter an amount above 0.");
  if (type === "ppw" && !(perWattMills > 0)) return fail("Enter a $/W rate above 0.");
  // A $/W override needs a system size to multiply, and only a solar deal has
  // one. The roofing engine has no watts to read and would silently pay zero,
  // which is the worst of both outcomes: configured, and never paid.
  if (type === "ppw" && vertical !== "solar") {
    return fail("A $/W override only applies to Solar deals — a roofing job has no system size.");
  }
  const both = await prisma.user.findMany({
    where: { companyId: me.companyId, id: { in: [beneficiaryId, sourceId] } },
    select: { id: true, role: true, verticals: true },
  });
  if (both.length < 2) return fail("User not found.");
  // A rate on a workspace the rep cannot work would silently never pay out.
  // Catch it here rather than let it sit in the sheet looking configured.
  const source = both.find((u) => u.id === sourceId);
  if (source && !userVerticals(source).includes(vertical)) {
    return fail(`That person doesn't have ${VERTICAL_LABEL[vertical]} access, so their deals can never trigger this.`);
  }
  await prisma.commissionOverride.upsert({
    where: {
      companyId_beneficiaryId_sourceId_vertical: { companyId: me.companyId, beneficiaryId, sourceId, vertical },
    },
    // Every rate field is written on both paths, including the ones this type
    // does not use. Leaving a stale figure behind is how changing an override
    // from 3% to $0.10/W leaves a 3% still sitting in the row for whichever
    // reader looks at `percent` first.
    create: { companyId: me.companyId, beneficiaryId, sourceId, vertical, type, percent, flatAmount, perWattMills },
    update: { type, percent, flatAmount, perWattMills },
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

// --- Team name (a sales manager's team) -------------------------------------

const teamNameSchema = z.object({
  userId: z.string().min(1),
  // Trimmed, and empty means "no name" rather than an empty string, so a team
  // is either named or it isn't — nothing renders as a blank chip.
  teamName: z.string().trim().max(60).nullable(),
});

/**
 * Name (or rename) a sales manager's team.
 *
 * Only a manager may hold one: a team is a manager plus their reps, so naming
 * anybody else's would create a label with nobody under it. Renaming is free
 * and retroactive — the name is read live everywhere, never copied onto a deal
 * — so "Team Alpha" becoming "Team Kings" moves the whole history with it.
 */
export async function setTeamNameAction(input: z.infer<typeof teamNameSchema>) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const parsed = teamNameSchema.safeParse(input);
  if (!parsed.success) return fail("Team names are up to 60 characters.");
  const { userId, teamName } = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
    select: { id: true, role: true },
  });
  if (!target) return fail("User not found.");
  if (target.role !== "manager") return fail("Only a sales manager can have a team.");

  await prisma.user.update({ where: { id: target.id }, data: { teamName: teamName || null } });
  revalidatePath("/portal/team");
  revalidatePath(`/portal/team/${target.id}`);
  revalidatePath("/portal/team/performance");
  return { ok: true as const };
}

/**
 * THE LIST, not a copy of the list.
 *
 * This was a hand-typed tuple of eight roles. `ROLES` gained a ninth —
 * `accountant_readonly` — and this copy did not, so the invite dropdown (which
 * reads `assignableRolesFor`) offered a role that this schema then rejected:
 * a role that existed everywhere except the one place that had to accept it,
 * and nothing failed to build, because every string in a re-typed array is
 * still a valid string.
 *
 * `ROLES` deliberately excludes the retired `customer` value, which is exactly
 * what an invite enum wants. assignable-roles.test.ts compares these lists so a
 * future copy cannot drift back apart.
 */
const ROLE_VALUES = ROLES;
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
  // Only live verticals are grantable. `others` is retired: accepting it would
  // hand out access to a workspace that no longer exists.
  verticals: z.array(z.enum(["roofing", "solar"])).min(1).optional(),
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
  const { userId, role, title, status, commissionSplitPct, providedLeadType, providedLeadSplitPct, providedLeadFlatCents, deductiblePct, verticals, salesRepId, managerId } = parsed.data;

  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId }, select: { id: true, role: true, permissions: true } });
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
        where: { id: salesRepId, companyId: me.companyId, role: { in: PAY_ELIGIBLE_ROLES }, status: "active" },
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

  // Only the Super Admin decides who can access which verticals.
  if (verticals !== undefined && me.role !== "super_admin") {
    return fail("Only the Super Admin can set vertical access.");
  }

  // Safety: don't let someone lock themselves out by changing their own role/status.
  if (target.id === me.userId) {
    if ((role && role !== target.role) || (status && status !== "active")) {
      return fail("You can't change your own role or status.");
    }
  }
  // Only a Super Admin can move someone INTO a privileged role (Super Admin,
  // Admin, Sales Manager, Accounting). Changing other fields is unaffected.
  if (role && role !== target.role && !canAssignRole(me.role, role)) {
    return fail("Only a Super Admin can assign that role.");
  }

  const roleChanged = role != null && role !== target.role;
  const statusChanged = status != null;
  // Moving somebody out of the manager role takes their team's name with them.
  // Leaving it behind would keep labelling a team on the leaderboard that no
  // longer has a manager — and would silently come back if they were ever
  // promoted again, under a name nobody remembers choosing.
  const clearTeamName = roleChanged && role !== "manager";
  // The Agents access switch goes the same way: it was given to a manager, and
  // it does not follow them into a different job. The keys are deleted, never
  // set to false (see modules/agents/access.ts).
  //
  // Cleared on ANY role change, a promotion INTO manager included. The switch
  // is a deliberate per-person grant, so making the owner flip it again after a
  // role change is the right ceremony rather than a regression — and it leaves
  // no branch here that nothing exercises.
  const clearAgentsAccess = roleChanged;
  await prisma.user.update({
    where: { id: target.id },
    data: {
      ...(role ? { role } : {}),
      ...(clearTeamName ? { teamName: null } : {}),
      ...(clearAgentsAccess ? { permissions: withoutAgentsAccess(target.permissions) as Prisma.InputJsonValue } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(status ? { status } : {}),
      ...(commissionSplitPct !== undefined ? { commissionSplitPct } : {}),
      ...(providedLeadType !== undefined ? { providedLeadType } : {}),
      ...(providedLeadSplitPct !== undefined ? { providedLeadSplitPct } : {}),
      ...(providedLeadFlatCents !== undefined ? { providedLeadFlatCents } : {}),
      ...(deductiblePct !== undefined ? { deductiblePct } : {}),
      ...(verticals !== undefined ? { verticals } : {}),
      ...(salesRepUpdate !== undefined ? { salesRepId: salesRepUpdate } : {}),
      ...(managerUpdate !== undefined ? { managerId: managerUpdate } : {}),
      // Force re-auth when role/status changes so a demoted/disabled session is invalidated.
      ...(roleChanged || statusChanged ? { sessionVersion: { increment: 1 } } : {}),
    },
  });
  // A sales rep is paid as a 1099 contractor — make sure they have a vendor.
  if (effectiveRole === "sales_rep") await ensureRepVendor(me.companyId, target.id);
  revalidatePath("/portal/team");
  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Agents access
// ---------------------------------------------------------------------------

const agentsAccessSchema = z.object({ userId: z.string().min(1), on: z.boolean() });

/**
 * The per-person Agents access switch: read agents and runs, Run now, and
 * resolve a run that needs a human. Never create or edit — config stays with
 * the owner and admins by role. Owner only, and only a manager can be given
 * it, because `manager` is where the solar coordinators sit today.
 *
 * ON and OFF ARE DELIBERATELY ASYMMETRIC. Only a manager can be GIVEN the
 * switch; turning it OFF targets any role, so a key left on somebody by a role
 * change racing a flip — or by a hand edit — can always be cleared. That
 * asymmetry is the thing that keeps a stale grant recoverable.
 */
export async function setAgentsAccessAction(input: z.infer<typeof agentsAccessSchema>) {
  const me = await requireUser();
  if (me.role !== "super_admin") return fail("Only the owner can change Agents access.");
  const parsed = agentsAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { userId, on } = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
    select: { id: true, role: true, permissions: true },
  });
  if (!target) return fail("User not found.");
  // Turning it OFF works on anyone, so a stale key can always be cleared.
  if (on && target.role !== AGENT_ACCESS_ROLE) return fail("Agents access can only be given to a manager.");

  const permissions = on ? withAgentsAccess(target.permissions) : withoutAgentsAccess(target.permissions);

  if (on) {
    // This is a read-modify-write, so the role is re-asserted in the WHERE
    // clause at WRITE time. Without it, a demotion landing between the read
    // above and this write is undone by the stale grant putting the keys back
    // — leaving a non-manager carrying Agent:read/run/approve. Only the `on`
    // path can grant, so only it needs this; a lost `off` write merely
    // resurrects an absence.
    const { count } = await prisma.user.updateMany({
      where: { id: target.id, companyId: me.companyId, role: AGENT_ACCESS_ROLE },
      data: { permissions: permissions as Prisma.InputJsonValue },
    });
    if (!count) return fail("Agents access can only be given to a manager.");
  } else {
    await prisma.user.update({ where: { id: target.id }, data: { permissions: permissions as Prisma.InputJsonValue } });
  }

  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Pay structure
// ---------------------------------------------------------------------------

// One card on the team page, one action, but two pay models that share nothing.
// Roofing splits a profit pool; solar pays either the overage above a rep's
// redline or a flat rate per watt. Every field is optional and `undefined`
// leaves the column alone, so a rep granted only one vertical never has the
// other's terms written by a form that did not show them.
const paySchema = z.object({
  userId: z.string().min(1),
  // -- Roofing: profit-pool split. null clears the field.
  commissionSplitPct: z.number().min(0).max(100).optional().nullable(),
  providedLeadType: z.enum(["percentage", "flat"]).optional(),
  providedLeadSplitPct: z.number().min(0).max(100).optional().nullable(),
  providedLeadFlatCents: z.number().int().min(0).optional().nullable(),
  deductiblePct: z.number().min(0).max(100).optional().nullable(),
  // -- Solar: cents per watt NET of the lender's fee. Bounded by the same rails
  // the pricing validator uses, so a redline cannot be set above any price a rep
  // is allowed to quote.
  solarRedlineCentsPerWatt: z.number().int().min(0).max(2000).optional().nullable(),
  // -- Solar: mills (tenths of a cent) per watt. $2.00/W of commission is already
  // absurd; the cap is a typo rail, not a policy.
  solarPerWattMills: z.number().int().min(0).max(20000).optional().nullable(),
  // -- Solar, storage-only: the per-battery pair of the two above. Neither of
  // those is reachable on a job with no watts, and until these were accepted
  // here NEITHER per-battery column could be written from any screen at all --
  // `solarRedlinePerBatteryCents` existed, was read by the payroll engine, and
  // was null on every row, so every battery-only deal silently paid nothing.
  //
  // Cents, and capped at $100,000 a battery as a typo rail on a unit that
  // really does cost five figures.
  solarRedlinePerBatteryCents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  solarPerBatteryFlatCents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  // -- Solar, storage-only: WHICH of the pair above this rep is actually paid
  // on. It belongs to the rep, not the lender: two reps working the same lender
  // can be on different plans, and letting a lender's configuration decide how
  // a person is compensated means editing a lender silently repays everybody on
  // it. Null = no plan, which writes NO commission line rather than a zero.
  solarBatteryPayPlan: z.enum(["margin", "flat"]).optional().nullable(),
  // -- Solar: what the COMPANY keeps when IT provided the lead.
  //
  // ONE METHOD, NEVER TWO. The mode is the single source of truth; the two
  // amount columns beside it are storage for whichever it names. Inferring the
  // method from which nullable field happened to be set left "both set" with no
  // defined answer and made "no adjustment" indistinguishable from "nobody has
  // configured this yet" -- on a field that decides how much of a rep's money
  // the company keeps.
  solarLeadAdjustMode: z.enum(["none", "percentage", "flat"]).optional(),
  solarCompanyLeadTakePct: z.number().min(0).max(100).optional().nullable(),
  solarCompanyLeadFlatCents: z.number().int().min(0).max(100_000_00).optional().nullable(),
});

/**
 * Set a member's pay structure — both verticals, from the Pay structure card.
 *
 * Deliberately separate from updateTeamMemberAction: role, status and vertical
 * access are access-control decisions with their own guards (a Super Admin gate,
 * a self-lockout check, a forced re-auth), and none of them should be re-run
 * because somebody corrected a decimal on a commission rate.
 */
export async function updateMemberPayAction(input: z.infer<typeof paySchema>) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid pay structure.");
  const { userId, ...pay } = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
    select: { id: true, role: true },
  });
  if (!target) return fail("User not found.");
  // Only the roles that actually earn on a deal carry pay terms — the same set
  // that may be a deal's rep. Writing them onto an installer would put a redline
  // on somebody the engine never reads. See PAY_ELIGIBLE_ROLES for why owners
  // and admins are in it: they sell deals too, and a rep with no terms produces
  // no commission line at all.
  if (!isPayEligible(target.role)) {
    return fail("Only people who can be the rep on a deal have a pay structure.");
  }

  /* THE MODE DECIDES WHICH AMOUNT SURVIVES.
   *
   * Whenever the caller names a lead-adjustment mode, the column the OTHER
   * method reads is cleared in the same write. Two live figures on one row is
   * how a rep set to "40% company take" keeps a $1,500 flat deduction sitting
   * underneath it, waiting for whichever reader looks at that column first.
   * Enforced here rather than in the form because a server action is reachable
   * without the form. */
  const data: Record<string, unknown> = Object.fromEntries(
    Object.entries(pay).filter(([, v]) => v !== undefined)
  );
  if (pay.solarLeadAdjustMode !== undefined) {
    Object.assign(
      data,
      leadAdjustColumns(pay.solarLeadAdjustMode, {
        takePct: pay.solarCompanyLeadTakePct ?? null,
        flatCents: pay.solarCompanyLeadFlatCents ?? null,
      })
    );
  }

  await prisma.user.update({ where: { id: target.id }, data });
  revalidatePath("/portal/team");
  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

/** Link a member to a specific 1099 contractor vendor (or clear the link). */
export async function setRepVendorAction(userId: string, vendorId: string | null) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId }, select: { id: true } });
  if (!target) return fail("User not found.");
  // One vendor per user: release any current link, then attach the chosen one.
  await prisma.bookkeepingVendor.updateMany({ where: { companyId: me.companyId, userId }, data: { userId: null } });
  if (vendorId) {
    const v = await prisma.bookkeepingVendor.findFirst({ where: { id: vendorId, companyId: me.companyId }, select: { id: true } });
    if (!v) return fail("Vendor not found.");
    await prisma.bookkeepingVendor.update({ where: { id: v.id }, data: { userId } });
  }
  revalidatePath(`/portal/team/${userId}`);
  return { ok: true as const };
}

/**
 * Delete a member. Default is a HARD delete so the email is fully freed and a
 * future re-invite starts clean. References that can survive without them are
 * auto-nulled by the schema (their deals become unassigned); rows they own
 * (notifications, onboarding, chat membership, overrides) cascade away.
 *
 * If they have protected financial history (commissions / proposals / payroll
 * lines — required FKs that block a hard delete), we fall back to a soft delete:
 * keep the row for that history but tombstone the email + disable the account,
 * so re-inviting the same email still works.
 */
export async function deleteTeamMemberAction(userId: string) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");
  if (userId === me.userId) return fail("You can't delete your own account.");

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
    select: { id: true, role: true, email: true },
  });
  if (!target) return fail("User not found.");
  if (target.role === "super_admin" && me.role !== "super_admin") {
    return fail("Only a Super Admin can delete a Super Admin.");
  }
  if (target.role === "super_admin") {
    const others = await prisma.user.count({
      where: { companyId: me.companyId, role: "super_admin", status: "active", deletedAt: null, id: { not: target.id } },
    });
    if (others === 0) return fail("Can't delete the last Super Admin.");
  }

  // Free anything that would block the hard delete or dangle afterward.
  await prisma.invitation.deleteMany({ where: { companyId: me.companyId, email: target.email } });
  await prisma.bookkeepingVendor.updateMany({ where: { companyId: me.companyId, userId: target.id }, data: { userId: null } });

  try {
    await prisma.user.delete({ where: { id: target.id } });
  } catch {
    // Has protected history — keep the row but tombstone the email so re-invite works.
    await prisma.user.update({
      where: { id: target.id },
      data: { deletedAt: new Date(), status: "disabled", sessionVersion: { increment: 1 }, email: `deleted+${target.id}@anexa.invalid` },
    });
  }
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
  // Only a Super Admin can invite into a privileged role (Super Admin, Admin,
  // Sales Manager, Accounting). Admins & sales managers invite staff only.
  if (!canAssignRole(me.role, parsed.data.role)) {
    return fail("Only a Super Admin can invite that role.");
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { companyId: me.companyId, email, deletedAt: null }, select: { id: true } });
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
  const { brand, fromName } = await emailBrandFor(me.companyId);
  const tpl = inviteEmailTemplate({ brand, roleLabel: roleLabel(parsed.data.role), inviteLink });
  // Branded activation email — set a password, then complete onboarding.
  const emailed = await sendEmail(email, tpl.subject, tpl.text, { fromName, html: tpl.html }).catch(() => false);

  revalidatePath("/portal/team");
  return { ok: true as const, inviteLink, emailed };
}

/** Re-send a pending invitation: rotate the token, reset the 7-day expiry, email again. */
export async function resendInvitationAction(invitationId: string) {
  const me = await requireUser();
  if (!can(me, "create", "User")) return fail("Not allowed.");
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, companyId: me.companyId, acceptedAt: null },
    select: { id: true, email: true, role: true },
  });
  if (!inv) return fail("Invitation not found.");

  // Tokens are stored hashed and can't be recovered, so resending issues a fresh
  // one (which also invalidates any older link for this invite).
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  await prisma.invitation.update({
    where: { id: inv.id },
    data: { tokenHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), invitedById: me.userId },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const inviteLink = `${appUrl}/invite/${raw}`;
  const { brand, fromName } = await emailBrandFor(me.companyId);
  const tpl = inviteEmailTemplate({ brand, roleLabel: roleLabel(inv.role), inviteLink, reminder: true });
  const emailed = await sendEmail(inv.email, tpl.subject, tpl.text, { fromName, html: tpl.html }).catch(() => false);

  revalidatePath("/portal/team");
  return { ok: true as const, inviteLink, emailed };
}

/** Revoke (delete) a pending invitation so its link no longer works. */
export async function revokeInvitationAction(invitationId: string) {
  const me = await requireUser();
  if (!can(me, "create", "User")) return fail("Not allowed.");
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, companyId: me.companyId, acceptedAt: null },
    select: { id: true },
  });
  if (!inv) return fail("Invitation not found.");
  await prisma.invitation.delete({ where: { id: inv.id } });
  revalidatePath("/portal/team");
  return { ok: true as const };
}
/**
 * REMOVE SOMEBODY'S SECOND FACTOR — the lost-phone path.
 *
 * Without this, a person who loses both their phone and their recovery codes
 * has no way back at all: the only remedy would be editing the production
 * database by hand, which is the thing this whole module exists to avoid.
 *
 * The narrow rules are NOT re-stated here. `resetEnrollment` refuses a
 * self-removal, refuses a non-owner, and scopes its delete to the company, so
 * they hold for every caller rather than for this one. What this adds is the
 * part only an action can do: establish who is asking, and resolve the target
 * through the caller's own company so an id from the browser cannot name a
 * stranger.
 *
 * Audited, because nothing else about a team change is. Removing a second
 * factor is the one team edit that weakens a money control, so it leaves a row
 * saying who did it and to whom.
 */
export async function resetMemberMfaAction(userId: string) {
  const me = await requireUser();
  if (!can(me, "update", "User")) return fail("Not allowed.");

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!target) return fail("User not found.");

  const res = await resetEnrollment({
    companyId: me.companyId,
    userId: target.id,
    actorUserId: me.userId,
    actorRole: me.role,
  });
  if (!res.ok) return res;

  const who = `${target.firstName} ${target.lastName}`.trim();
  await prisma.activityLog.create({
    data: {
      companyId: me.companyId,
      type: "system",
      message: res.removed
        ? `${me.fullName} removed ${who}'s authenticator`
        : `${me.fullName} tried to remove ${who}'s authenticator, which was not set up`,
      actorId: me.userId,
      metadata: { subjectUserId: target.id, removed: res.removed },
    },
  });

  revalidatePath(`/portal/team/${target.id}`);
  revalidatePath("/portal/books/payments");
  return { ok: true as const, removed: res.removed };
}
