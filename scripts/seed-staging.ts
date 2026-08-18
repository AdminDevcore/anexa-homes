/**
 * Staging-only seed for the Anexa Homes solar proposal test environment.
 *
 * Creates ONE obviously-fake company, one super-admin login, one solar deal and
 * a minimal ZZ TEST catalogue — enough to build exactly one proposal end to end.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS SCRIPT REFUSES TO RUN ANYWHERE IT SHOULD NOT.
 *
 * A seed is the most dangerous kind of script to point at the wrong database:
 * it writes, it writes a lot, and by the time you notice you have already
 * created rows in production. So it will not run unless the caller states which
 * Supabase project they believe they are targeting, and the connection string
 * agrees. Four independent guards, any one of which aborts:
 *
 *   1. EXPECT_SUPABASE_REF must be set, and DATABASE_URL must contain it.
 *   2. A blocklist of refs that are known NOT to be Anexa staging — the two
 *      DWOS databases, which belong to an entirely separate system.
 *   3. The database must not already hold a company whose name does not begin
 *      with "ZZ TEST" — i.e. it must be empty or previously seeded by this
 *      script. A real customer row is an immediate abort.
 *   4. NODE_ENV must not be "production".
 *
 * Run:
 *   EXPECT_SUPABASE_REF=<staging-ref> DATABASE_URL=<staging-url> \
 *     npx tsx scripts/seed-staging.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const DB_URL = process.env.DATABASE_URL ?? "";
const EXPECT_REF = process.env.EXPECT_SUPABASE_REF ?? "";

/** Databases that are definitively NOT Anexa Homes staging. */
const BLOCKLIST: Record<string, string> = {
  akmmyzsvvchwffbvaoam: "ANEXA HOMES PRODUCTION",
  vcpniozembxsieeqnupm: "dwos-staging (separate digital-workforce system)",
  iggkwvlmzngdvfrzpspa: "dwos-prod (separate digital-workforce system)",
  gddosbpmsfxyprenrvps: "Amos Capital Fund (separate business)",
  qfvjuabvzfcctpxfccnm: "Amos-DB-Rehearsal (separate business)",
};

const TEST_PREFIX = "ZZ TEST";

function abort(why: string): never {
  console.error("\nREFUSING TO SEED\n  " + why + "\n");
  process.exit(1);
}

