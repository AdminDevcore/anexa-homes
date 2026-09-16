// `Prisma` is a VALUE here, not just a namespace of types: `Prisma.JsonNull` is
// how a Json column is set to SQL null, and a type-only import of it compiles
// and then crashes at runtime with "Cannot read properties of undefined".
import { Prisma } from "@prisma/client";
import type { Vertical, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";

/**
 * THE ONLY DOOR INTO THE LEDGER.
 *
 * Nothing else in this codebase may write `journal_entries` or `journal_lines`.
 * Every rule that makes a set of books trustworthy is enforced here, once:
 *
 *   • debits equal credits, in integer cents, or nothing is written;
 *   • a closed period rejects the entry unless a super_admin says why;
 *   • a keyed source cannot post the same thing twice;
 *   • every write leaves an audit record naming who did it and what changed;
 *   • an entry is never deleted — voiding writes a REVERSING entry and keeps
 *     both, because a ledger you can delete from is not evidence of anything.
 *
 * The reason this is a chokepoint rather than a convention: the single-entry
 * ledger it replaces was written from eight different call sites, each with its
 * own idea of what a valid row looked like, and the only thing keeping the
 * books straight was that everybody remembered. `deal-money.ts` is the standing
 * proof of how that ends — a payload widened to `Record<string, unknown>` type-
 * checked perfectly and wrote a column that no longer existed.
 */

/** Who is posting. A system actor can never override a period lock. */
export type PostingActor =
  | { kind: "user"; userId: string; role: Role }
  | { kind: "system"; label: string };

export type JournalLineInput = {
  /** Give either an explicit account id or a `systemKey` to resolve. */
  accountId?: string;
  systemKey?: string;
  /** Exactly ONE of these is non-zero. Integer cents, never negative. */
  debitCents?: number;
  creditCents?: number;
  /**
   * The department. Left undefined, the vertical extension resolves it from
   * `projectId`, then from the ambient workspace — which is what makes a bank
   * fee company-level and an install's materials solar without either caller
   * having to think about it.
   */
  vertical?: Vertical | null;
  projectId?: string | null;
  vendorId?: string | null;
  memo?: string | null;
};

export type PostEntryInput = {
  companyId: string;
  date: Date;
  memo?: string | null;
  /** "manual" | "payroll" | "bank_feed" | "invoice" | "bill" | "payment" | … */
  sourceType: string;
  /**
   * The producer's own key. Uniquely constrained with `sourceType`, so posting
   * the same source twice is refused by the DATABASE rather than by a lookup
   * that races. NULL for hand-written entries, of which there may be any number.
   */
  sourceId?: string | null;
  lines: JournalLineInput[];
  actor: PostingActor;
  /** Required to post INTO a closed period, and only a super_admin may. */
  lockOverrideReason?: string;
};

export type PostResult =
  | { ok: true; entryId: string; duplicate: boolean }
  | { ok: false; error: string };

const MAX_CENTS = Number.MAX_SAFE_INTEGER;

function isCents(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_CENTS;
}

function actorId(actor: PostingActor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}
function actorLabel(actor: PostingActor): string {
  return actor.kind === "user" ? actor.userId : `system:${actor.label}`;
}

/**
 * Resolve each line's account id, accepting a `systemKey` so posting routines
 * can say "Accounts Receivable" without knowing this company's numbering.
 *
 * Every account is checked to belong to THIS company and to be active. An
 * inactive account is refused rather than silently posted to: deactivating an
 * account is how a bookkeeper retires it, and a routine that keeps posting
 * there makes that meaningless.
 */
async function resolveAccounts(
  companyId: string,
  lines: JournalLineInput[]
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const keys = [...new Set(lines.map((l) => l.systemKey).filter((k): k is string => !!k))];
  const ids = [...new Set(lines.map((l) => l.accountId).filter((i): i is string => !!i))];

  const accounts = await prisma.ledgerAccount.findMany({
    where: {
      companyId,
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(keys.length ? [{ systemKey: { in: keys } }] : []),
      ],
    },
    select: { id: true, systemKey: true, active: true, name: true },
  });

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byKey = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));

  const resolved: string[] = [];
  for (const line of lines) {
    const account = line.accountId ? byId.get(line.accountId) : line.systemKey ? byKey.get(line.systemKey) : undefined;
    if (!account) {
      return {
        ok: false,
        error: `No such account on this company: ${line.accountId ?? line.systemKey ?? "(none given)"}.`,
      };
    }
    if (!account.active) {
      return { ok: false, error: `Account "${account.name}" is inactive and cannot be posted to.` };
    }
    resolved.push(account.id);
  }
  return { ok: true, ids: resolved };
}

