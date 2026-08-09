"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { year1Production, offsetPct, pricePurchase, itcEstimateCents } from "@/lib/solar-money";
import { validateSolarDeal, canGenerate } from "@/lib/solar-validation";

const fail = (error: string) => ({ ok: false as const, error });
const ok = () => ({ ok: true as const });

// ---------------------------------------------------------------------------
// Solar Settings — the assumptions every quote is built from
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  derateFactor: z.number().min(0.5).max(1),
  annualDegradationPct: z.number().min(0).max(3),
  utilityEscalationPct: z.number().min(0).max(15),
  kwhPerKwYear: z.number().int().min(500).max(2500),
  defaultGrossPpwCents: z.number().int().min(50).max(2000),
  defaultDealerFeePct: z.number().min(0).max(50),
  // Nullable ON PURPOSE: unset means "show no federal credit", which is the
  // right default while the 2025 rule changes settle. Never defaulted to 30.
  federalItcPct: z.number().min(0).max(100).nullable(),
  stateIncentiveNote: z.string().max(1000).nullable(),
  incentiveDisclaimer: z.string().min(1).max(1000),
  minOffsetPct: z.number().min(0).max(200),
  maxOffsetPct: z.number().min(0).max(500),
  minPpwCents: z.number().int().min(0).max(2000),
  maxPpwCents: z.number().int().min(0).max(5000),
});

