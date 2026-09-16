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
 * ── THE OVERRIDE NEEDS A REASON, GIVEN FIRST ────────────────────────────────
 * A super admin can reopen a signed contract, and must say why before they do.
 * Designs genuinely change between contract and install — a structural problem,
 * a panel that went end-of-life, a lender correction — so the business needs a
 * way through; what it must never be is a silent one.
 *
 * THE REASON IS GIVEN BEFORE THE EDIT, not inferred from it afterwards, and it
 * covers the whole sitting: a super admin who reopens a contract and changes
 * the price, the panel count and the lender has made ONE decision, not three.
 * `SolarContractUnlock` is that decision — who, when, why, and until when — and
 * every protected write made under it cites it on the deal's own history,
 * alongside the old and the new value.
 *
 * Holding the authority is therefore not the same as using it: without a live
 * unlock this refuses a super admin exactly as it refuses anybody else, and
 * tells them which door to use.
 *
 * `admin` is deliberately NOT enough. An admin runs the sales floor; rewriting
 * a signed contract's price is a narrower authority than that.
 */

/**
 * How long one unlock lasts.
 *
 * Long enough to finish a sitting — reopen the contract, change the price, the
 * panel count and the lender — and short enough that an unlock left open is not
 * a lock quietly removed.
 */
export const UNLOCK_WINDOW_MINUTES = 30;

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
  /** Not signed, or the caller holds an unlock. Write, then audit if `override`. */
  | { blocked: false; override: { signedAt: Date; reason: string } | null }
  /** Signed, and this caller may not rewrite it right now. */
  | { blocked: true; error: string; needsUnlock: boolean };

/** The live unlock on this deal, if somebody has opened one. */
export async function activeUnlock(companyId: string, leadId: string) {
  return prisma.solarContractUnlock.findFirst({
    where: { companyId, leadId, expiresAt: { gt: new Date() } },
    orderBy: { unlockedAt: "desc" },
    select: { id: true, reason: true, unlockedById: true, unlockedAt: true, expiresAt: true },
  });
}

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
    /**
     * A SUPER ADMIN IS NOT AUTOMATICALLY THROUGH. They hold the authority to
     * reopen the contract; using it means saying why first. Without a live
     * unlock this refuses exactly as it does for anyone else, and the caller is
     * told which door to use.
     */
    const unlock = await activeUnlock(user.companyId, leadId);
    if (!unlock) {
      return {
        blocked: true,
        needsUnlock: true,
        error:
          "This contract is signed. Reopen it first and give a reason — the change is " +
          "recorded against it.",
      };
    }
    if (what) {
      try {
        await prisma.activityLog.create({
          data: {
            companyId: user.companyId,
            type: "system",
            message:
              `${user.fullName ?? "A super admin"} edited ${what} on a SIGNED contract ` +
              `(signed ${signedAt.toISOString().slice(0, 10)}) — reason: ${unlock.reason}`,
            actorId: user.userId,
            leadId,
          },
        });
      } catch (err) {
        console.error(`[solar] could not record a signed-contract override on ${leadId}`, err);
      }
    }
    return { blocked: false, override: { signedAt, reason: unlock.reason } };
  }

  return {
    blocked: true,
    needsUnlock: false,
    error:
      "This deal has been signed, so its price, system and financing are locked. " +
      "Re-price it by issuing a new proposal, or ask a super admin to make the change on the contract.",
  };
}

/** A live unlock, as `activeUnlock` returns it. */
export type LiveUnlock = NonNullable<Awaited<ReturnType<typeof activeUnlock>>>;

export type EconomicWriteVerdict =
  /** Not signed, or somebody has reopened it. `unlock` is null when unsigned. */
  | { blocked: false; unlock: LiveUnlock | null }
  /** Signed and closed. Nothing may recompute this deal's money. */
  | { blocked: true; signedAt: Date };

/**
 * IS THIS DEAL OPEN FOR ECONOMIC WRITES RIGHT NOW?
 *
 * The question `checkSignedLock` asks about a PERSON, asked about the DEAL
 * instead — no user, no role, no permission, because the derivations this
 * protects (`recomputeDealMoney`, `recomputeDesignFigures`) do not have one.
 * They are called from eight places and run with whatever authority their
 * caller had, so a caller that forgot to ask was a signed contract that could
 * be re-priced by anyone who could reach any screen that moves the design.
 *
 * A GUARD PER CALL SITE IS ONE NEW CALL SITE AWAY FROM BEING ABSENT. This one
 * lives underneath all of them, and the callers keep their own checks: theirs
 * refuse the person with a sentence they can act on, this one refuses the
 * WRITE. Nothing relies on either alone.
 */
export async function economicWritesAllowed(
  companyId: string,
  leadId: string
): Promise<EconomicWriteVerdict> {
  const signedAt = await dealSignedAt(companyId, leadId);
  if (!signedAt) return { blocked: false, unlock: null };
  const unlock = await activeUnlock(companyId, leadId);
  return unlock ? { blocked: false, unlock } : { blocked: true, signedAt };
}

/**
 * Record a DERIVED write that landed on a signed contract under an unlock.
 *
 * The same trail `auditSignedEdit` leaves, for the writes no person made
 * directly: a recompute is a consequence of an edit, and on a signed deal the
 * consequence is as much a change to the contract as the edit was. Attributed
 * to whoever opened the unlock, because that is whose decision it was.
 *
 * Best-effort, like every other line here: the write is already committed, and
 * losing the log must not fail it.
 */
export async function auditDerivedWrite(
  companyId: string,
  leadId: string,
  unlock: { reason: string; unlockedById: string },
  what: string,
  changes: { field: string; before: unknown; after: unknown }[]
): Promise<void> {
  const moved = changes.filter((c) => c.before !== c.after);
  if (moved.length === 0) return;
  const show = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
  try {
    await prisma.activityLog.create({
      data: {
        companyId,
        type: "system",
        message:
          `Recomputed ${what} on a SIGNED contract — ` +
          moved.map((c) => `${c.field} ${show(c.before)} → ${show(c.after)}`).join("; ") +
          ` — reason: ${unlock.reason}`,
        actorId: unlock.unlockedById,
        leadId,
      },
    });
  } catch (err) {
    console.error(`[solar] could not record a derived write on signed deal ${leadId}`, err);
  }
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
  change: { what: string; before: unknown; after: unknown; reason?: string }
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
          `${show(change.before)} → ${show(change.after)}` +
          (change.reason ? ` — reason: ${change.reason}` : ""),
        actorId: user.userId,
        leadId,
      },
    });
  } catch (err) {
    console.error(`[solar] could not record a signed-contract override on ${leadId}`, err);
  }
}