/**
 * Is this date inside a closed period, and may this actor post there anyway?
 *
 * The lock is a DATE, not a flag: everything on or before it is closed. A
 * super_admin may still post, and must say why — the reason lands on the entry
 * and in the finance audit, so a closed period that moved can always be
 * explained afterwards.
 */
async function checkPeriodLock(
  companyId: string,
  date: Date,
  actor: PostingActor,
  reason: string | undefined
): Promise<{ ok: true; override: string | null } | { ok: false; error: string }> {
  const lock = await prisma.accountingPeriodLock.findUnique({
    where: { companyId },
    select: { lockedThrough: true },
  });
  if (!lock || date > lock.lockedThrough) return { ok: true, override: null };

  const closed = lock.lockedThrough.toISOString().slice(0, 10);
  if (actor.kind !== "user" || actor.role !== "super_admin") {
    return {
      ok: false,
      error: `The books are closed through ${closed}. Only an owner can post into a closed period.`,
    };
  }
  if (!reason || !reason.trim()) {
    return {
      ok: false,
      error: `The books are closed through ${closed}. Posting into a closed period needs a reason.`,
    };
  }
  return { ok: true, override: reason.trim() };
}

/**
 * A line may tag a JOB and a VENDOR, and both ids come from the caller.
 *
 * Neither was checked until now. An id supplied by a browser was written
 * straight onto `journal_lines`, so a bookkeeper at one company could tag a
 * line to another company's job — and nothing about the resulting entry would
 * look wrong. It balances, it posts, and the cost appears against a deal its
 * owner cannot see. Accounts were already resolved against the company by
 * `resolveAccounts`; this closes the same gap for the other two ids.
 *
 * ── UNSCOPED BY VERTICAL, DELIBERATELY ──────────────────────────────────────
 * `Project` is a SCOPED model, so an ordinary read here would be filtered to
 * the active workspace. That would reject a perfectly valid roofing job merely
 * because the poster happened to be in the solar workspace — and one entry may
 * legitimately carry lines for both departments (a single cheque paying a
 * roofing sub and a solar sub), which is the entire reason the tag sits on the
 * LINE rather than the entry. Payroll accrual posts across both.
 *
 * The property being enforced here is TENANCY — does this row belong to this
 * company — and it is checked explicitly, not inherited from an ambient filter.
 * Per-VIEWER scoping is a different question and belongs at the action
 * (`projectAccessible`), where there is a user to ask about.
 */
async function resolveReferences(
  companyId: string,
  lines: JournalLineInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const projectIds = [...new Set(lines.map((l) => l.projectId).filter((v): v is string => !!v))];
  const vendorIds = [...new Set(lines.map((l) => l.vendorId).filter((v): v is string => !!v))];
  if (projectIds.length === 0 && vendorIds.length === 0) return { ok: true };

  return runUnscoped(
    "journal posting: confirm a line's job and vendor belong to this company",
    async () => {
      if (projectIds.length > 0) {
        const found = await prisma.project.findMany({
          where: { companyId, id: { in: projectIds } },
          select: { id: true },
        });
        if (found.length !== projectIds.length) {
          // The id is never echoed: whether a row exists elsewhere is not
          // something this error should confirm.
          return { ok: false as const, error: "That job is not on this company's books." };
        }
      }
      if (vendorIds.length > 0) {
        const found = await prisma.bookkeepingVendor.findMany({
          where: { companyId, id: { in: vendorIds } },
          select: { id: true },
        });
        if (found.length !== vendorIds.length) {
          return { ok: false as const, error: "That vendor is not on this company's books." };
        }
      }
      return { ok: true as const };
    }
  );
}

