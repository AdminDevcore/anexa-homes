"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { year1Production, offsetPct } from "@/lib/solar-money";
import { canGenerate } from "@/lib/solar-validation";
import { readSolarReadiness } from "./readiness";
import { financeRowForProduct } from "@/lib/solar-finance-row";
import { resolveAdderTotal } from "./adders";

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
  // Null is meaningful and is the default: derive nothing, leave the sticker as
  // the rep typed it. Set, and gross is computed from the product's dealer fee.
  targetNetPpwCents: z.number().int().min(50).max(2000).nullable().optional(),
  netMeteringProgram: z.string().max(120).nullable(),
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

  // No incentive is quoted anywhere in the product, so saving settings also
  // clears anything a legacy row still carries. Leaving a stale 30% sitting in
  // the column is how it reappears the day someone renders that field again.
  const incentives = { federalItcPct: null, stateIncentiveNote: null };
  await prisma.solarSettings.upsert({
    where: { companyId: user.companyId },
    create: { companyId: user.companyId, ...d, ...incentives },
    update: { ...d, ...incentives },
  });
  revalidatePath("/portal/settings/solar");
  return ok();
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

/**
 * What the system-design step still collects.
 *
 * Everything else it used to ask for has moved to where the decision is
 * actually made: interconnection details and the equipment a job is built from
 * live on the deal's Operations card, the net-metering programme is one company
 * setting, and the panel comes from the catalogue's default. What is left is
 * what every number on the proposal is derived from.
 */
const designSchema = z.object({
  leadId: z.string().min(1),
  monthlyUsageKwh: z.array(z.number().min(0)).max(12).optional(),
  mountType: z.enum(["roof", "ground"]).optional(),
  roofPlanes: z.array(z.record(z.string(), z.unknown())).optional(),
  setbackNotes: z.string().max(2000).nullable().optional(),
  structuralNotes: z.string().max(2000).nullable().optional(),
  electricalNotes: z.string().max(2000).nullable().optional(),
  moduleQty: z.number().int().min(0).max(500).optional(),
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

  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { moduleId: true, moduleQty: true, annualUsageKwh: true },
  });

  // The panel is not a rep's decision any more — the approved-vendor list makes
  // it once a year, and an existing design keeps whatever it was quoted on.
  const existingUsage = existing;
  const module_ = await resolveSizingModule(user.companyId, existing?.moduleId ?? null);

  const moduleQty = d.moduleQty ?? existing?.moduleQty ?? 0;
  const systemSizeKwDc = module_?.ratingW ? (moduleQty * module_.ratingW) / 1000 : 0;
  // TSRF is gone. It was a shading figure typed from memory on this very form,
  // and it multiplied straight into the customer's quoted kWh — 85 vs 100 is a
  // 17% difference in what a homeowner is promised. System losses are the
  // company-wide derate in Solar Settings, which one person sets from real
  // production data instead of each rep guessing per roof.
  const year1ProductionKwh = year1Production(systemSizeKwDc, assumptions);

  // Usage belongs to the Energy step now, so this reads it rather than taking
  // it from the client. Offset still has to be recomputed here, because it
  // depends on the production that the module count just changed.
  const annualUsageKwh = existingUsage?.annualUsageKwh ?? null;
  const computedOffset = annualUsageKwh ? offsetPct(year1ProductionKwh, annualUsageKwh) : 0;

  const { leadId, moduleQty: _q, ...rest } = d;
  const data = {
    ...rest,
    moduleId: module_?.id ?? null,
    moduleQty,
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

const buildDetailsSchema = z.object({
  leadId: z.string().min(1),
  utilityAccountNo: z.string().max(60).nullable(),
  meterNo: z.string().max(60).nullable(),
});

/**
 * The utility's own numbers for this house, recorded when the job is built.
 *
 * Deliberately unable to change anything the customer was quoted. It once also
 * wrote the lender, the inverter and the battery, on the reasoning that ops
 * should be able to correct them from the deal without opening the builder —
 * which made one field with two owners. A rep quotes a Tesla inverter on a
 * document a homeowner signs, ops swaps it here a fortnight later, and the deal
 * and the customer's copy now disagree with nobody told. Equipment moves on the
 * proposal's design step and the lender on its financing step; both reissue a
 * version, which is what changing what somebody was sold is supposed to cost.
 */
export async function saveSolarBuildDetailsAction(input: z.infer<typeof buildDetailsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = buildDetailsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid build details.");
  const d = parsed.data;

  const design = await prisma.solarDesign.findFirst({
    where: { leadId: d.leadId, companyId: user.companyId },
    select: { id: true },
  });
  if (!design) return fail("Save the system design before recording build details.");

  await prisma.solarDesign.update({
    where: { leadId: d.leadId },
    data: { utilityAccountNo: d.utilityAccountNo, meterNo: d.meterNo },
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return ok();
}

const dealLenderSchema = z.object({
  leadId: z.string().min(1),
  lenderId: z.string().nullable(),
});

/**
 * Who is financing this deal, set from the Financing step — the ONLY control
 * that sets it.
 *
 * The lender lives on the DESIGN because it gates the approved-vendor list, and
 * it is the first thing the Financing step needs: with no lender there is no
 * rate sheet to quote. The deal page used to offer a second picker for the same
 * field; it now reports what the last proposal froze and links back here, so
 * the lender a customer was quoted against and the lender on the deal cannot
 * drift apart between two screens.
 *
 * Changing the lender CLEARS the quoted product: a rate sheet belongs to the
 * lender that published it, and leaving the old id behind would quote Climate
 * First's money on an Amos deal. Equipment is deliberately left alone — an item
 * that has fallen off the new lender's list is a decision for whoever reissues
 * the proposal, not something to blank out from under an order.
 */
export async function setSolarDealLenderAction(input: z.infer<typeof dealLenderSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = dealLenderSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid lender.");
  const { leadId, lenderId } = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lead) return fail("Deal not found.");

  // A lender id from another company must never attach to this design.
  if (lenderId) {
    const l = await prisma.solarLender.findFirst({
      where: { companyId: user.companyId, id: lenderId },
      select: { id: true },
    });
    if (!l) return fail("That lender is not in your list.");
  }

  // Upsert rather than update: the Financing step can be opened before the
  // design has ever been saved, and refusing to record the lender because a row
  // does not exist yet would be an error the rep cannot act on.
  await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, lenderId },
    update: { lenderId },
  });

  // Drop a quote that belonged to the lender we just left.
  const finance = await prisma.solarFinance.findUnique({
    where: { leadId },
    select: { lenderProductId: true },
  });
  let clearedProduct = false;
  if (finance?.lenderProductId) {
    const stillOurs = lenderId
      ? await prisma.solarLenderProduct.findFirst({
          where: { companyId: user.companyId, id: finance.lenderProductId, lenderId },
          select: { id: true },
        })
      : null;
    if (!stillOurs) {
      await prisma.solarFinance.update({
        where: { leadId },
        data: { lenderProductId: null },
      });
      clearedProduct = true;
    }
  }

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const, clearedProduct };
}

