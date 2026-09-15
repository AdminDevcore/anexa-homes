import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { recordChargebackRecovery, chargebackBalance } from "@/server/modules/payroll/chargebacks";
import { finalizePayrollRun } from "@/server/modules/payroll/adjustments";

/**
 * TWO RECOVERIES AT ONCE NEVER TAKE MORE THAN IS OWED.
 *
 * Recovery read the balance, then wrote the instalment. Two admins pressing
 * "Take" in the same second — or one pressing it in two tabs — both read the
 * full balance before either wrote, and both took it: a $1,000 debt recovered
 * as $2,000 off somebody's pay.
 *
 * These fire the recoveries TRULY concurrently, through the app's own pooled
 * client, and check the database afterwards rather than the return values: the
 * rows are what the pay stub sums. A race is a matter of timing, so each one is
 * run for several rounds from a fresh balance, and every round must hold.
 */

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let repId: string;
let adminId: string;

beforeAll(async () => {
  const tag = `${process.pid}-${Date.now()}`;
  const c = await db.company.create({ data: { name: "Recovery Race Co", slug: `race-${tag}` } });
  companyId = c.id;
  const rep = await db.user.create({
    data: {
      companyId, email: `rep-race-${tag}@test.local`, passwordHash: "x",
      firstName: "Race", lastName: "Rep", role: "sales_rep",
    },
  });
  repId = rep.id;
  const admin = await db.user.create({
    data: {
      companyId, email: `adm-race-${tag}@test.local`, passwordHash: "x",
      firstName: "Race", lastName: "Admin", role: "admin",
    },
  });
  adminId = admin.id;
});

