import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { getPayStubData, buildPayStubPdf } from "./paystub";

const COMMISSION_CATEGORY = "Sales Commissions";
const CONTRACTOR_CATEGORY = "Contractor Labor";

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
 * INCLUDED, because that is what the job actually cost to build. Idempotent: a
 * run's transactions are stamped `source = "payroll:<runId>"`, so re-posting is
 * skipped.
 */
export async function postRunToBookkeeping(companyId: string, runId: string, actorId: string): Promise<void> {
  const source = `payroll:${runId}`;
  if ((await prisma.transaction.count({ where: { companyId, source } })) > 0) return; // already posted

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
    },
  });
  if (!run || run.items.length === 0) return;

  // Resolved lazily: a run of nothing but commissions must not create an empty
  // "Contractor Labor" category in the chart of accounts, and vice versa.
  let commissionCategoryId: string | null = null;
  let contractorCategoryId: string | null = null;
  const date = run.paidAt ?? new Date();

  // One pay stub per recipient, stored once and reused across that rep's lines.
  const recipientIds = [...new Set(run.items.map((i) => i.userId))];
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

  for (const item of run.items) {
    const repName = `${item.user.firstName} ${item.user.lastName}`.trim();
    await ensureVendor(companyId, repName);
    const isContractor = !!item.contractorPayId;
    if (isContractor) {
      contractorCategoryId ??= await ensureCategory(companyId, CONTRACTOR_CATEGORY, false);
    } else {
      commissionCategoryId ??= await ensureCategory(companyId, COMMISSION_CATEGORY, true);
    }
    const txn = await prisma.transaction.create({
      data: {
        companyId,
        date,
        description: item.label,
        amountCents: -item.amount,
        vendor: repName,
        categoryId: isContractor ? contractorCategoryId : commissionCategoryId,
        projectId: item.commission?.projectId ?? item.contractorPay?.projectId ?? null,
        status: "categorized",
        approved: true,
        source,
        createdById: actorId,
      },
      select: { id: true },
    });
    const stub = stubByUser.get(item.userId);
    if (stub) {
      await prisma.fileAsset.create({
        data: {
          companyId,
          kind: "document",
          name: `Pay stub — ${run.label}.pdf`,
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
}