/** Validate the lines on their own terms, before any database work. */
function validateLines(lines: JournalLineInput[]): { ok: true } | { ok: false; error: string } {
  if (lines.length < 2) return { ok: false, error: "An entry needs at least two lines." };

  let debits = 0;
  let credits = 0;
  for (const [i, line] of lines.entries()) {
    const d = line.debitCents ?? 0;
    const c = line.creditCents ?? 0;
    if (!isCents(d) || !isCents(c)) {
      return { ok: false, error: `Line ${i + 1}: amounts must be whole cents, zero or more.` };
    }
    if (d > 0 && c > 0) {
      return { ok: false, error: `Line ${i + 1} is both a debit and a credit. It can only be one.` };
    }
    if (d === 0 && c === 0) return { ok: false, error: `Line ${i + 1} has no amount.` };
    if (!line.accountId && !line.systemKey) {
      return { ok: false, error: `Line ${i + 1} has no account.` };
    }
    debits += d;
    credits += c;
  }

  if (debits !== credits) {
    // The message names both sides. "Out of balance" alone sends a bookkeeper
    // hunting through a screen of rows for a number nobody told them.
    return {
      ok: false,
      error: `Out of balance: debits ${debits} ≠ credits ${credits} (a difference of ${Math.abs(debits - credits)} cents).`,
    };
  }
  if (debits === 0) return { ok: false, error: "An entry cannot be for nothing." };
  return { ok: true };
}

/**
 * Post one balanced entry. Idempotent per `(sourceType, sourceId)`.
 *
 * A duplicate is NOT an error. A payroll run that died half way is re-posted by
 * running it again, and the entries that already landed come back
 * `duplicate: true` rather than failing the whole run — which is the lesson the
 * per-line dedup in `payroll/post-bookkeeping.ts` already learned the hard way.
 */
export async function postJournalEntry(input: PostEntryInput): Promise<PostResult> {
  const { companyId, date, sourceType, actor } = input;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return { ok: false, error: "Invalid entry date." };
  }

  const shape = validateLines(input.lines);
  if (!shape.ok) return shape;

  const accounts = await resolveAccounts(companyId, input.lines);
  if (!accounts.ok) return accounts;

  const references = await resolveReferences(companyId, input.lines);
  if (!references.ok) return references;

  const lock = await checkPeriodLock(companyId, date, actor, input.lockOverrideReason);
  if (!lock.ok) return lock;

  const sourceId = input.sourceId ?? null;

  // Already posted? Answer from the row rather than racing the constraint.
  if (sourceId) {
    const existing = await prisma.journalEntry.findFirst({
      where: { companyId, sourceType, sourceId },
      select: { id: true },
    });
    if (existing) return { ok: true, entryId: existing.id, duplicate: true };
  }

  const lineData = input.lines.map((line, i) => ({
    companyId,
    accountId: accounts.ids[i],
    debitCents: line.debitCents ?? 0,
    creditCents: line.creditCents ?? 0,
    // MAPPED, NEVER SPREAD. `JournalLineInput` carries `systemKey`, which is not
    // a column; spreading the caller's object would type-check (a spread is
    // exempt from excess-property checking) and fail at runtime with Prisma's
    // "Unknown argument". Naming each field is what makes that impossible.
    ...(line.vertical !== undefined ? { vertical: line.vertical } : {}),
    projectId: line.projectId ?? null,
    vendorId: line.vendorId ?? null,
    memo: line.memo ?? null,
    position: i,
  }));

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          companyId,
          date,
          memo: input.memo ?? null,
          sourceType,
          sourceId,
          status: "posted",
          lockOverrideReason: lock.override,
          createdById: actorId(actor),
          lines: { create: lineData },
        },
        select: { id: true, date: true, memo: true, sourceType: true, sourceId: true },
      });

      await tx.financeAuditEvent.create({
        data: {
          companyId,
          actorId: actorId(actor),
          actorLabel: actorLabel(actor),
          action: "journal.post",
          entityType: "JournalEntry",
          entityId: created.id,
          before: Prisma.JsonNull,
          after: {
            date: created.date.toISOString(),
            memo: created.memo,
            sourceType: created.sourceType,
            sourceId: created.sourceId,
            lines: lineData.map((l) => ({
              accountId: l.accountId,
              debitCents: l.debitCents,
              creditCents: l.creditCents,
              projectId: l.projectId,
              vendorId: l.vendorId,
            })),
          },
          reason: lock.override,
        },
      });

      return created;
    });

    return { ok: true, entryId: entry.id, duplicate: false };
  } catch (e) {
    // The unique constraint is the real guard; the lookup above is the fast
    // path. Two requests posting the same source at once land here, and the
    // loser reports the winner's entry rather than an error.
    if (isUniqueViolation(e) && sourceId) {
      const existing = await prisma.journalEntry.findFirst({
        where: { companyId, sourceType, sourceId },
        select: { id: true },
      });
      if (existing) return { ok: true, entryId: existing.id, duplicate: true };
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "P2002"
  );
}

