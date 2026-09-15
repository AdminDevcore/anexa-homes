import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { getPayStubData, buildPayStubPdf } from "./paystub";

const COMMISSION_CATEGORY = "Sales Commissions";
const CONTRACTOR_CATEGORY = "Contractor Labor";
/**
 * Clawbacks get their own line in the chart of accounts.
 *
 * Netted into "Sales Commissions" they would quietly reduce the commission
 * expense and there would be no way to answer "how much did we recover this
 * year" from the books. Job-cost EXCLUDED, like the commission it reverses.
 */
const CHARGEBACK_CATEGORY = "Commission Chargebacks";

/**
 * The expense category a payroll line books to — and the two book differently.
 *
 * A rep's commission is job-cost-EXCLUDED on purpose: it is paid OUT OF the
 * job's profit, so counting it as a cost of the job would make every sold deal
 * look worse the better it was sold.
 *
 * A subcontractor's invoice is the opposite. It is what the job cost to build,
 * the textbook job cost, and excluding it would report every install as pure
 * margin. Same payroll run, same money leaving the same account, opposite
 * treatment in the books — which is the concrete reason contractor pay is its
 * own model and not a row in the commission table.
 */
async function ensureCategory(
  companyId: string,
  name: string,
  excludeFromJobCost: boolean,
): Promise<string> {
  const existing = await prisma.bookkeepingCategory.findFirst({
    where: { companyId, name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.bookkeepingCategory.create({
    data: { companyId, name, type: "expense", excludeFromJobCost },
  });
  return created.id;
}

/** Get-or-create a vendor record for the rep so the ledger's vendor list stays tidy. */
async function ensureVendor(companyId: string, name: string): Promise<void> {
  if (!name) return;
  const existing = await prisma.bookkeepingVendor.findFirst({ where: { companyId, name }, select: { id: true } });
  if (!existing) await prisma.bookkeepingVendor.create({ data: { companyId, name } });
}

/**
 * Post a PAID payroll run to Bookkeeping: one money-out transaction per line —
 * deal-tagged, recipient as vendor — with that person's pay stub PDF attached
 * as the receipt. Commission lines land in the job-cost-EXCLUDED "Sales
 * Commissions" category; contractor lines land in "Contractor Labor", which is
 * INCLUDED, because that is what the job actually cost to build.
 *
 * ── ADJUSTMENTS ARE PART OF THE PAYOUT ──────────────────────────────────────
 * This posted commission and contractor lines only, so the ledger recorded the
 * company paying the GROSS while the bank statement showed the net. A rep with
 * a $1,000 trenching deduction left the books overstating commission expense by
 * $1,000 and the reconciliation unable to close — permanently, on every run
 * carrying an adjustment.
 *
 * A bonus, a deduction and a chargeback recovery all change what actually left
 * the account, so all three are posted. `PayrollAdjustment.amountCents` is
 * already SIGNED (positive adds, negative deducts), so the cash effect is its
 * negation — exactly the convention the commission lines use.
 *
 * The invariant this buys, asserted in `ledger-posting.itest.ts`:
 *
 *     SUM(transactions where source = payroll:<runId>)
 *       === -SUM(payStubBreakdown(...).finalCents) over every recipient
 *
 * ── IDEMPOTENT PER LINE, NOT PER RUN ────────────────────────────────────────
 * The old guard was "any transaction stamped with this run? then stop", which
 * is right for a re-post and wrong for a post that died half way: three lines
 * written, the rest abandoned, and every later attempt refused because three
 * existed. Each transaction now carries its own key in `externalId`
 * (`payroll:<runId>:item:<id>` / `:adj:<id>`) and only the missing ones are
 * written. Re-posting a complete run still writes nothing.
 */
export async function postRunToBookkeeping(companyId: string, runId: string, actorId: string): Promise<void> {
  const source = `payroll:${runId}`;

  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, companyId },
    include: {
      items: {
        include: {
          commission: { select: { projectId: true } },
          contractorPay: { select: { projectId: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      adjustments: {
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!run) return;
  if (run.items.length === 0 && run.adjustments.length === 0) return;
  // Bound locally: TypeScript's narrowing of `run` does not survive into the
  // `post` closure below, and a non-null assertion there would be load-bearing.
  const runLabel = run.label;

  // What this run has already posted, by line key. Anything in here is skipped.
  const already = new Set(
    (
      await prisma.transaction.findMany({
        where: { companyId, source },
        select: { externalId: true },
      })
    )
      .map((t) => t.externalId)
      .filter((k): k is string => !!k)
  );

  // Resolved lazily: a run of nothing but commissions must not create an empty
  // "Contractor Labor" category in the chart of accounts, and vice versa.
  let commissionCategoryId: string | null = null;
  let contractorCategoryId: string | null = null;
  const date = run.paidAt ?? new Date();

  /**
   * One pay stub per recipient, stored once and reused across that person's
   * lines — INCLUDING somebody whose only line this run is an adjustment. A rep
   * carrying nothing but a chargeback recovery is still being paid something,
   * and a receipt attached to a transaction with no stub behind it is a
   * transaction nobody can substantiate.
   */
  const recipientIds = [
    ...new Set([...run.items.map((i) => i.userId), ...run.adjustments.map((a) => a.userId)]),
  ];
  const stubByUser = new Map<string, { key: string; size: number }>();
  for (const uid of recipientIds) {
    try {
      const data = await getPayStubData(companyId, runId, uid);
      if (!data) continue;
      const pdf = await buildPayStubPdf(data);
      const buf = Buffer.from(pdf);
      const key = `companies/${companyId}/transactions/${nanoid()}-paystub-${run.label.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
      await putObject(key, buf);
      stubByUser.set(uid, { key, size: buf.length });
    } catch {
      /* attachment is best-effort — never block the booking */
    }
  }

  /** Write one ledger line, unless this run already wrote it. */
  async function post(input: {
    key: string;
    userId: string;
    name: string;
    description: string;
    /** SIGNED cash effect: negative is money leaving the account. */
    amountCents: number;
    categoryId: string;
    projectId: string | null;
  }) {
    if (already.has(input.key)) return;
    await ensureVendor(companyId, input.name);
    const txn = await prisma.transaction.create({
      data: {
        companyId,
        date,
        description: input.description,
        amountCents: input.amountCents,
        vendor: input.name,
        categoryId: input.categoryId,
        projectId: input.projectId,
        status: "categorized",
        approved: true,
        source,
        externalId: input.key,
        createdById: actorId,
      },
      select: { id: true },
    });
    already.add(input.key);

    const stub = stubByUser.get(input.userId);
    if (stub) {
      await prisma.fileAsset.create({
        data: {
          companyId,
          kind: "document",
          name: `Pay stub — ${runLabel}.pdf`,
          storageKey: stub.key,
          mimeType: "application/pdf",
          size: stub.size,
          // Payroll is a company module and the stub hangs off a GL transaction,
          // so it follows the ledger rather than a workspace. Access is still
          // gated by who can open that transaction, which is accounting only.
          scope: "company",
          transactionId: txn.id,
          uploadedById: actorId,
        },
      });
    }
  }

  for (const item of run.items) {
    const repName = `${item.user.firstName} ${item.user.lastName}`.trim();
    const isContractor = !!item.contractorPayId;
    if (isContractor) {
      contractorCategoryId ??= await ensureCategory(companyId, CONTRACTOR_CATEGORY, false);
    } else {
      commissionCategoryId ??= await ensureCategory(companyId, COMMISSION_CATEGORY, true);
    }
    await post({
      key: `${source}:item:${item.id}`,
      userId: item.userId,
      name: repName,
      description: item.label,
      amountCents: -item.amount,
      categoryId: (isContractor ? contractorCategoryId : commissionCategoryId)!,
      projectId: item.commission?.projectId ?? item.contractorPay?.projectId ?? null,
    });
  }

  /**
   * And the manual money, which is the half that was missing.
   *
   * `amountCents` is signed on the adjustment — positive adds, negative deducts
   * — so the cash effect is its negation, the same convention the lines above
   * use. A $1,000 deduction is therefore +$1,000 in the ledger: money that did
   * NOT leave.
   */
  let chargebackCategoryId: string | null = null;
  for (const adj of run.adjustments) {
    const name = `${adj.user.firstName} ${adj.user.lastName}`.trim();
    const isRecovery = adj.kind === "chargeback_recovery";
    if (isRecovery) {
      chargebackCategoryId ??= await ensureCategory(companyId, CHARGEBACK_CATEGORY, true);
    } else {
      commissionCategoryId ??= await ensureCategory(companyId, COMMISSION_CATEGORY, true);
    }
    await post({
      key: `${source}:adj:${adj.id}`,
      userId: adj.userId,
      name,
      // The reason a human typed, prefixed so the ledger says what kind of line
      // it is without anybody opening the payroll run.
      description: `${adj.kind === "bonus" ? "Bonus" : isRecovery ? "Chargeback recovery" : "Deduction"} — ${adj.reason}`,
      amountCents: -adj.amountCents,
      categoryId: (isRecovery ? chargebackCategoryId : commissionCategoryId)!,
      projectId: adj.projectId,
    });
  }
}
