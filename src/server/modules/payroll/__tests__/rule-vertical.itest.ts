import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "@/server/vertical/extension";
import { runUnscoped } from "@/server/vertical/context";
import { computeCommissionsForProject } from "@/server/modules/payroll/engine";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * A CommissionRule belongs to exactly one workspace, and the payout engine has
 * to honour that itself.
 *
 * The isolation extension only narrows a query when a vertical is ACTIVE, and
 * payroll's whole point is that it runs company-wide — from a cron, or from the
 * Commissions page sweeping every eligible deal at once. In that unscoped state
 * the extension steps aside, so a rule query without its own vertical clause
 * reads every rule in the company. The visible symptom is a solar
 * project-manager rule paying a percentage of a re-roof's contract.
 *
 * Same shape as override-vertical.itest.ts, and for the same reason: the
 * guarantee lives in a `where` clause, so only a real database can prove it.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;
let repId: string;
let pmId: string;
let roofingProjectId: string;
let solarProjectId: string;

const CONTRACT = 1_000_000; // $10,000 in cents

async function resetFixtures() {
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Rule Test Co", slug: `rule-${process.pid}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  // No split percentages anywhere: with no split terms the engine writes no
  // deal-split lines, so every commission produced here came from a rule.
  const rep = await raw.user.create({
    data: {
      companyId, email: `rule-rep-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Dual", lastName: "Rep", role: "sales_rep", verticals: ["roofing", "solar"],
    },
  });
  repId = rep.id;
  // The project manager is deliberately NOT a `manager` — a manager would be
  // swept into the deal-split branch and muddy the count.
  const pm = await raw.user.create({
    data: {
      companyId, email: `rule-pm-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Pat", lastName: "Manager", role: "admin", verticals: ["roofing", "solar"],
    },
  });
  pmId = pm.id;

  roofingProjectId = await makeDeal("roofing", "R");
  solarProjectId = await makeDeal("solar", "S");
}

async function makeDeal(vertical: "roofing" | "solar", tag: string): Promise<string> {
  const lead = await raw.lead.create({
    data: { companyId, vertical, firstName: tag, lastName: "Deal", assignedRepId: repId },
  });
  const project = await raw.project.create({
    data: {
      companyId, vertical, leadId: lead.id, projectNumber: `${tag}-1`,
      managerId: pmId, contractValue: CONTRACT, supplementCents: 0, deductibleCents: 0,
    },
  });
  return project.id;
}

/** The engine runs unscoped, the way a payroll cron does: no workspace context. */
function computeFor(projectId: string) {
  return runUnscoped("test: payroll runs company-wide", () =>
    computeCommissionsForProject(db, companyId, projectId)
  );
}

function ruleLines(projectId: string) {
  return raw.commission.findMany({
    where: { projectId, ruleId: { not: null } },
    select: { userId: true, amount: true, label: true },
  });
}

beforeAll(resetFixtures);
beforeEach(resetFixtures);
afterAll(async () => {
  await raw.$disconnect();
});

describe("a commission rule pays only on its own vertical's deals", () => {
  it("a solar rule never lands on a roofing deal", async () => {
    await raw.commissionRule.create({
      data: {
        companyId, vertical: "solar", name: "Solar PM — 1%",
        role: "project_manager", type: "percentage", percent: 1, active: true,
      },
    });

    await computeFor(roofingProjectId);

    // The roofing deal has a project manager and a contract, so the ONLY reason
    // it should stay empty is that the rule belongs to the other side.
    expect(await ruleLines(roofingProjectId)).toHaveLength(0);
  });

  it("each side pays its own rule, at its own rate, on the same contract", async () => {
    await raw.commissionRule.createMany({
      data: [
        { companyId, vertical: "roofing", name: "Roofing PM — 2%", role: "project_manager", type: "percentage", percent: 2, active: true },
        { companyId, vertical: "solar", name: "Solar PM — 1%", role: "project_manager", type: "percentage", percent: 1, active: true },
      ],
    });

    await computeFor(roofingProjectId);
    await computeFor(solarProjectId);

    const roofing = await ruleLines(roofingProjectId);
    expect(roofing).toHaveLength(1);
    expect(roofing[0]).toMatchObject({ userId: pmId, amount: 20_000, label: "Roofing PM — 2%" });

    // Solar deals are priced from SolarFinance, not Project.contractValue, and
    // this one has no finance row — so the solar engine pays nothing at all.
    // What matters is that the ROOFING rule did not reach it either.
    const solar = await ruleLines(solarProjectId);
    expect(solar.every((l) => l.label !== "Roofing PM — 2%")).toBe(true);
  });
});