// ---------------------------------------------------------------------------
// Providers — the utilities and retailers a company sells against
// ---------------------------------------------------------------------------

const providerSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["utility", "retail"]),
  name: z.string().min(1).max(120),
  position: z.number().int().min(0).max(999).optional(),
});

/** Create or rename one provider. Names are unique per company and kind. */
export async function saveSolarProviderAction(input: z.infer<typeof providerSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid provider.");
  const d = parsed.data;
  const name = d.name.trim();

  if (d.id) {
    const existing = await prisma.solarProvider.findFirst({
      where: { id: d.id, companyId: user.companyId },
      select: { id: true },
    });
    if (!existing) return fail("Provider not found.");
  }

  try {
    if (d.id) {
      await prisma.solarProvider.update({
        where: { id: d.id },
        data: { name, ...(d.position == null ? {} : { position: d.position }) },
      });
    } else {
      await prisma.solarProvider.create({
        data: { companyId: user.companyId, kind: d.kind, name, position: d.position ?? 0 },
      });
    }
  } catch {
    // The unique index is the enforcement; this is the message for it.
    return fail(`“${name}” is already on that list.`);
  }

  revalidatePath("/portal/settings/solar-providers");
  return ok();
}

/**
 * Retire a provider rather than deleting it.
 *
 * Designs store the provider's NAME, so a delete leaves deals naming something
 * the company no longer recognises — and the name on a sent proposal has to
 * keep meaning what it meant.
 */
export async function setSolarProviderActiveAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const row = await prisma.solarProvider.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!row) return fail("Provider not found.");
  await prisma.solarProvider.update({ where: { id }, data: { active } });
  revalidatePath("/portal/settings/solar-providers");
  return ok();
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

