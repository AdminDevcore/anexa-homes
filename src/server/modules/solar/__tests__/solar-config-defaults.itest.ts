import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { validateDesign, type DesignForValidation } from "@/lib/solar-validation";

/**
 * The defaults a deal and a workspace START with, against a real database:
 *
 *  - the two bonus credits are OFF on a new deal (the column default);
 *  - the minimum offset distinguishes configured, deliberately zero and never
 *    set up — and a workspace that never set one up still quotes;
 *  - the two backfills these migrations run pick exactly the rows they should.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateSolarSettingsAction } = await import("@/server/modules/solar/actions");
const { getSolarSettings, SOLAR_ASSUMPTION_DEFAULTS } = await import("@/server/modules/solar/settings");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "prisma", "migrations");

let companyId: string;
let adminId: string;

const undersized: DesignForValidation = {
  systemSizeKwDc: 4, year1ProductionKwh: 5_600, annualUsageKwh: 14_000, offsetPct: 40,
  moduleQty: 10, moduleRatingW: 400, avgMonthlyBillCents: 18_000, utilityProvider: "Oncor",
};

/** Every settings field the form sends, with the offset band under test. */
const settingsInput = (min: number, minOffsetNone?: boolean) => ({
  ...SOLAR_ASSUMPTION_DEFAULTS,
  minOffsetPct: min,
  maxOffsetPct: 150,
  ...(minOffsetNone === undefined ? {} : { minOffsetNone }),
});

const offsetFindings = async () =>
  validateDesign(undersized, await getSolarSettings(companyId))
    .filter((i) => i.code === "design.offset_below_min" || i.code === "config.min_offset_unset")
    .map((i) => `${i.severity}:${i.code}`);

/** The data statement from a migration, fenced to this suite's own company. */
function backfillSql(migration: string, fence: { from: string; to: string }): string {
  const sql = readFileSync(join(MIGRATIONS, migration, "migration.sql"), "utf8");
  const update = sql.slice(sql.indexOf("UPDATE"));
  expect(update).toContain(fence.from);
  return update.replace(fence.from, fence.to);
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Config Defaults Co", slug: `cfg-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  adminId = (
    await db.user.create({
      data: { companyId, email: `admin-cfg-${process.pid}@test.local`, firstName: "A", lastName: "D", role: "admin", passwordHash: "x" },
    })
  ).id;
  session.requireUser.mockResolvedValue({ userId: adminId, companyId, role: "admin", permissions: {}, fullName: "Admin" });
});

