"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { year1Production, offsetPct } from "@/lib/solar-money";
import { canGenerate } from "@/lib/solar-validation";
import { readSolarReadiness } from "./readiness";
import { financeRowForProduct } from "@/lib/solar-finance-row";

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

  /**
   * Resolve a selected catalogue item, refusing anything that is not this
   * company's, not of the right kind, or retired.
   *
   * All three selectors go through this. Only the module used to be checked,
   * and only for kind — so a battery id posted into `inverterId` was written
   * straight through, and a product deactivated last month could still be
   * attached to a brand-new design. `allowExistingId` keeps an ALREADY-SAVED
   * choice readable after the catalogue item is retired: an existing draft
   * keeps rendering, but the deactivated item cannot be newly selected.
   */
  async function resolveEquipment(
    id: string | null | undefined,
    kind: "module" | "inverter" | "battery",
    allowExistingId: string | null
  ): Promise<{ ok: true; row: { id: string; ratingW: number | null } | null } | { ok: false; error: string }> {
    if (!id) return { ok: true, row: null };
    const row = await prisma.solarEquipment.findFirst({
      where: { companyId: user.companyId, id, kind },
      select: { id: true, ratingW: true, isActive: true, model: true },
    });
    if (!row) return { ok: false, error: `That ${kind} is not in your catalogue.` };
    if (!row.isActive && id !== allowExistingId) {
      return { ok: false, error: `“${row.model}” has been retired and cannot be added to a new design.` };
    }
    return { ok: true, row: { id: row.id, ratingW: row.ratingW } };
  }

  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { moduleId: true, inverterId: true, batteryId: true },
  });

  const [mod, inv, bat] = await Promise.all([
    resolveEquipment(d.moduleId, "module", existing?.moduleId ?? null),
    resolveEquipment(d.inverterId, "inverter", existing?.inverterId ?? null),
    resolveEquipment(d.batteryId, "battery", existing?.batteryId ?? null),
  ]);
  for (const r of [mod, inv, bat]) if (!r.ok) return fail(r.error);

  const module_ = mod.ok ? mod.row : null;

  const moduleQty = d.moduleQty ?? 0;
  const systemSizeKwDc = module_?.ratingW ? (moduleQty * module_.ratingW) / 1000 : 0;
  // TSRF belongs in the production maths. It was being collected on this very
  // form and then ignored, so a shaded roof and a perfect one produced the same
  // headline kWh — a difference the customer only discovers from their bill.
  const year1ProductionKwh = year1Production(systemSizeKwDc, assumptions, d.tsrfPct);

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

  // Every product-specific column is gated on the product — see
  // financeRowForProduct for why "most of them" was a customer-facing defect.
  const data = financeRowForProduct(f, {
    systemSizeKwDc: design?.systemSizeKwDc ?? 0,
    assumptions,
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
  costCents: z.number().int().min(0).optional(),
  priceCents: z.number().int().min(0).optional(),
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