const financeSchema = z.object({
  leadId: z.string().min(1),
  product: z.enum(["cash", "loan", "lease", "ppa"]),
  grossPpwCents: z.number().int().min(0).optional(),
  dealerFeePct: z.number().min(0).max(100).optional(),
  /// NOT accepted from the caller any more. The adder total is the deal's own,
  /// resolved from its lines — see resolveAdderTotal.
  rateMillsPerKwh: z.number().int().min(0).nullable().optional(),
  monthlyPaymentCents: z.number().int().min(0).nullable().optional(),
  escalatorPct: z.number().min(0).max(10).nullable().optional(),
  termYears: z.number().int().min(0).max(40).nullable().optional(),
  aprPct: z.number().min(0).max(50).nullable().optional(),
  loanTermMonths: z.number().int().min(0).max(600).nullable().optional(),
  downPaymentCents: z.number().int().min(0).nullable().optional(),
  loanMonthlyPaymentCents: z.number().int().min(0).nullable().optional(),
  /// Which catalogue product this is quoted from. Its terms are read from the
  /// database, never from the client — see below.
  lenderProductId: z.string().nullable().optional(),
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
    select: { systemSizeKwDc: true, lenderId: true },
  });

  // The quoted product's terms are READ HERE, from the row, and never taken
  // from the request. A rate sheet a caller can post arbitrary terms against is
  // not a rate sheet — the APR a customer is quoted has to be one this lender
  // actually offers. Scoped to the company, and to the lender the system was
  // designed for, so a product id from elsewhere resolves to nothing.
  const lenderProduct = f.lenderProductId
    ? await prisma.solarLenderProduct.findFirst({
        where: {
          id: f.lenderProductId,
          companyId: user.companyId,
          ...(design?.lenderId ? { lenderId: design.lenderId } : {}),
        },
        select: {
          id: true, product: true, aprPct: true, termMonths: true, dealerFeePct: true,
          leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true, escalatorPct: true,
          termYears: true,
        },
      })
    : null;

  // The adders are the DEAL's, read here rather than taken from the request.
  // Nothing was sending them, so every save wrote a zero over the cached total
  // and priced the contract without the extra work in it.
  const adderTotalCents = await resolveAdderTotal(user.companyId, f.leadId);

  // Every product-specific column is gated on the product — see
  // financeRowForProduct for why "most of them" was a customer-facing defect.
  const data = financeRowForProduct({ ...f, adderTotalCents }, {
    systemSizeKwDc: design?.systemSizeKwDc ?? 0,
    assumptions,
    lenderProduct,
    targetNetPpwCents: assumptions.targetNetPpwCents,
  });

  const saved = await prisma.solarFinance.upsert({
    where: { leadId: f.leadId },
    create: { companyId: user.companyId, leadId: f.leadId, ...data },
    update: data,
    select: {
      product: true, grossPpwCents: true, dealerFeePct: true, adderTotalCents: true,
      contractPriceCents: true, itcEstimateCents: true, rateMillsPerKwh: true,
      monthlyPaymentCents: true, escalatorPct: true, termYears: true, aprPct: true,
      loanTermMonths: true, downPaymentCents: true, loanMonthlyPaymentCents: true,
      lenderProductId: true,
    },
  });

  revalidatePath(`/portal/leads/${f.leadId}`);
  // Return what was actually STORED, so the panel re-seeds from the database
  // rather than from what it hoped it sent. A save that silently dropped a
  // field now shows up immediately instead of at the next hard reload.
  return { ok: true as const, finance: saved };
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
  const readiness = await readSolarReadiness(user.companyId, leadId);
  if (!readiness.ok) return fail(readiness.error);
  return { ok: true as const, issues: readiness.issues, canGenerate: canGenerate(readiness.issues) };
}

// ---------------------------------------------------------------------------
// Equipment catalog
// ---------------------------------------------------------------------------