export async function updateSolarSettingsAction(input: z.infer<typeof settingsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const d = parsed.data;
  if (d.minOffsetPct >= d.maxOffsetPct) return fail("Minimum offset must be below the maximum.");
  if (d.minPpwCents >= d.maxPpwCents) return fail("Minimum PPW must be below the maximum.");

  await prisma.solarSettings.upsert({
    where: { companyId: user.companyId },
    create: { companyId: user.companyId, ...d },
    update: d,
  });
  revalidatePath("/portal/settings/solar");
  return ok();
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

const designSchema = z.object({
  leadId: z.string().min(1),
  utilityProvider: z.string().max(120).nullable().optional(),
  ratePlan: z.string().max(120).nullable().optional(),
  utilityAccountNo: z.string().max(60).nullable().optional(),
  meterNo: z.string().max(60).nullable().optional(),
  netMeteringProgram: z.string().max(120).nullable().optional(),
  monthlyUsageKwh: z.array(z.number().min(0)).max(12).optional(),
  annualUsageKwh: z.number().int().min(0).nullable().optional(),
  avgMonthlyBillCents: z.number().int().min(0).nullable().optional(),
  mountType: z.enum(["roof", "ground"]).optional(),
  roofPlanes: z.array(z.record(z.string(), z.unknown())).optional(),
  tsrfPct: z.number().min(0).max(100).nullable().optional(),
  setbackNotes: z.string().max(2000).nullable().optional(),
  structuralNotes: z.string().max(2000).nullable().optional(),
  electricalNotes: z.string().max(2000).nullable().optional(),
  moduleId: z.string().nullable().optional(),
  moduleQty: z.number().int().min(0).max(500).optional(),
  inverterId: z.string().nullable().optional(),
  batteryId: z.string().nullable().optional(),
  batteryQty: z.number().int().min(0).max(20).optional(),
});

/**
 * Save the design and recompute the derived numbers SERVER-SIDE.
 *
 * System size, production and offset are never taken from the client: they are
 * recomputed from the module count and the company's assumptions every time.
 * A proposal claiming a five-figure offset is a client that was trusted.
 */
export async function saveSolarDesignAction(input: z.infer<typeof designSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = designSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid design.");
  const d = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: d.leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  const assumptions = await getSolarSettings(user.companyId);

  const module_ = d.moduleId
    ? await prisma.solarEquipment.findFirst({
        where: { companyId: user.companyId, id: d.moduleId, kind: "module" },
        select: { ratingW: true },
      })
    : null;

  const moduleQty = d.moduleQty ?? 0;
  const systemSizeKwDc = module_?.ratingW ? (moduleQty * module_.ratingW) / 1000 : 0;
  const year1ProductionKwh = year1Production(systemSizeKwDc, assumptions);

  // Annual usage: explicit value wins, else sum the 12 monthly readings.
  const monthly = d.monthlyUsageKwh ?? [];
  const annualUsageKwh =
    d.annualUsageKwh ?? (monthly.length ? Math.round(monthly.reduce((n, m) => n + m, 0)) : null);

  const computedOffset = annualUsageKwh ? offsetPct(year1ProductionKwh, annualUsageKwh) : 0;

  const { leadId, moduleQty: _q, ...rest } = d;
  const data = {
    ...rest,
    moduleQty,
    monthlyUsageKwh: monthly,
    annualUsageKwh,
    systemSizeKwDc,
    year1ProductionKwh,
    offsetPct: computedOffset,
  };

  await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const, systemSizeKwDc, year1ProductionKwh, offsetPct: computedOffset };
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

const financeSchema = z.object({
  leadId: z.string().min(1),
  product: z.enum(["cash", "loan", "lease", "ppa"]),
  grossPpwCents: z.number().int().min(0).optional(),
  dealerFeePct: z.number().min(0).max(100).optional(),
  adderTotalCents: z.number().int().min(0).optional(),
  rateMillsPerKwh: z.number().int().min(0).nullable().optional(),
  monthlyPaymentCents: z.number().int().min(0).nullable().optional(),
  escalatorPct: z.number().min(0).max(10).nullable().optional(),
  termYears: z.number().int().min(0).max(40).nullable().optional(),
  aprPct: z.number().min(0).max(50).nullable().optional(),
  loanTermMonths: z.number().int().min(0).max(600).nullable().optional(),
  downPaymentCents: z.number().int().min(0).nullable().optional(),
  loanMonthlyPaymentCents: z.number().int().min(0).nullable().optional(),
});

/**
 * Save the money side, applying the product's OWN model.
 *
 * Cash/loan compute a contract price and an ITC estimate from PPW. Lease/PPA
 * do neither — they have no system price — so those columns are explicitly
 * zeroed rather than left holding a stale purchase figure that would then show
 * up on a PPA proposal.
 */
export async function saveSolarFinanceAction(input: z.infer<typeof financeSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = financeSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid financing.");
  const f = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: f.leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  const assumptions = await getSolarSettings(user.companyId);
  const design = await prisma.solarDesign.findUnique({
    where: { leadId: f.leadId },
    select: { systemSizeKwDc: true },
  });

  const isPurchase = f.product === "cash" || f.product === "loan";
  const isLoan = f.product === "loan";
  // Cash has no lender, so it can never carry a dealer fee.
  const dealerFeePct = f.product === "loan" ? (f.dealerFeePct ?? assumptions.defaultDealerFeePct) : 0;

  let contractPriceCents = 0;
  let itcCents = 0;
  if (f.product === "cash" || f.product === "loan") {
    const breakdown = pricePurchase({
      product: f.product,
      systemSizeKwDc: design?.systemSizeKwDc ?? 0,
      grossPpwCents: f.grossPpwCents ?? assumptions.defaultGrossPpwCents,
      dealerFeePct,
      adderTotalCents: f.adderTotalCents ?? 0,
    });
    contractPriceCents = breakdown.contractPriceCents;
    itcCents = itcEstimateCents(contractPriceCents, assumptions);
  }

  const data = {
    product: f.product,
    // Purchase block — zeroed for lease/PPA so nothing stale leaks onto a
    // third-party-owned proposal.
    grossPpwCents: isPurchase ? (f.grossPpwCents ?? assumptions.defaultGrossPpwCents) : 0,
    dealerFeePct,
    adderTotalCents: isPurchase ? (f.adderTotalCents ?? 0) : 0,
    contractPriceCents,
    itcEstimateCents: itcCents,
    // Rate block — nulled for cash/loan for the same reason.
    rateMillsPerKwh: isPurchase ? null : (f.rateMillsPerKwh ?? null),
    monthlyPaymentCents: isPurchase ? null : (f.monthlyPaymentCents ?? null),
    escalatorPct: isPurchase ? null : (f.escalatorPct ?? null),
    termYears: f.termYears ?? null,
    aprPct: f.aprPct ?? null,
    loanTermMonths: f.loanTermMonths ?? null,
    // Loan block — nulled for every other product, the same way the rate block
    // is nulled for purchases. A down payment on a cash deal is a contradiction
    // (cash IS paid in full), and a loan payment left behind after switching to
    // a lease would show the wrong monthly on the proposal.
    downPaymentCents: isLoan ? (f.downPaymentCents ?? null) : null,
    loanMonthlyPaymentCents: isLoan ? (f.loanMonthlyPaymentCents ?? null) : null,
  };

  await prisma.solarFinance.upsert({
    where: { leadId: f.leadId },
    create: { companyId: user.companyId, leadId: f.leadId, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${f.leadId}`);
  return ok();
}

/**
 * Everything wrong with this deal right now.
 *
 * The proposal builder calls this before it will generate anything; a `block`
 * issue stops generation outright.
 */
export async function validateSolarDealAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) return fail("Not allowed.");

  const [design, finance, assumptions] = await Promise.all([
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        systemSizeKwDc: true, year1ProductionKwh: true, annualUsageKwh: true,
        offsetPct: true, moduleQty: true, module: { select: { ratingW: true } },
      },
    }),
    prisma.solarFinance.findUnique({ where: { leadId } }),
    getSolarSettings(user.companyId),
  ]);

  if (!design || !finance) {
    return {
      ok: true as const,
      issues: [
        {
          severity: "block" as const,
          field: "design",
          message: "Complete the system design and financing before generating a proposal.",
        },
      ],
      canGenerate: false,
    };
  }

  const issues = validateSolarDeal(
    {
      systemSizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      annualUsageKwh: design.annualUsageKwh,
      offsetPct: design.offsetPct,
      moduleQty: design.moduleQty,
      moduleRatingW: design.module?.ratingW ?? null,
    },
    {
      product: finance.product,
      grossPpwCents: finance.grossPpwCents,
      dealerFeePct: finance.dealerFeePct,
      contractPriceCents: finance.contractPriceCents,
      rateMillsPerKwh: finance.rateMillsPerKwh,
      monthlyPaymentCents: finance.monthlyPaymentCents,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
      downPaymentCents: finance.downPaymentCents,
      loanMonthlyPaymentCents: finance.loanMonthlyPaymentCents,
    },
    assumptions
  );

  return { ok: true as const, issues, canGenerate: canGenerate(issues) };
}

// ---------------------------------------------------------------------------
// Equipment catalog
// ---------------------------------------------------------------------------

const equipmentSchema = z.object({
  kind: z.enum(["module", "inverter", "battery", "adder"]),
  manufacturer: z.string().max(120).nullable().optional(),
  model: z.string().min(1).max(160),
  ratingW: z.number().int().min(0).nullable().optional(),
  costCents: z.number().int().min(0).optional(),
  priceCents: z.number().int().min(0).optional(),
  rank: z.number().int().min(0).max(999).optional(),
  // Ties a "Re-roof" / "MPU" adder to the Phase-3 crossover so selecting it
  // raises the flag on the deal instead of quietly becoming a line item.
  crossoverKind: z.enum(["reroof", "mpu"]).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function upsertSolarEquipmentAction(
  id: string | null,
  input: z.infer<typeof equipmentSchema>
) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = equipmentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid equipment.");

  if (id) {
    const existing = await prisma.solarEquipment.findFirst({
      where: { companyId: user.companyId, id },
      select: { id: true },
    });
    if (!existing) return fail("Not found.");
    await prisma.solarEquipment.update({ where: { id }, data: parsed.data });
  } else {
    await prisma.solarEquipment.create({
      data: { companyId: user.companyId, ...parsed.data },
    });
  }
  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

export async function deleteSolarEquipmentAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.solarEquipment.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true },
  });
  if (!existing) return fail("Not found.");
  await prisma.solarEquipment.delete({ where: { id } });
  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

// ---------------------------------------------------------------------------
// Credit applications
// ---------------------------------------------------------------------------

const creditSchema = z.object({
  leadId: z.string().min(1),
  lender: z.string().min(1).max(80),
  externalId: z.string().max(120).nullable().optional(),
  amountCents: z.number().int().min(0).optional(),
  termMonths: z.number().int().min(0).max(600).nullable().optional(),
  aprPct: z.number().min(0).max(50).nullable().optional(),
  dealerFeePct: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function submitCreditApplicationAction(input: z.infer<typeof creditSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = creditSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid application.");

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: parsed.data.leadId },
    select: { id: true },
  });
  if (!lead) return fail("Deal not found.");

  await prisma.creditApplication.create({
    data: {
      companyId: user.companyId,
      ...parsed.data,
      status: "submitted",
      submittedAt: new Date(),
    },
  });
  revalidatePath(`/portal/leads/${parsed.data.leadId}`);
  return ok();
}

