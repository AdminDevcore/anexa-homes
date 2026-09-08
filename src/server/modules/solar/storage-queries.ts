import { prisma } from "@/server/db/client";
import type { BackupProfile } from "@/lib/solar-storage";

/**
 * Reading the two company lists a storage quote is built from — what a battery
 * is asked to carry, and whose money comes off the price — plus the per-deal
 * rebate rows those lists produce.
 *
 * Deliberately NOT in `storage.ts`: that file is `"use server"`, so every export
 * from it is an endpoint the browser can call with whatever `companyId` it
 * likes. Every function here takes a `companyId` argument, which is exactly the
 * shape that must not be reachable that way — `listDealRebates` would have read
 * another company's deal, and `syncDealRebateQuantities` would have written to
 * one. Callers pass the id they already resolved from the session.
 *
 * Same reasoning, and the same split, as `readiness.ts`, `adders.ts`,
 * `layout-asset.ts` and `esign/final-docs.ts`. The mutations that a browser
 * legitimately calls stay in `storage.ts`, where they resolve the company from
 * `requireUser()` and never take one as an argument.
 *
 * `SolarBackupProfile`, `SolarRebate` and `SolarDealRebate` carry a `vertical`
 * column but are NOT registered in `server/vertical/models.ts`, so the isolation
 * extension adds no filter of its own here. The `companyId` the caller passes is
 * the boundary these reads have, which is the other half of why it must come
 * from the session rather than off the wire.
 */

// ---------------------------------------------------------------------------
// Backup load profiles
// ---------------------------------------------------------------------------

export type BackupProfileRow = BackupProfile & { isActive: boolean };

/**
 * The company's load profiles.
 *
 * `activeOnly` for anything a customer will read — a retired profile must not
 * appear on a proposal. The settings screen passes false so it can show and
 * revive one.
 */
export async function listBackupProfiles(
  companyId: string,
  activeOnly = true
): Promise<BackupProfileRow[]> {
  const rows = await prisma.solarBackupProfile.findMany({
    where: { companyId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ rank: "asc" }, { loadWatts: "asc" }],
    select: { id: true, name: true, loadWatts: true, rank: true, isActive: true },
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Rebates
// ---------------------------------------------------------------------------

export type RebateRow = {
  id: string;
  name: string;
  amountCents: number;
  perBattery: boolean;
  rank: number;
  isActive: boolean;
};

export async function listRebates(companyId: string, activeOnly = true): Promise<RebateRow[]> {
  return prisma.solarRebate.findMany({
    where: { companyId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ rank: "asc" }, { name: "asc" }],
    select: { id: true, name: true, amountCents: true, perBattery: true, rank: true, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Rebates on ONE deal
// ---------------------------------------------------------------------------

export type DealRebateRow = {
  rebateId: string;
  name: string;
  qty: number;
  amountCents: number;
  /** amountCents x qty. The figure the price card subtracts. */
  totalCents: number;
};

export async function listDealRebates(companyId: string, leadId: string): Promise<DealRebateRow[]> {
  const rows = await prisma.solarDealRebate.findMany({
    where: { companyId, leadId },
    orderBy: { createdAt: "asc" },
    select: {
      rebateId: true,
      qty: true,
      amountCents: true,
      rebate: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    rebateId: r.rebateId,
    name: r.rebate.name,
    qty: r.qty,
    amountCents: r.amountCents,
    totalCents: r.amountCents * r.qty,
  }));
}

/** Σ(amount × qty). The single number both pricing functions take. */
export async function dealRebateTotalCents(companyId: string, leadId: string): Promise<number> {
  const rows = await listDealRebates(companyId, leadId);
  return rows.reduce((n, r) => n + r.totalCents, 0);
}

/**
 * Re-count the per-battery rebates on a deal after the battery quantity moves.
 *
 * Without this a rep who applies a $500-per-battery rebate on two batteries and
 * then adds a third keeps quoting $1,000 — a rebate silently one battery short,
 * on a price nobody re-reads. The AMOUNT stays frozen; only the count follows.
 *
 * NOTE (2026-09-05): nothing in the application calls this today, so the
 * behaviour the paragraph above describes does not currently happen. That is a
 * product gap, not a security one, and wiring it up would change what a deal is
 * priced at — so it is left exactly as found and raised for a decision. It moved
 * here with its neighbours because it takes a `companyId` and WRITES, which is
 * the worst shape to leave exported from a `"use server"` module.
 */
export async function syncDealRebateQuantities(companyId: string, leadId: string, batteryQty: number) {
  const rows = await prisma.solarDealRebate.findMany({
    where: { companyId, leadId },
    select: { id: true, qty: true, rebate: { select: { perBattery: true } } },
  });
  const qty = Math.max(1, batteryQty);
  await Promise.all(
    rows
      .filter((r) => r.rebate.perBattery && r.qty !== qty)
      .map((r) => prisma.solarDealRebate.update({ where: { id: r.id }, data: { qty } }))
  );
}
