import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { getPayStubData, buildPayStubPdf } from "./paystub";

const COMMISSION_CATEGORY = "Sales Commissions";

/** A dedicated, job-cost-excluded expense category for rep commission payouts
 *  (so a paid commission never double-counts against the deal's job cost). */
async function ensureCommissionCategory(companyId: string): Promise<string> {
  const existing = await prisma.bookkeepingCategory.findFirst({
    where: { companyId, name: COMMISSION_CATEGORY },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.bookkeepingCategory.create({
    data: { companyId, name: COMMISSION_CATEGORY, type: "expense", excludeFromJobCost: true },
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
 * Post a PAID payroll run to Bookkeeping: one money-out transaction per
 * commission line — deal-tagged, rep as vendor, in the job-cost-excluded
 * "Sales Commissions" category — with the rep's pay stub PDF attached as the
 * receipt/invoice. Idempotent: a run's transactions are stamped
 * `source = "payroll:<runId>"`, so re-posting is skipped.
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
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!run || run.items.length === 0) return;

  const categoryId = await ensureCommissionCategory(companyId);
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
    const txn = await prisma.transaction.create({
      data: {
        companyId,
        date,
        description: item.label,
        amountCents: -item.amount,
        vendor: repName,
        categoryId,
        projectId: item.commission?.projectId ?? null,
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
          transactionId: txn.id,
          uploadedById: actorId,
        },
      });
    }
  }
}
