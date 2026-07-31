import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "@/server/vertical/extension";
import { runUnscoped } from "@/server/vertical/context";
import { computeCommissionsForProject } from "@/server/modules/payroll/engine";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * Roofing and Solar are separate businesses with separate margins, so a manager
 * earning off a rep who sells both must earn at a DIFFERENT rate on each side.
 * The claim under test is that an override never leaks across that line:
 *
 *   • a roofing deal pays only the roofing override
 *   • a solar deal pays only the solar override, at its own amount
 *   • an override written for one side is invisible to the other, even when the
 *     same two people are involved
 *
 * This is enforced by a `where` clause in the payout engine rather than by the
 * isolation extension — CommissionOverride is deliberately a shared model, so
 * the Team page can show a person's whole sheet — which is exactly why it needs
 * a test against a real database rather than a type.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;
let repId: string;
let managerId: string;
let roofingProjectId: string;
let solarProjectId: string;

const CONTRACT = 1_000_000; // $10,000 in cents

async function resetFixtures() {
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Override Test Co", slug: `ov-${companyId ?? "seed"}-${process.pid}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  // Split percentages are left null on purpose: with no split terms the engine
  // writes no deal-split lines, so every commission it produces is an override
  // and the assertions cannot be confounded.
  const rep = await raw.user.create({
    data: {
      companyId, email: `rep-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Dual", lastName: "Rep", role: "sales_rep", verticals: ["roofing", "solar"],
    },
  });
  repId = rep.id;
  const manager = await raw.user.create({
    data: {
      companyId, email: `mgr-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Over", lastName: "Rider", role: "manager", verticals: ["roofing", "solar"],
    },
  });
  managerId = manager.id;

  // One deal per side, same rep, same contract value — so any difference in
  // payout can only have come from the vertical.
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
      contractValue: CONTRACT, supplementCents: 0, deductibleCents: 0,
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

function overrideLines(projectId: string) {
  return raw.commission.findMany({
    where: { projectId, overrideId: { not: null } },
    select: { userId: true, amount: true, label: true },
  });
}

beforeAll(resetFixtures);
beforeEach(resetFixtures);
afterAll(async () => {
  await raw.$disconnect();
});

describe("an override pays only on its own vertical's deals", () => {
  it("a roofing-only override skips the same rep's solar deal", async () => {
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "roofing", type: "percentage", percent: 3 },
    });

    await computeFor(roofingProjectId);
    await computeFor(solarProjectId);

    const roofing = await overrideLines(roofingProjectId);
    expect(roofing).toHaveLength(1);
    expect(roofing[0]).toMatchObject({ userId: managerId, amount: 30_000 }); // 3% of $10,000
    expect(roofing[0].label).toContain("Roofing override");

    expect(await overrideLines(solarProjectId)).toHaveLength(0);
  });

  it("the same pair earns a different amount on each side", async () => {
    await raw.commissionOverride.createMany({
      data: [
        { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "roofing", type: "percentage", percent: 3 },
        { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "flat", flatAmount: 40_000 },
      ],
    });

    await computeFor(roofingProjectId);
    await computeFor(solarProjectId);

    const roofing = await overrideLines(roofingProjectId);
    const solar = await overrideLines(solarProjectId);
    expect(roofing).toHaveLength(1);
    expect(solar).toHaveLength(1);
    expect(roofing[0].amount).toBe(30_000); // 3% of contract
    expect(solar[0].amount).toBe(40_000); // flat $400
    expect(solar[0].label).toContain("Solar override");
  });

  it("both sides can be held by the same pair without colliding on the unique key", async () => {
    // The pre-existing key was (company, beneficiary, source); writing the
    // second row here is what proves the vertical is part of it now.
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "roofing", type: "percentage", percent: 3 },
    });
    await expect(
      raw.commissionOverride.create({
        data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "percentage", percent: 5 },
      })
    ).resolves.toBeTruthy();

    // …and the same pair on the SAME side is still rejected.
    await expect(
      raw.commissionOverride.create({
        data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "roofing", type: "percentage", percent: 9 },
      })
    ).rejects.toThrow();
  });

  it("a solar override does not resurrect on a roofing deal after a recompute", async () => {
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "flat", flatAmount: 40_000 },
    });

    // Twice: the engine deletes and rebuilds override lines on every run, and a
    // filter applied only on create would leak on the rebuild.
    await computeFor(roofingProjectId);
    await computeFor(roofingProjectId);

    expect(await overrideLines(roofingProjectId)).toHaveLength(0);
  });
});