export type VoidInput = {
  companyId: string;
  entryId: string;
  reason: string;
  actor: PostingActor;
  /** Defaults to the original entry's date, which is what keeps a period tidy. */
  date?: Date;
};

/**
 * Void by REVERSING, never by deleting.
 *
 * The reversal is a real entry with every debit and credit swapped, dated (by
 * default) on the original's date so a closed month does not silently move. The
 * original stays in the books marked `void` and the two point at each other, so
 * the general ledger shows what happened and what undid it.
 *
 * Voiding into a closed period obeys exactly the same lock as posting: it IS a
 * posting.
 */
export async function voidJournalEntry(input: VoidInput): Promise<PostResult> {
  const { companyId, entryId, actor } = input;
  const reason = input.reason?.trim();
  if (!reason) return { ok: false, error: "Voiding an entry needs a reason." };

  const original = await prisma.journalEntry.findFirst({
    where: { id: entryId, companyId },
    select: {
      id: true,
      date: true,
      memo: true,
      status: true,
      sourceType: true,
      sourceId: true,
      lines: {
        orderBy: { position: "asc" },
        select: {
          accountId: true,
          debitCents: true,
          creditCents: true,
          vertical: true,
          projectId: true,
          vendorId: true,
          memo: true,
        },
      },
    },
  });
  if (!original) return { ok: false, error: "Entry not found." };
  if (original.status === "void") return { ok: false, error: "That entry is already void." };

  /**
   * A RECONCILED LINE IS LOCKED.
   *
   * If any line of this entry was cleared against a bank statement, the entry
   * cannot be voided until that reconciliation is undone. A month that has been
   * agreed with the bank stops being evidence the moment its lines can still
   * move underneath it — and the reconciliation would silently stop adding up,
   * with nothing on screen saying why.
   *
   * Counted inline rather than imported from `reconcile.ts`, which already
   * imports this module's actor type; six lines is cheaper than a cycle.
   */
  const lockedLines = await prisma.journalLine.count({
    where: {
      companyId,
      entryId: original.id,
      reconciledAt: { not: null },
      bankReconciliation: { status: "completed" },
    },
  });
  if (lockedLines > 0) {
    return {
      ok: false,
      error:
        "This entry has been reconciled against a bank statement. Undo that reconciliation before voiding it.",
    };
  }

  const date = input.date ?? original.date;
  // The void reason IS the lock reason. Voiding already demands one, so a
  // separate override field would be a second box asking the same question.
  const lock = await checkPeriodLock(companyId, date, actor, reason);
  if (!lock.ok) return lock;

  const reversed = await prisma.$transaction(async (tx) => {
    const reversal = await tx.journalEntry.create({
      data: {
        companyId,
        date,
        memo: `Reversal of ${original.memo ?? original.sourceType} — ${reason}`,
        sourceType: `${original.sourceType}.reversal`,
        // The reversal borrows the original's key so IT cannot be posted twice
        // either, while leaving the original's own (sourceType, sourceId) intact.
        sourceId: original.sourceId ? `${original.sourceId}:reversal` : null,
        status: "posted",
        reversesId: original.id,
        lockOverrideReason: lock.override,
        createdById: actorId(actor),
        lines: {
          create: original.lines.map((l, i) => ({
            companyId,
            accountId: l.accountId,
            // The swap. This is the whole of what a reversal is.
            debitCents: l.creditCents,
            creditCents: l.debitCents,
            vertical: l.vertical,
            projectId: l.projectId,
            vendorId: l.vendorId,
            memo: l.memo,
            position: i,
          })),
        },
      },
      select: { id: true },
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: {
        status: "void",
        voidReason: reason,
        voidedAt: new Date(),
        voidedById: actorId(actor),
        updatedById: actorId(actor),
      },
    });

    await tx.financeAuditEvent.create({
      data: {
        companyId,
        actorId: actorId(actor),
        actorLabel: actorLabel(actor),
        action: "journal.void",
        entityType: "JournalEntry",
        entityId: original.id,
        before: { status: original.status },
        after: { status: "void", reversalEntryId: reversal.id },
        reason,
      },
    });

    return reversal;
  });

  return { ok: true, entryId: reversed.id, duplicate: false };
}