const equipmentSchema = z.object({
  kind: z.enum(["module", "inverter", "battery", "adder"]),
  manufacturer: z.string().max(120).nullable().optional(),
  model: z.string().min(1).max(160),
  ratingW: z.number().int().min(0).nullable().optional(),
  // The module's PHYSICAL size, which the roof designer draws it at. Bounded
  // to the range a laminate is actually made in, so a millimetre figure typed
  // in inches cannot put a 44-metre panel on a customer's roof.
  widthMm: z.number().int().min(300).max(3000).nullable().optional(),
  heightMm: z.number().int().min(300).max(3000).nullable().optional(),
  costCents: z.number().int().min(0).optional(),
  priceCents: z.number().int().min(0).optional(),
  // Adders only: the per-watt rate, in tenths of a cent per installed watt.
  // 50 = $0.05/W. Non-null is what makes an adder per-watt. Capped at $10/W
  // because a rate above that is dollars typed where mills were wanted.
  priceMillsPerWatt: z.number().int().min(0).max(10_000).nullable().optional(),
  rank: z.number().int().min(0).max(999).optional(),
  // Ties a "Re-roof" / "MPU" adder to the Phase-3 crossover so selecting it
  // raises the flag on the deal instead of quietly becoming a line item.
  crossoverKind: z.enum(["reroof", "mpu"]).nullable().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  // The AVL turns over annually. Bounded to a sane window so a typo cannot file
  // a product under the year 202 or 20260.
  avlYear: z.number().int().min(2000).max(2100).nullable().optional(),
});

/**
 * Create or edit a catalogue item.
 *
 * Three integrity rules the catalogue did not have:
 *
 *  1. A MODULE must carry a wattage above zero. Every downstream number —
 *     system size, production, offset, price — is derived from it, and a 0W
 *     module produces a proposal for a system that generates nothing.
 *  2. Identity (kind + manufacturer + model + rating) is unique per company,
 *     so a rep picking from a dropdown of three identical "Powerwall 3" rows
 *     cannot pick the wrong one. Checked here for a readable error; the
 *     database enforces it regardless.
 *  3. At most one ACTIVE default per kind, applied by demoting the incumbent
 *     in the same transaction rather than by rejecting the edit.
 */
export async function upsertSolarEquipmentAction(
  id: string | null,
  input: z.infer<typeof equipmentSchema>
) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = equipmentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid equipment.");
  const d = parsed.data;

  if (d.kind === "module" && !(d.ratingW && d.ratingW > 0)) {
    return fail("A module needs a wattage above zero — system size is calculated from it.");
  }

  // A per-watt rate on a panel means nothing, and would put a rate on a deal
  // line that the adder maths never reads.
  if (d.kind !== "adder" && d.priceMillsPerWatt) {
    return fail("Only an adder can be priced per watt.");
  }
  // One price per item. An adder carrying both a flat price and a per-watt rate
  // has two answers to "what does this cost", and which one applies would
  // depend on which code path read it.
  if (d.kind === "adder" && d.priceMillsPerWatt && d.priceCents) {
    return fail("An adder is either a flat price or a rate per watt, not both.");
  }

  // Identity clash, in the same terms a rep would recognise.
  const clash = await prisma.solarEquipment.findFirst({
    where: {
      companyId: user.companyId,
      kind: d.kind,
      model: { equals: d.model, mode: "insensitive" },
      ratingW: d.ratingW ?? null,
      ...(d.manufacturer
        ? { manufacturer: { equals: d.manufacturer, mode: "insensitive" as const } }
        : { manufacturer: null }),
      ...(id ? { NOT: { id } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    return fail(
      `${[d.manufacturer, d.model].filter(Boolean).join(" ")}${d.ratingW ? ` · ${d.ratingW}W` : ""} is already in the catalogue.`
    );
  }

  await prisma.$transaction(async (tx) => {
    // Only one active default per kind. Demote first so the partial unique
    // index never sees two.
    if (d.isDefault && d.isActive !== false) {
      await tx.solarEquipment.updateMany({
        where: { companyId: user.companyId, kind: d.kind, isDefault: true, ...(id ? { NOT: { id } } : {}) },
        data: { isDefault: false },
      });
    }
    if (id) {
      const existing = await tx.solarEquipment.findFirst({
        where: { companyId: user.companyId, id },
        select: { id: true },
      });
      if (!existing) throw new Error("Not found.");
      await tx.solarEquipment.update({ where: { id }, data: d });
    } else {
      await tx.solarEquipment.create({ data: { companyId: user.companyId, ...d } });
    }
  });

  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

/**
 * Promote one catalogue item to be the default for its kind.
 *
 * Its own action rather than a flag on the upsert, because "make this the
 * default" is a one-click operation on an existing row and should not require
 * re-posting every field. Demotes the incumbent in the same transaction so the
 * partial unique index never sees two.
 */
export async function setDefaultSolarEquipmentAction(id: string, isDefault: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const item = await prisma.solarEquipment.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, kind: true, isActive: true },
  });
  if (!item) return fail("Not found.");
  if (isDefault && !item.isActive) {
    return fail("A retired product cannot be the default. Reactivate it first.");
  }

  await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.solarEquipment.updateMany({
        where: { companyId: user.companyId, kind: item.kind, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    await tx.solarEquipment.update({ where: { id }, data: { isDefault } });
  });
  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

/**
 * How many designs still point at this catalogue item.
 *
 * The three foreign keys are ON DELETE SET NULL, which is the quiet failure
 * mode this guards: deleting a module does not error, it silently blanks the
 * module on every design that used it. Those deals then show no equipment, and
 * their system size no longer reconciles with anything.
 */
async function equipmentUsage(companyId: string, id: string) {
  const [asModule, asInverter, asBattery] = await Promise.all([
    prisma.solarDesign.count({ where: { companyId, moduleId: id } }),
    prisma.solarDesign.count({ where: { companyId, inverterId: id } }),
    prisma.solarDesign.count({ where: { companyId, batteryId: id } }),
  ]);
  return { asModule, asInverter, asBattery, total: asModule + asInverter + asBattery };
}

/**
 * Retire a catalogue item, or bring it back.
 *
 * RETIRING IS THE ANSWER TO "we do not sell this any more", not deleting. A
 * retired item disappears from the selectors a rep builds new systems with,
 * while every design that already chose it keeps rendering exactly as before —
 * the deal page, the project detail and any generated proposal are untouched.
 * That is the whole point: last year's approved-vendor list has to stop being
 * sellable without rewriting last year's deals.
 *
 * Also clears `isDefault`: a product nobody can pick must not stay the default
 * a new design starts on.
 */
export async function setSolarEquipmentActiveAction(id: string, isActive: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const item = await prisma.solarEquipment.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, model: true, manufacturer: true },
  });
  if (!item) return fail("Not found.");

  await prisma.solarEquipment.update({
    where: { id },
    data: { isActive, ...(isActive ? {} : { isDefault: false }) },
  });
  revalidatePath("/portal/settings/solar-equipment");
  const name = [item.manufacturer, item.model].filter(Boolean).join(" ");
  return { ok: true as const, message: isActive ? `${name} is sellable again.` : `${name} retired.` };
}

