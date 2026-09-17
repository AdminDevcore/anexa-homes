"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Vertical } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { postJournalEntry, voidJournalEntry, setPeriodLock, type PostingActor } from "./posting";
import { ensureChartOfAccounts } from "./chart";
import { createBankAccount, postTransfer } from "./bank-accounts";
import { closeFiscalYear, reopenFiscalYear } from "./year-end";

/**
 * THE FINANCE ACTION SURFACE.
 *
 * Every export here is a `"use server"` endpoint, which in this framework means
 * a PUBLIC RPC route — not a function that only the page rendering it can call.
 * So each one re-establishes who is asking rather than trusting the page that
 * linked to it, and `gate()` is the only way in.
 *
 * Bookkeeping is granted to super_admin and accounting alone
 * (`rbac/matrix.ts`), which is what makes "bank and finance data is visible to
 * those two roles only" true at the endpoint rather than merely in the sidebar.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * Resolve the caller and check the verb. Returns the ACTOR the posting service
 * wants, so no call site has to assemble one — an actor built by hand is an
 * actor whose role can be wrong.
 */
async function gate(action: "create" | "read" | "update" | "delete") {
  const user = await requireUser();
  if (!can(user, action, "Bookkeeping")) {
    return { user: null, actor: null, denied: fail("Not allowed.") };
  }
  const actor: PostingActor = { kind: "user", userId: user.userId, role: user.role };
  return { user, actor, denied: null };
}

const lineSchema = z.object({
  accountId: z.string().min(1),
  // Dollars at the edge, cents everywhere inside. The conversion happens once,
  // here, so no downstream code has to wonder which it is holding.
  debit: z.number().min(0).optional(),
  credit: z.number().min(0).optional(),
  vertical: z.enum(["roofing", "solar", "others"]).nullish(),
  projectId: z.string().nullish(),
  vendorId: z.string().nullish(),
  memo: z.string().max(300).nullish(),
});

const entrySchema = z.object({
  date: z.string().min(1),
  memo: z.string().max(300).optional(),
  lines: z.array(lineSchema).min(2).max(200),
  lockOverrideReason: z.string().max(300).optional(),
});

const toCents = (dollars: number | undefined): number => Math.round((dollars ?? 0) * 100);

/** Hand-write one balanced entry. */
export async function postManualEntryAction(input: z.infer<typeof entrySchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return fail("Enter a date and at least two lines.");
  const d = parsed.data;

  const date = new Date(`${d.date}T12:00:00`);
  if (Number.isNaN(date.getTime())) return fail("Enter a valid date.");

  const res = await postJournalEntry({
    companyId: user!.companyId,
    date,
    memo: d.memo ?? null,
    sourceType: "manual",
    sourceId: null,
    actor: actor!,
    lockOverrideReason: d.lockOverrideReason,
    lines: d.lines.map((l) => ({
      accountId: l.accountId,
      debitCents: toCents(l.debit),
      creditCents: toCents(l.credit),
      vertical: (l.vertical ?? null) as Vertical | null,
      projectId: l.projectId ?? null,
      vendorId: l.vendorId ?? null,
      memo: l.memo ?? null,
    })),
  });

  if (!res.ok) return res;
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const, entryId: res.entryId };
}

const voidSchema = z.object({ entryId: z.string().min(1), reason: z.string().min(1).max(300) });

/** Void by reversal. Never a delete. */
export async function voidEntryAction(input: z.infer<typeof voidSchema>) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return fail("Say why this entry is being voided.");

  const res = await voidJournalEntry({
    companyId: user!.companyId,
    entryId: parsed.data.entryId,
    reason: parsed.data.reason,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const, reversalId: res.entryId };
}

const lockSchema = z.object({
  lockedThrough: z.string().nullable(),
  note: z.string().max(300).optional(),
});

/**
 * Close or reopen the books. Owner-only — enforced inside `setPeriodLock`
 * against the ACTOR's role, not here, so the rule holds for every caller
 * including a future cron or import.
 */
