import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";

/**
 * WHAT A SIGNATURE FREEZES.
 *
 * A solar deal's economics were editable for ever. `saveSolarFinanceAction`,
 * the equipment picker, the lender picker, the adder actions and the credit
 * tick-boxes were all guarded by `Lead:update` and row scope and by nothing
 * else — so after the customer signed, the price, the system size, the lender,
 * the adders and the tax-credit assumptions could all still be changed by
 * anybody who could open the deal, including the rep whose commission moves
 * with them.
 *
 * That last part is the sharp end. `SolarDealComp` correctly freezes the pay
 * RATES at signing, but a redline is measured against `basePriceCents`, which
 * payroll recomputes live from `SolarFinance` on every run. Raising the price
 * after signature therefore raised the rep's own commission, on their own deal,
 * with no lock and no trail.
 *
 * ── WHAT "SIGNED" MEANS ─────────────────────────────────────────────────────
 * Any proposal on this deal carrying a `signedAt`. Not the newest, not the
 * approved one: once a household has put their name to any version of this
 * document, the deal has been sold and its economics are a record rather than
 * a working draft. That is the same test `repriceProposalAction` already
 * applies to itself, widened from one action to all of them.
 *
 * ── WHAT IS **NOT** LOCKED, DELIBERATELY ────────────────────────────────────
 * Only the contract economics. A signed deal still has months of work ahead of
 * it and the operational record has to keep moving: AHJ and permit numbers,
 * interconnection and PTO fields, the site survey, the plan set, notes, tasks,
 * photos, documents, stage moves, crew and install dates are all untouched by
 * this. Locking those would mean a signature stopped the job.
 *
 * ── THE OVERRIDE ────────────────────────────────────────────────────────────
 * A super admin passes. Designs do genuinely change between contract and
 * install — a structural problem, a panel that went end-of-life — and the
 * business needs a way through. What it did not have was a record: every
 * override now writes an attributed ActivityLog line naming the field, the old
 * value and the new one, so the change is answerable afterwards.
 *
 * `admin` is deliberately NOT enough. An admin runs the sales floor; rewriting
 * a signed contract's price is a narrower authority than that.
 */

/** When this deal was first signed, or null if no version ever was. */
export async function dealSignedAt(companyId: string, leadId: string): Promise<Date | null> {
  const signed = await prisma.solarProposal.findFirst({
    where: { companyId, leadId, signedAt: { not: null } },
    orderBy: { signedAt: "asc" },
    select: { signedAt: true },
  });
  return signed?.signedAt ?? null;
}

export type SignedLockVerdict =
  /** Not signed, or the caller may override. Write, then audit if `override`. */
  | { blocked: false; override: { signedAt: Date } | null }
  /** Signed, and this caller may not rewrite it. */
  | { blocked: true; error: string };

/**
 * May this user change a protected economic field on this deal?
 *
 * Callers write only on `blocked: false`, and pass `override` to
 * `auditSignedEdit` afterwards so the trail names what actually moved.
 */
export async function checkSignedLock(
  user: AccessUser & { fullName?: string },
  leadId: string,
  /**
   * What is being changed, for the trail — "the price and financing", "the
   * system design". Logged the moment an override is allowed, so a super
   * admin's edit is recorded even on the paths that cannot cheaply say what the
   * old value was.
   */
  what?: string
): Promise<SignedLockVerdict> {
  const signedAt = await dealSignedAt(user.companyId, leadId);
  if (!signedAt) return { blocked: false, override: null };

  if (user.role === "super_admin") {
    if (what) {
      try {
        await prisma.activityLog.create({
          data: {
            companyId: user.companyId,
            type: "system",
            message:
              `${user.fullName ?? "A super admin"} edited ${what} on a SIGNED contract ` +
              `(signed ${signedAt.toISOString().slice(0, 10)})`,
            actorId: user.userId,
            leadId,
          },
        });
      } catch (err) {
        console.error(`[solar] could not record a signed-contract override on ${leadId}`, err);
      }
    }
    return { blocked: false, override: { signedAt } };
  }

  return {
    blocked: true,
    error:
      "This deal has been signed, so its price, system and financing are locked. " +
      "Re-price it by issuing a new proposal, or ask a super admin to make the change on the contract.",
  };
}

/**
 * Record a super admin rewriting a signed contract.
 *
 * WHO, WHEN, WHAT, FROM AND TO. There is no free-text reason because these
 * actions take none and adding a required argument to every one of them would
 * be a UI change in ten places; the field, the before and the after are what
 * make the change answerable, and they are what the actions already hold.
 *
 * Best-effort: the edit is already committed by the time this runs, and losing
 * the log line must not fail the write and leave the caller thinking it did not
 * happen. A failure is loud in the server log rather than silent.
 */
export async function auditSignedEdit(
  user: AccessUser & { fullName?: string },
  leadId: string,
  change: { what: string; before: unknown; after: unknown }
): Promise<void> {
  const show = (v: unknown) =>
    v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  try {
    await prisma.activityLog.create({
      data: {
        companyId: user.companyId,
        type: "system",
        message:
          `${user.fullName ?? "A super admin"} changed ${change.what} on a SIGNED contract — ` +
          `${show(change.before)} → ${show(change.after)}`,
        actorId: user.userId,
        leadId,
      },
    });
  } catch (err) {
    console.error(`[solar] could not record a signed-contract override on ${leadId}`, err);
  }
}