async function main() {
  // ── Guard 1: the caller must name the target, and it must match ──────────
  if (!DB_URL) abort("DATABASE_URL is not set.");
  if (!EXPECT_REF) {
    abort(
      "EXPECT_SUPABASE_REF is not set. State which Supabase project you intend to\n" +
        "  seed; this script will only proceed if DATABASE_URL points at it."
    );
  }
  if (!DB_URL.includes(EXPECT_REF)) {
    abort(
      `DATABASE_URL does not contain the expected project ref "${EXPECT_REF}".\n` +
        "  The connection string points somewhere other than the project you named."
    );
  }

  // ── Guard 2: known-foreign databases ────────────────────────────────────
  for (const [ref, what] of Object.entries(BLOCKLIST)) {
    if (DB_URL.includes(ref)) abort(`DATABASE_URL points at ${what}. That system is off limits.`);
  }

  // ── Guard 4 (cheap, do it before connecting) ────────────────────────────
  if (process.env.NODE_ENV === "production") {
    abort('NODE_ENV is "production". This seed is for staging only.');
  }

  const prisma = new PrismaClient();

  // ── Guard 3: the database must be empty, or only ever seeded by us ──────
  const foreign = await prisma.company.findFirst({
    where: { NOT: { name: { startsWith: TEST_PREFIX } } },
    select: { name: true },
  });
  if (foreign) {
    abort(
      `This database already contains a company that is not test data: "${foreign.name}".\n` +
        "  That looks like a real environment. Nothing was written."
    );
  }

  console.log(`Seeding staging project ${EXPECT_REF} …`);

  // ── Company: obviously fictional identity, complete enough to pass the ──
  // readiness validator's company-identity checks.
  const company = await prisma.company.upsert({
    where: { slug: "zz-test-anexa-staging" },
    create: {
      name: `${TEST_PREFIX} ANEXA STAGING - NOT A REAL COMPANY`,
      slug: "zz-test-anexa-staging",
      phone: "(555) 010-0000",
      email: "zz-test-staging@example.invalid",
      address: "1 ZZ TEST Way",
      city: "Testville",
      state: "TX",
      zip: "75080",
      timezone: "America/Chicago",
    },
    update: {},
  });

  await prisma.companySettings.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, recordPrefix: "ZZT-", supportPhone: "(555) 010-0000", supportEmail: "zz-test-staging@example.invalid" },
    update: {},
  });

  // ── Solar assumptions. Deliberately leaves federalItcPct NULL: the real ──
  // percentage is a configuration decision nobody has made yet, and inventing
  // one in staging would let a wrong number look validated.
  await prisma.solarSettings.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id },
    update: {},
  });

  // ── Super-admin test user ───────────────────────────────────────────────
  const password = process.env.STAGING_SEED_PASSWORD;
  if (!password) {
    abort(
      "STAGING_SEED_PASSWORD is not set. Pass the staging login password in the\n" +
        "  environment rather than hardcoding one in the repository."
    );
  }
  const owner = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: "zz-test-owner@example.invalid" } },
    create: {
      companyId: company.id,
      email: "zz-test-owner@example.invalid",
      passwordHash: await bcrypt.hash(password, 10),
      firstName: "ZZ TEST",
      lastName: "OWNER",
      role: "super_admin",
      verticals: ["roofing", "solar"],
    },
    update: {},
  });

  // ── Solar pipeline + one stage, so a deal can exist ─────────────────────
  const pipeline = await prisma.pipeline.upsert({
    where: { id: "zz-test-solar-pipeline" },
    create: { id: "zz-test-solar-pipeline", companyId: company.id, name: "ZZ TEST Solar", vertical: "solar" },
    update: {},
  });
  const stage = await prisma.pipelineStage.upsert({
    where: { id: "zz-test-solar-stage" },
    create: { id: "zz-test-solar-stage", pipelineId: pipeline.id, key: "new_lead", name: "ZZ TEST New Lead", position: 1 },
    update: {},
  });

  // ── Catalogue. Fictional manufacturers and models on purpose: a staging ──
  // catalogue full of real product names invites somebody to trust its prices.
  const equipment = [
    { id: "zz-test-module", kind: "module" as const, manufacturer: `${TEST_PREFIX} SOLARCO`, model: "ZZ TEST MODULE - NOT REAL", ratingW: 400, priceCents: 0, costCents: 0, isDefault: true },
    { id: "zz-test-inverter", kind: "inverter" as const, manufacturer: `${TEST_PREFIX} INVERTCO`, model: "ZZ TEST INVERTER - NOT REAL", ratingW: 7600, priceCents: 0, costCents: 0, isDefault: true },
    { id: "zz-test-battery", kind: "battery" as const, manufacturer: `${TEST_PREFIX} BATTCO`, model: "ZZ TEST BATTERY - NOT REAL", ratingW: 10000, priceCents: 900_000, costCents: 0, isDefault: true },
    { id: "zz-test-adder", kind: "adder" as const, manufacturer: null, model: "ZZ TEST ADDER - NOT REAL", ratingW: null, priceCents: 250_000, costCents: 0, isDefault: false },
  ];
  for (const e of equipment) {
    await prisma.solarEquipment.upsert({
      where: { id: e.id },
      create: { ...e, companyId: company.id },
      update: {},
    });
  }

  // ── One solar deal, carrying the authorised fictional test values ───────
  const lead = await prisma.lead.upsert({
    where: { id: "zz-test-solar-deal" },
    create: {
      id: "zz-test-solar-deal",
      companyId: company.id,
      vertical: "solar",
      pipelineId: pipeline.id,
      stageId: stage.id,
      assignedRepId: owner.id,
      firstName: "ZZ TEST",
      lastName: "CUSTOMER - NOT REAL",
      email: "zz-test-customer@example.invalid",
      phone: "(555) 010-0001",
      address: "1200 ZZ TEST Array Drive",
      city: "Testville",
      state: "TX",
      zip: "75080",
      status: "open",
    },
    update: {},
  });

  const y1 = Math.round(8 * 1450 * 0.84 * 0.85);
  await prisma.solarDesign.upsert({
    where: { leadId: lead.id },
    create: {
      companyId: company.id,
      leadId: lead.id,
      utilityProvider: `${TEST_PREFIX} UTILITY - DO NOT USE`,
      ratePlan: `${TEST_PREFIX} TARIFF`,
      netMeteringProgram: `${TEST_PREFIX} BUYBACK`,
      annualUsageKwh: 14_000,
      avgMonthlyBillCents: 18_000,
      mountType: "roof",
      tsrfPct: 85,
      moduleId: "zz-test-module",
      moduleQty: 20,
      inverterId: "zz-test-inverter",
      systemSizeKwDc: 8,
      year1ProductionKwh: y1,
      offsetPct: (y1 / 14_000) * 100,
    },
    update: {},
  });

  await prisma.solarFinance.upsert({
    where: { leadId: lead.id },
    create: {
      companyId: company.id,
      leadId: lead.id,
      product: "cash",
      grossPpwCents: 350,
      contractPriceCents: 8 * 1000 * 350,
    },
    update: {},
  });

  console.log("\nStaging seed complete.");
  console.log("  company : " + company.name);
  console.log("  login   : zz-test-owner@example.invalid  (password from STAGING_SEED_PASSWORD)");
  console.log("  deal    : /portal/leads/" + lead.id);
  console.log("  system  : 8.00 kW-DC, " + y1 + " kWh yr-1");
  console.log("\nNo panel layout is seeded — upload one in the UI so the attachment path is exercised.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