beforeEach(async () => {
  await db.solarSettings.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("federal credit claims on a new deal", () => {
  it("claims the ITC and NEITHER bonus unless somebody ticks one", async () => {
    const lead = await db.lead.create({ data: { companyId, vertical: "solar", firstName: "New", lastName: "Deal" } });
    const finance = await db.solarFinance.create({ data: { companyId, leadId: lead.id, vertical: "solar" } });
    expect(finance.claimItc).toBe(true);
    expect(finance.claimEnergyCommunity).toBe(false);
    expect(finance.claimDomesticContent).toBe(false);
  });

  it("a deal that was quoted with the bonuses keeps them — nothing is rewritten", async () => {
    const lead = await db.lead.create({ data: { companyId, vertical: "solar", firstName: "Old", lastName: "Deal" } });
    const finance = await db.solarFinance.create({
      data: { companyId, leadId: lead.id, vertical: "solar", claimEnergyCommunity: true, claimDomesticContent: true },
    });
    const reread = await db.solarFinance.findUniqueOrThrow({ where: { id: finance.id } });
    expect([reread.claimEnergyCommunity, reread.claimDomesticContent]).toEqual([true, true]);
  });
});

describe("minimum offset: configured, deliberately zero, or never set up", () => {
  it("a workspace with NO settings row is 'never set up': it warns and still quotes", async () => {
    const s = await getSolarSettings(companyId);
    expect([s.minOffsetPct, s.minOffsetConfigured]).toEqual([0, false]);
    expect(await offsetFindings()).toEqual(["warn:config.min_offset_unset"]);
  });

  it("a legacy row saved at 0 before the flag existed is 'never set up' too", async () => {
    await db.solarSettings.create({ data: { companyId, minOffsetPct: 0 } });
    expect(await offsetFindings()).toEqual(["warn:config.min_offset_unset"]);
  });

  it("an admin setting a minimum makes it enforced: generation blocks below it", async () => {
    expect((await updateSolarSettingsAction(settingsInput(80))).ok).toBe(true);
    expect((await getSolarSettings(companyId)).minOffsetConfigured).toBe(true);
    expect(await offsetFindings()).toEqual(["block:design.offset_below_min"]);
  });

  it("an admin confirming 'no minimum' clears the warning without enforcing anything", async () => {
    expect((await updateSolarSettingsAction(settingsInput(0, true))).ok).toBe(true);
    expect(await offsetFindings()).toEqual([]);
  });

  it("saving the form for another reason does not flip that decision either way", async () => {
    await updateSolarSettingsAction(settingsInput(0, true));
    // A client that predates the toggle sends no answer at all.
    await updateSolarSettingsAction(settingsInput(0));
    expect((await getSolarSettings(companyId)).minOffsetConfigured).toBe(true);

    await db.solarSettings.update({ where: { companyId }, data: { minOffsetConfigured: false } });
    await updateSolarSettingsAction(settingsInput(0));
    expect((await getSolarSettings(companyId)).minOffsetConfigured).toBe(false);
  });

  it("un-ticking 'no minimum' returns the workspace to 'never set up'", async () => {
    await updateSolarSettingsAction(settingsInput(0, true));
    await updateSolarSettingsAction(settingsInput(0, false));
    expect(await offsetFindings()).toEqual(["warn:config.min_offset_unset"]);
  });
});

describe("the migrations' backfills", () => {
  it("marks a saved minimum above zero as configured, and leaves a zero undecided", async () => {
    const other = await db.company.create({ data: { name: "Cfg Two", slug: `cfg-two-${process.pid}-${Date.now()}` } });
    try {
      await db.solarSettings.create({ data: { companyId, minOffsetPct: 80, minOffsetConfigured: false } });
      await db.solarSettings.create({ data: { companyId: other.id, minOffsetPct: 0, minOffsetConfigured: false } });
      await db.$executeRawUnsafe(
        backfillSql("20260915090000_solar_min_offset_configured", {
          from: `WHERE "minOffsetPct" > 0`,
          to: `WHERE "minOffsetPct" > 0 AND "companyId" IN ('${companyId}', '${other.id}')`,
        })
      );
      expect((await db.solarSettings.findUniqueOrThrow({ where: { companyId } })).minOffsetConfigured).toBe(true);
      expect((await db.solarSettings.findUniqueOrThrow({ where: { companyId: other.id } })).minOffsetConfigured).toBe(false);
    } finally {
      await db.company.delete({ where: { id: other.id } });
    }
  });

  it("marks one Contract Signed stage per SOLAR pipeline — by seeded key or by name — and never roofing", async () => {
    const pipe = (name: string, vertical: "solar" | "roofing") =>
      db.pipeline.create({ data: { companyId, name, vertical } });
    const stage = (pipelineId: string, key: string, name: string, position: number, isLost = false) =>
      db.pipelineStage.create({ data: { pipelineId, key, name, position, isLost } });

    const seeded = await pipe("Seeded solar", "solar");
    const seededSale = await stage(seeded.id, "contract_signed", "Contract Signed", 5);
    await stage(seeded.id, "contract_signed_copy_7", "Contract Signed (copy)", 7);

    const live = await pipe("Live solar", "solar");
    await stage(live.id, "new_appointment_0", "New Appointment", 0);
    const liveSale = await stage(live.id, "contract_signed_hold_1", "Contract Signed / Hold", 1);

    const roofing = await pipe("Roofing", "roofing");
    const roofSale = await stage(roofing.id, "contract_signed", "Contract Signed", 3);

    const lostOnly = await pipe("Lost only", "solar");
    const lostStage = await stage(lostOnly.id, "cancelled_9", "Cancelled — contract signed elsewhere", 9, true);

    const none = await pipe("No sale stage", "solar");
    const noneStage = await stage(none.id, "permitting", "Permitting", 3);

    await db.$executeRawUnsafe(
      backfillSql("20260915091000_pipeline_stage_milestone", {
        from: `WHERE p."industry" = 'solar'`,
        to: `WHERE p."industry" = 'solar' AND p."companyId" = '${companyId}'`,
      })
    );

    const milestoneOf = async (id: string) =>
      (await db.pipelineStage.findUniqueOrThrow({ where: { id }, select: { milestone: true } })).milestone;
    expect(await milestoneOf(seededSale.id)).toBe("contract_signed");
    expect(await db.pipelineStage.count({ where: { pipelineId: seeded.id, milestone: "contract_signed" } })).toBe(1);
    expect(await milestoneOf(liveSale.id)).toBe("contract_signed");
    expect(await milestoneOf(roofSale.id)).toBeNull();
    expect(await milestoneOf(lostStage.id)).toBeNull();
    expect(await milestoneOf(noneStage.id)).toBeNull();
  });
});