export async function setPeriodLockAction(input: z.infer<typeof lockSchema>) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;
  const parsed = lockSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a date, or clear it to reopen.");

  let lockedThrough: Date | null = null;
  if (parsed.data.lockedThrough) {
    lockedThrough = new Date(`${parsed.data.lockedThrough}T23:59:59`);
    if (Number.isNaN(lockedThrough.getTime())) return fail("Enter a valid date.");
  }

  const res = await setPeriodLock({
    companyId: user!.companyId,
    lockedThrough,
    note: parsed.data.note ?? null,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

/** Create the chart of accounts. Idempotent, so the button is safe to re-press. */
export async function seedChartAction() {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const res = await ensureChartOfAccounts(user!.companyId);
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const, created: res.created };
}

const bankSchema = z.object({
  name: z.string().min(1).max(120),
  institution: z.string().max(120).optional(),
  mask: z.string().max(8).optional(),
  kind: z.enum(["checking", "savings", "credit_card"]),
  defaultVertical: z.enum(["roofing", "solar", "others"]).nullish(),
  openingBalance: z.number().optional(),
  openingBalanceDate: z.string().optional(),
});

export async function createBankAccountAction(input: z.infer<typeof bankSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = bankSchema.safeParse(input);
  if (!parsed.success) return fail("Give the account a name and a type.");
  const d = parsed.data;

  let openingBalanceDate: Date | null = null;
  if (d.openingBalanceDate) {
    openingBalanceDate = new Date(`${d.openingBalanceDate}T12:00:00`);
    if (Number.isNaN(openingBalanceDate.getTime())) return fail("Enter a valid opening date.");
  }

  const res = await createBankAccount({
    companyId: user!.companyId,
    name: d.name,
    institution: d.institution ?? null,
    mask: d.mask ?? null,
    kind: d.kind,
    defaultVertical: (d.defaultVertical ?? null) as Vertical | null,
    openingBalanceCents: toCents(d.openingBalance),
    openingBalanceDate,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const, bankAccountId: res.bankAccountId };
}

const transferSchema = z.object({
  fromBankAccountId: z.string().min(1),
  toBankAccountId: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().min(1),
  memo: z.string().max(300).optional(),
});

/** Money between our own accounts — including paying a credit card down. */
export async function postTransferAction(input: z.infer<typeof transferSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fail("Pick two accounts and an amount.");
  const d = parsed.data;

  const date = new Date(`${d.date}T12:00:00`);
  if (Number.isNaN(date.getTime())) return fail("Enter a valid date.");

  const res = await postTransfer({
    companyId: user!.companyId,
    fromBankAccountId: d.fromBankAccountId,
    toBankAccountId: d.toBankAccountId,
    amountCents: toCents(d.amount),
    date,
    memo: d.memo ?? null,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

const yearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  lockOverrideReason: z.string().max(300).optional(),
});

/**
 * Close a fiscal year into Retained Earnings.
 *
 * `gate("update")` establishes that the caller may touch the books at all;
 * OWNER-ONLY is enforced inside `closeFiscalYear` against the actor's role, not
 * here, so the rule survives a future cron or import that never goes through
 * this action. Same division as `setPeriodLockAction`.
 */
export async function closeFiscalYearAction(input: z.infer<typeof yearSchema>) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;
  const parsed = yearSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a year to close.");

  const res = await closeFiscalYear({
    companyId: user!.companyId,
    year: parsed.data.year,
    actor: actor!,
    lockOverrideReason: parsed.data.lockOverrideReason,
  });
  if (!res.ok) return res;

  revalidatePath("/portal/books");
  return { ok: true as const, entryId: res.entryId, netIncomeCents: res.netIncomeCents };
}

const reopenSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  reason: z.string().min(1).max(300),
});

/** Reopen a closed year by reversing the close. Never a delete. */
export async function reopenFiscalYearAction(input: z.infer<typeof reopenSchema>) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return fail("Say why the year is being reopened.");

  const res = await reopenFiscalYear({
    companyId: user!.companyId,
    year: parsed.data.year,
    reason: parsed.data.reason,
    actor: actor!,
  });
  if (!res.ok) return res;

  revalidatePath("/portal/books");
  return { ok: true as const, reversalId: res.reversalId };
}

const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  taxLine: z.string().max(120).nullish(),
  active: z.boolean().optional(),
});

/**
 * Rename an account, map its tax line, or deactivate it.
 *
 * A SYSTEM account cannot be deactivated and its class cannot change: a posting
 * routine resolves it by `systemKey`, so switching off Accounts Receivable
 * would break invoicing in a way whose error message would name neither.
 * Renaming one is fine — the handle is the id, not the label.
 */
export async function updateLedgerAccountAction(input: z.infer<typeof accountSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid change.");
  const d = parsed.data;

  const account = await prisma.ledgerAccount.findFirst({
    where: { id: d.id, companyId: user!.companyId },
    select: { id: true, systemKey: true, name: true, active: true, taxLine: true },
  });
  if (!account) return fail("Account not found.");

  if (account.systemKey && d.active === false) {
    return fail(`"${account.name}" is used by the system and cannot be switched off.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.ledgerAccount.update({
      where: { id: account.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.taxLine !== undefined ? { taxLine: d.taxLine ?? null } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        companyId: user!.companyId,
        actorId: user!.userId,
        actorLabel: user!.userId,
        action: "account.update",
        entityType: "LedgerAccount",
        entityId: account.id,
        before: { name: account.name, active: account.active, taxLine: account.taxLine },
        after: {
          name: d.name ?? account.name,
          active: d.active ?? account.active,
          taxLine: d.taxLine !== undefined ? (d.taxLine ?? null) : account.taxLine,
        },
      },
    });
  });

  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}