/**
 * Delete a catalogue item outright.
 *
 * REFUSED while any design still references it. The foreign keys are ON DELETE
 * SET NULL, so this would not fail loudly — it would blank the equipment on
 * every historical deal and leave their system sizes unexplainable. Retiring
 * does what the person almost always meant, and is offered by name in the
 * error rather than left for them to discover.
 *
 * Deleting is still allowed for an item nothing has ever used — a typo, a
 * duplicate, a product added and never sold.
 */
export async function deleteSolarEquipmentAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.solarEquipment.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, model: true, manufacturer: true },
  });
  if (!existing) return fail("Not found.");

  const use = await equipmentUsage(user.companyId, id);
  if (use.total > 0) {
    const where = [
      use.asModule && `${use.asModule} as the module`,
      use.asInverter && `${use.asInverter} as the inverter`,
      use.asBattery && `${use.asBattery} as the battery`,
    ].filter(Boolean).join(", ");
    return fail(
      `${use.total} ${use.total === 1 ? "design uses" : "designs use"} this (${where}). ` +
        `Deleting it would blank the equipment on those deals. Retire it instead — it disappears ` +
        `from new designs and every existing one keeps its equipment.`
    );
  }

  await prisma.solarEquipment.delete({ where: { id } });
  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

// ---------------------------------------------------------------------------
// Lenders and their approved-vendor lists
// ---------------------------------------------------------------------------

/**
 * A link a rep or a customer will actually click.
 *
 * http(s) only, and validated rather than trusted: an unchecked string here
 * becomes an `href`, and `javascript:` in the proposal's Qualify button would
 * be stored XSS aimed at the homeowner reading it. Empty string normalises to
 * null so clearing the box clears the field.
 *
 * `z.optional(...)` wraps the transform rather than the other way round: an
 * `.optional().transform()` chain is a ZodEffects, and an effects-typed key is
 * REQUIRED on the object even when its value may be undefined — which would
 * force every caller that does not touch links to send them.
 */
const urlField = z.optional(
  z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^https?:\/\//i.test(v),
      "Links must start with http:// or https://"
    )
);