export type SetPeriodLockInput = {
  companyId: string;
  /** Everything dated on or before this is closed. */
  lockedThrough: Date | null;
  note?: string | null;
  actor: PostingActor;
};

/**
 * Move (or lift) the close date. Owner-only, and always audited with both the
 * old value and the new one — lifting a lock is the more interesting direction
 * and the one an auditor will ask about.
 */
export async function setPeriodLock(
  input: SetPeriodLockInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { companyId, lockedThrough, actor } = input;
  if (actor.kind !== "user" || actor.role !== "super_admin") {
    return { ok: false, error: "Only an owner can close or reopen a period." };
  }

  const before = await prisma.accountingPeriodLock.findUnique({
    where: { companyId },
    select: { lockedThrough: true, note: true },
  });

  await prisma.$transaction(async (tx) => {
    if (lockedThrough === null) {
      if (before) await tx.accountingPeriodLock.delete({ where: { companyId } });
    } else {
      await tx.accountingPeriodLock.upsert({
        where: { companyId },
        create: { companyId, lockedThrough, note: input.note ?? null, updatedById: actor.userId },
        update: { lockedThrough, note: input.note ?? null, updatedById: actor.userId },
      });
    }

    await tx.financeAuditEvent.create({
      data: {
        companyId,
        actorId: actor.userId,
        actorLabel: actor.userId,
        action: lockedThrough === null ? "period.unlock" : "period.lock",
        entityType: "AccountingPeriodLock",
        entityId: companyId,
        before: before ? { lockedThrough: before.lockedThrough.toISOString(), note: before.note } : Prisma.JsonNull,
        after: lockedThrough ? { lockedThrough: lockedThrough.toISOString(), note: input.note ?? null } : Prisma.JsonNull,
        reason: input.note ?? null,
      },
    });
  });

  return { ok: true };
}

/** The close date, or null when the books are fully open. */
export async function getPeriodLock(companyId: string): Promise<Date | null> {
  const lock = await prisma.accountingPeriodLock.findUnique({
    where: { companyId },
    select: { lockedThrough: true },
  });
  return lock?.lockedThrough ?? null;
}