afterAll(async () => {
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

type Round = { runId: string; chargebackId: string };

const openRun = async (label: string) =>
  (
    await db.payrollRun.create({
      data: { companyId, label, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-07") },
      select: { id: true },
    })
  ).id;

/** A fresh open run and a fresh, approved $1,000 chargeback — every race starts from the same place. */
async function freshRound(): Promise<Round> {
  const runId = await openRun("Race week");
  const cb = await db.chargeback.create({
    data: {
      companyId, userId: repId, amountCents: 1_000_00, reason: "fraud", status: "approved",
      requestedById: adminId, approvedById: adminId, approvedAt: new Date(),
    },
    select: { id: true },
  });
  return { runId, chargebackId: cb.id };
}

type Timed = { startedAt: number; finishedAt: number; ok: boolean; recoveredCents: number };

/** One recovery attempt, timed, never throwing — a refusal is an outcome here. */
async function attempt(round: Round, amountCents: number): Promise<Timed> {
  const startedAt = performance.now();
  try {
    const res = await recordChargebackRecovery({
      companyId, chargebackId: round.chargebackId, payrollRunId: round.runId, amountCents, createdById: adminId,
    });
    return { startedAt, finishedAt: performance.now(), ok: res.ok, recoveredCents: res.ok ? res.recoveredCents : 0 };
  } catch {
    return { startedAt, finishedAt: performance.now(), ok: false, recoveredCents: 0 };
  }
}

/** What the ledger actually holds — the numbers the pay stub will print. */
async function persisted(chargebackId: string) {
  const [recoveries, adjustments, cb] = await Promise.all([
    db.chargebackRecovery.findMany({ where: { chargebackId }, select: { amountCents: true } }),
    db.payrollAdjustment.findMany({ where: { companyId, chargebackId }, select: { amountCents: true } }),
    db.chargeback.findUniqueOrThrow({ where: { id: chargebackId }, select: { status: true } }),
  ]);
  return {
    recoveryRows: recoveries.length,
    recoveredCents: recoveries.reduce((n, r) => n + r.amountCents, 0),
    adjustmentRows: adjustments.length,
    deductedCents: adjustments.reduce((n, a) => n + a.amountCents, 0),
    status: cb.status,
  };
}

/** Every attempt was in flight before the first one finished — the race really happened. */
function overlapped(results: Timed[]): boolean {
  const firstFinish = Math.min(...results.map((r) => r.finishedAt));
  return results.every((r) => r.startedAt < firstFinish);
}

const SETTLED_ONCE = {
  recoveryRows: 1,
  recoveredCents: 1_000_00,
  adjustmentRows: 1,
  deductedCents: -1_000_00,
  status: "settled",
};

describe("concurrent chargeback recovery", () => {
  it("two simultaneous $1,000 recoveries against a $1,000 balance take $1,000 in total — every round", async () => {
    const rounds = [];
    for (let i = 0; i < 20; i++) {
      const round = await freshRound();
      const results = await Promise.all([attempt(round, 1_000_00), attempt(round, 1_000_00)]);
      rounds.push({
        overlapped: overlapped(results),
        winners: results.filter((r) => r.ok).length,
        ...(await persisted(round.chargebackId)),
        remainingCents: (await chargebackBalance(companyId, round.chargebackId))?.remainingCents,
      });
    }
    console.info("[race] two x $1,000 — recovered per round:", JSON.stringify(rounds.map((r) => r.recoveredCents)));

    for (const r of rounds) {
      expect(r).toEqual({ overlapped: true, winners: 1, ...SETTLED_ONCE, remainingCents: 0 });
    }
  });

  it("the same chargeback taken on TWO different open runs at once still recovers $1,000 once", async () => {
    const rounds = [];
    for (let i = 0; i < 10; i++) {
      const round = await freshRound();
      const otherRun: Round = { runId: await openRun("Race week, other run"), chargebackId: round.chargebackId };
      const results = await Promise.all([attempt(round, 1_000_00), attempt(otherRun, 1_000_00)]);
      rounds.push({ overlapped: overlapped(results), winners: results.filter((r) => r.ok).length, ...(await persisted(round.chargebackId)) });
    }
    console.info("[race] two runs x $1,000 — recovered per round:", JSON.stringify(rounds.map((r) => r.recoveredCents)));

    for (const r of rounds) expect(r).toEqual({ overlapped: true, winners: 1, ...SETTLED_ONCE });
  });

  it("ten simultaneous $400 attempts recover exactly the $1,000 owed — $400, $400, $200", async () => {
    const rounds = [];
    for (let i = 0; i < 5; i++) {
      const round = await freshRound();
      const results = await Promise.all(Array.from({ length: 10 }, () => attempt(round, 400_00)));
      rounds.push({
        overlapped: overlapped(results),
        taken: results.map((r) => r.recoveredCents).filter((c) => c > 0).sort((a, b) => b - a),
        ...(await persisted(round.chargebackId)),
      });
    }
    console.info("[race] ten x $400 — instalments per round:", JSON.stringify(rounds.map((r) => r.taken)));

    for (const r of rounds) {
      expect(r).toEqual({
        overlapped: true,
        taken: [400_00, 400_00, 200_00],
        recoveryRows: 3,
        recoveredCents: 1_000_00,
        adjustmentRows: 3,
        deductedCents: -1_000_00,
        status: "settled",
      });
    }
  });

  it("a recovery racing the run's finalisation lands whole before the lock, or not at all", async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 15; i++) {
      const round = await freshRound();
      const [recovery] = await Promise.all([
        attempt(round, 300_00),
        finalizePayrollRun({ companyId, payrollRunId: round.runId, actorId: adminId }),
      ]);
      const rows = await persisted(round.chargebackId);
      const run = await db.payrollRun.findUniqueOrThrow({ where: { id: round.runId }, select: { finalizedAt: true } });
      outcomes.push(
        `${recovery.ok ? "landed" : "refused"}:${rows.recoveryRows}recovery/${rows.adjustmentRows}payline`
      );

      expect(run.finalizedAt).not.toBeNull();
      // The balance draw-down and the pay-stub line are ONE act. A recovery row
      // with no deduction beside it says money was recovered that nobody's pay
      // ever gave up.
      expect(rows.adjustmentRows).toBe(rows.recoveryRows);
      expect(rows.recoveryRows).toBe(recovery.ok ? 1 : 0);
      expect(rows.recoveredCents).toBe(recovery.ok ? 300_00 : 0);
    }
    console.info("[race] recovery vs finalise:", JSON.stringify(outcomes));
  });
});
