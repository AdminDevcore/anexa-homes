"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import type { PostingActor } from "@/server/modules/books/posting";
import { createPayee, updatePayeeBankDetails, setPayeeActive } from "./payees";
import { createPayment, submitPayment, approvePayment, sendPayment, cancelPayment } from "./payments";

/**
 * THE PAYMENTS ACTION SURFACE.
 *
 * Every export here is a `"use server"` endpoint, which is a PUBLIC RPC route
 * rather than a function only its own page may call. So each one re-establishes
 * the caller and checks the verb; `gate()` is the only way in, exactly as in
 * bank-feeds/actions.ts and books/actions.ts.
 *
 * Gated on `Payment`, NOT on `Bookkeeping`. Reading the books and sending money
 * are different powers, and `accounting` holds `Bookkeeping: ALL` — folding
 * payments under it would have granted "can move money" to everyone who already
 * had `manage` on the ledger, by inheritance rather than by decision.
 *
 * Note what is NOT re-checked here: maker-checker, the second factor, the
 * cooling-off period and the limits all live in the modules below. An action
 * that re-implemented them would be a second copy to keep in step, and the
 * first one to drift would be the one nobody was testing.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

async function gate(action: "create" | "read" | "update" | "approve") {
  const user = await requireUser();
  if (!can(user, action, "Payment")) {
    return { user: null, actor: null, denied: fail("Not allowed.") };
  }
  const actor: PostingActor = { kind: "user", userId: user.userId, role: user.role };
  return { user, actor, denied: null };
}

function revalidate() {
  revalidatePath("/portal/books");
  revalidatePath("/portal/books/payments");
}

// ── Payees ──────────────────────────────────────────────────────────────────

const bankSchema = z.object({
  routingNumber: z.string().min(9).max(20),
  accountNumber: z.string().min(4).max(40),
  accountType: z.enum(["checking", "savings"]),
});

const createPayeeSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullish(),
  vendorId: z.string().nullish(),
  bank: bankSchema.nullish(),
});

export async function createPayeeAction(input: z.infer<typeof createPayeeSchema>) {
  const { user, denied } = await gate("create");
  if (denied) return denied;
  const parsed = createPayeeSchema.safeParse(input);
  if (!parsed.success) return fail("Check the payee's details.");

  const res = await createPayee({
    companyId: user!.companyId,
    name: parsed.data.name,
    email: parsed.data.email ?? null,
    vendorId: parsed.data.vendorId ?? null,
    bank: parsed.data.bank ?? null,
    actorUserId: user!.userId,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

const updateBankSchema = z.object({
  payeeId: z.string().min(1),
  bank: bankSchema,
});

export async function updatePayeeBankDetailsAction(input: z.infer<typeof updateBankSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = updateBankSchema.safeParse(input);
  if (!parsed.success) return fail("Check the bank details.");

  const res = await updatePayeeBankDetails({
    companyId: user!.companyId,
    payeeId: parsed.data.payeeId,
    bank: parsed.data.bank,
    actorUserId: user!.userId,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function setPayeeActiveAction(input: { payeeId: string; active: boolean }) {
  const { user, denied } = await gate("update");
  if (denied) return denied;

  const res = await setPayeeActive({
    companyId: user!.companyId,
    payeeId: input.payeeId,
    active: input.active,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

// ── Payments ────────────────────────────────────────────────────────────────

const createPaymentSchema = z.object({
  payeeId: z.string().min(1),
  billId: z.string().min(1),
  bankAccountId: z.string().min(1),
  /** Dollars at the edge, cents inside — converted once, here. */
  amount: z.number().positive(),
  memo: z.string().max(300).nullish(),
});

export async function createPaymentAction(input: z.infer<typeof createPaymentSchema>) {
  const { user, denied } = await gate("create");
  if (denied) return denied;
  const parsed = createPaymentSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a bill, a payee and an amount.");

  const res = await createPayment({
    companyId: user!.companyId,
    payeeId: parsed.data.payeeId,
    billId: parsed.data.billId,
    bankAccountId: parsed.data.bankAccountId,
    amountCents: Math.round(parsed.data.amount * 100),
    memo: parsed.data.memo ?? null,
    actorUserId: user!.userId,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function submitPaymentAction(input: { paymentId: string }) {
  const { user, denied } = await gate("update");
  if (denied) return denied;

  const res = await submitPayment({
    companyId: user!.companyId,
    paymentId: input.paymentId,
    actorUserId: user!.userId,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

const approveSchema = z.object({
  paymentId: z.string().min(1),
  /** Six digits, or a recovery code. */
  mfaCode: z.string().min(6).max(20),
});

/**
 * Approve — the checker's act.
 *
 * Gated on `approve`, which is a verb `accounting` and the owner hold and
 * nobody else does. That the SAME person cannot approve their own payment is
 * not expressible as a permission and is enforced in the module.
 */
export async function approvePaymentAction(input: z.infer<typeof approveSchema>) {
  const { user, denied } = await gate("approve");
  if (denied) return denied;
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the code from your authenticator.");

  const res = await approvePayment({
    companyId: user!.companyId,
    paymentId: parsed.data.paymentId,
    actorUserId: user!.userId,
    mfaCode: parsed.data.mfaCode,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

/** Release the money. Separate from approving, and separately gated. */
export async function sendPaymentAction(input: { paymentId: string }) {
  const { user, actor, denied } = await gate("approve");
  if (denied) return denied;

  const res = await sendPayment({
    companyId: user!.companyId,
    paymentId: input.paymentId,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function cancelPaymentAction(input: { paymentId: string }) {
  const { user, denied } = await gate("update");
  if (denied) return denied;

  const res = await cancelPayment({ companyId: user!.companyId, paymentId: input.paymentId });
  if (!res.ok) return res;
  revalidate();
  return res;
}