const lenderSchema = z.object({
  name: z.string().min(1).max(120),
  rank: z.number().int().min(0).max(999).optional(),
  notes: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  /** Rep-facing dealer portal. Never rendered to a customer. */
  portalUrl: urlField,
  /** Customer-facing application link — the proposal's Qualify button. */
  applyUrl: urlField,
  creditInstructions: z.string().max(4000).nullable().optional(),
  /**
   * How reps are paid on this lender's deals: `redline` (they keep the overage
   * above their own net redline) or `per_watt` (a flat rate per installed watt).
   *
   * A column rather than a name check on "Amos" — see SolarRepPayMode. Changing
   * it only affects deals whose commission has not been generated yet: existing
   * lines carry a snapshot of the terms they were sold on.
   */
  repPayMode: z.enum(["redline", "per_watt"]).optional(),
});

/**
 * Add or rename a lender.
 *
 * Names are unique per company, case-insensitively. Two "Credit Human" rows
 * would split one approved-vendor list across two lenders, and equipment tagged
 * against the wrong one would silently disappear from the selectors — which
 * looks exactly like equipment that was never approved.
 */
export async function upsertSolarLenderAction(id: string | null, input: z.infer<typeof lenderSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = lenderSchema.safeParse(input);
  // The message, not a flat "Invalid lender.": the only ways this fails are a
  // name that is too long and a link that is not http(s), and both are things
  // the person typing can fix once they are told which.
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid lender.");
  const d = parsed.data;

  const clash = await prisma.solarLender.findFirst({
    where: {
      companyId: user.companyId,
      name: { equals: d.name, mode: "insensitive" },
      ...(id ? { NOT: { id } } : {}),
    },
    select: { id: true },
  });
  if (clash) return fail(`"${d.name}" is already in your lender list.`);

  if (id) {
    const existing = await prisma.solarLender.findFirst({
      where: { companyId: user.companyId, id },
      select: { id: true },
    });
    if (!existing) return fail("Not found.");
    await prisma.solarLender.update({ where: { id }, data: d });
  } else {
    await prisma.solarLender.create({ data: { companyId: user.companyId, ...d } });
  }
  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

/**
 * Retire a lender, or bring it back.
 *
 * Same reasoning as retiring equipment: designs point at it. Retiring keeps
 * every existing deal readable while removing the lender from new work.
 */
export async function setSolarLenderActiveAction(id: string, isActive: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const l = await prisma.solarLender.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, name: true },
  });
  if (!l) return fail("Not found.");
  await prisma.solarLender.update({ where: { id }, data: { isActive } });
  revalidatePath("/portal/settings/solar-equipment");
  return { ok: true as const, message: isActive ? `${l.name} is available again.` : `${l.name} retired.` };
}

/**
 * Delete a lender outright. Refused while any design is being built for it —
 * the FK is ON DELETE SET NULL, so this would silently unset the lender on
 * those deals and widen their equipment lists without anyone noticing.
 *
 * Equipment approvals are NOT a blocker: those are just list membership and
 * cascade away cleanly with the lender.
 */
export async function deleteSolarLenderAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const l = await prisma.solarLender.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, name: true },
  });
  if (!l) return fail("Not found.");

  const inUse = await prisma.solarDesign.count({ where: { companyId: user.companyId, lenderId: id } });
  if (inUse > 0) {
    return fail(
      `${inUse} ${inUse === 1 ? "design is" : "designs are"} being built for ${l.name}. ` +
        `Deleting it would clear the lender on ${inUse === 1 ? "that deal" : "those deals"} and widen ` +
        `their equipment lists. Retire it instead.`
    );
  }
  await prisma.solarLender.delete({ where: { id } });
  revalidatePath("/portal/settings/solar-equipment");
  return ok();
}

/**
 * Set exactly which lenders approve one catalogue item.
 *
 * Replaces the whole set in a transaction rather than diffing: the caller sends
 * the checkboxes as they now stand, and a partial failure that left an item
 * half-approved would be worse than either outcome.
 */
export async function setEquipmentLendersAction(equipmentId: string, lenderIds: string[]) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const item = await prisma.solarEquipment.findFirst({
    where: { companyId: user.companyId, id: equipmentId },
    select: { id: true },
  });
  if (!item) return fail("Not found.");

  // Only this company's lenders, so an id from elsewhere cannot be attached.
  const valid = await prisma.solarLender.findMany({
    where: { companyId: user.companyId, id: { in: lenderIds } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.solarEquipmentLender.deleteMany({ where: { equipmentId } }),
    prisma.solarEquipmentLender.createMany({
      data: valid.map((l) => ({ equipmentId, lenderId: l.id })),
      skipDuplicates: true,
    }),
  ]);
  revalidatePath("/portal/settings/solar-equipment");
  return { ok: true as const, count: valid.length };
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

