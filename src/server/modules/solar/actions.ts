"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { recomputeDesignFigures } from "./recompute";
import { canGenerate } from "@/lib/solar-validation";
import { readSolarReadiness } from "./readiness";
import { financeRowForProduct } from "@/lib/solar-finance-row";
import { LENDER_TERMS_SELECT, toLenderProductTerms } from "./lender-terms";
import { recomputeAdderTotal, resolveAdderTotal, restampAddersForLender } from "./adders";
import { dealRebateTotalCents } from "./storage";
import { priceStorageStored } from "@/lib/solar-money";

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
  // The utility's standing monthly charge, cents. Zero is allowed and means the
  // company is quoting a utility that genuinely bills none; the $100/mo ceiling
  // is a typo rail, not a policy.
  utilityMeterFeeCents: z.number().int().min(0).max(10000),
  defaultGrossPpwCents: z.number().int().min(50).max(2000),
  defaultDealerFeePct: z.number().min(0).max(50),
  // Null is meaningful and is the default: derive nothing, leave the sticker as
  // the rep typed it. Set, and gross is computed from the product's dealer fee.
  targetNetPpwCents: z.number().int().min(50).max(2000).nullable().optional(),
  // What an owned system is claimed to add to a home's value, %. Zero — the
  // default — means the claim is not made and the proposal omits the card.
  // Capped at 20 because the published studies cluster around four, and a
  // number an order of magnitude above them is a typo reaching a homeowner.
  homeValueUpliftPct: z.number().min(0).max(20).optional(),
  // How many batteries a design starts with once a rep picks one. Minimum one:
  // zero would mean "a battery, none of them", which is not a system anybody
  // can build. Optional so a client that predates the field leaves it alone.
  defaultBatteryQty: z.number().int().min(1).max(20).optional(),
  minOffsetPct: z.number().min(0).max(200),
  maxOffsetPct: z.number().min(0).max(500),
  // The federal credits, for the contract-adjustment ladder. Statute, so they
  // are typed rather than compiled in. Zero is meaningful — it means the
  // company does not quote that bonus at all and the row is dropped from the
  // customer's page. Capped at 100 apiece: three that sum past the contract
  // are clamped by the ladder, but no single one above the whole price is
  // anything other than a typo. Optional so a client that predates the fields
  // leaves them alone.
  creditItcPct: z.number().min(0).max(100).optional(),
  creditEnergyCommunityPct: z.number().min(0).max(100).optional(),
  creditDomesticContentPct: z.number().min(0).max(100).optional(),
  // Never stored blank: what the remainder is CALLED appears on a document a
  // household signs, and an empty label there is a negative figure with no
  // name against it.
  creditIncentiveLabel: z.string().trim().min(1).max(80).optional(),
  creditDisclaimer: z.string().trim().min(1).max(1200).optional(),
});

export async function updateSolarSettingsAction(input: z.infer<typeof settingsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const d = parsed.data;
  if (d.minOffsetPct >= d.maxOffsetPct) return fail("Minimum offset must be below the maximum.");

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

/**
 * Which federal credits THIS job earns.
 *
 * ITS OWN ACTION rather than three more fields on `saveSolarFinanceAction`,
 * because these answers reach no pricing at all: they decide which rows appear
 * on the customer's ladder and how the incentive — always the difference — is
 * split between a credit line and a giveaway. Threading them through
 * `financeRowForProduct` would put three booleans inside the one function in
 * this codebase that is guarded against acquiring inputs that are not money.
 *
 * A `Lead:update` grant, the same one that prices the deal, because deciding a
 * roof is not in an energy community is a fact about the job a rep establishes.
 */
const creditClaimsSchema = z.object({
  leadId: z.string().min(1),
  claimItc: z.boolean(),
  claimEnergyCommunity: z.boolean(),
  claimDomesticContent: z.boolean(),
});

export async function setSolarCreditClaimsAction(input: z.infer<typeof creditClaimsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = creditClaimsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid credit selection.");
  const { leadId, ...claims } = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // updateMany rather than update: a deal whose financing has not been saved
  // yet has no row, and the honest outcome there is "nothing to record", not a
  // thrown P2025 that reads to a rep as a dead tick-box.
  const { count } = await prisma.solarFinance.updateMany({
    where: { companyId: user.companyId, leadId },
    data: claims,
  });
  if (count === 0) return fail("Save the financing on this deal first.");

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
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
 * live on the deal's Operations card, and the panel comes from the catalogue's
 * default. What is left is what every number on the proposal is derived from.
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
 * System size, production and offset are never taken from the client, and — the
 * point of this note — they are never computed HERE either. They come from
 * `recomputeDesignFigures`, the one function that prices the arrays actually
 * drawn on the roof against the yields NREL actually simulated for their
 * planes.
 *
 * This step used to work them out itself, from the panel count and a single
 * market-average yield: `size × kwhPerKwYear × derate`, flat, with no idea
 * which way the roof faced or that PVWatts had already answered for it. Both
 * models were live at once and the rep could see both — the designer quoted a
 * 10.56 kW south roof at 14,977 kWh and 118%, and pressing Save on this step,
 * which only ever sends the mount type, overwrote it with 12,219 kWh and 96%.
 * The lower one is the one the proposal freezes and the customer is quoted, and
 * nothing about the house had changed between them.
 *
 * A design with nothing drawn on it therefore comes out at zero rather than
 * keeping a panel count somebody typed before the designer existed. That is the
 * same answer every other write already gives — the layout save, the equipment
 * pick, the reprice — and the step's own summary already reads the geometry and
 * says when a stored count no longer matches it.
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

  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { moduleId: true },
  });

  // The panel is not a rep's decision any more — the approved-vendor list makes
  // it once a year, and an existing design keeps whatever it was quoted on.
  const module_ = await resolveSizingModule(user.companyId, existing?.moduleId ?? null);

  const { leadId, moduleQty, ...rest } = d;
  const data = {
    ...rest,
    moduleId: module_?.id ?? null,
    // Only on the way IN. The recompute below counts the panels off the
    // geometry and writes the count it finds, which is what every other reader
    // of this row already trusts.
    ...(moduleQty == null ? {} : { moduleQty }),
  };

  // The row has to exist before the recompute can price it — a deal whose
  // design has never been saved has no row at all.
  await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, ...data },
    update: data,
  });

  // Mount type is a repricing input, not just a label: PVWatts simulates a
  // fixed roof mount and an open rack differently, and a rack in a yard runs
  // cooler. So this is recomputed after the save rather than beside it.
  const figures = await recomputeDesignFigures(user.companyId, leadId);

  revalidatePath(`/portal/leads/${leadId}`);
  // The figures just moved, and both of the other screens that show them are
  // separate routes — the builder a rep is standing on and the designer they
  // came from.
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal/design`);
  return {
    ok: true as const,
    systemSizeKwDc: figures?.systemSizeKwDc ?? 0,
    year1ProductionKwh: figures?.year1ProductionKwh ?? 0,
    offsetPct: figures?.offsetPct ?? 0,
  };
}

const buildDetailsSchema = z.object({
  leadId: z.string().min(1),
  utilityAccountNo: z.string().max(60).nullable(),
  meterNo: z.string().max(60).nullable(),
  // Permitting & AHJ — the same shape of fact as the two above: recorded once
  // the job is real, and read straight into the permit packet.
  ahjName: z.string().max(120).nullable(),
  ahjContactName: z.string().max(120).nullable(),
  ahjContactInfo: z.string().max(160).nullable(),
  permitNumber: z.string().max(60).nullable(),
  installerContact: z.string().max(160).nullable(),
  installerTitle: z.string().max(80).nullable(),
  permitNotRequired: z.boolean(),
  ptoNotRequired: z.boolean(),
  interconnectionNotRequired: z.boolean(),
  otherUtilityStatus: z.boolean(),
  otherUtilityStatusDetail: z.string().max(200).nullable(),
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
    data: {
      utilityAccountNo: d.utilityAccountNo,
      meterNo: d.meterNo,
      ahjName: d.ahjName,
      ahjContactName: d.ahjContactName,
      ahjContactInfo: d.ahjContactInfo,
      permitNumber: d.permitNumber,
      installerContact: d.installerContact,
      installerTitle: d.installerTitle,
      permitNotRequired: d.permitNotRequired,
      ptoNotRequired: d.ptoNotRequired,
      interconnectionNotRequired: d.interconnectionNotRequired,
      otherUtilityStatus: d.otherUtilityStatus,
      otherUtilityStatusDetail: d.otherUtilityStatusDetail,
    },
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
 *
 * It also RE-STAMPS the adders. Whether a roof rides on top of the partner's
 * $/W or comes out of it is the partner's rule, and moving the deal to a
 * partner that answers differently has to move the lines with it — see
 * `restampAddersForLender`. This is the one place that is allowed to: the flag
 * is copied at pick time precisely so a Settings edit cannot re-price a quote,
 * and the exception is a change made on this deal, about this deal.
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

  // The extra work re-reads the new partner's rules, and the cached totals are
  // rebuilt from the lines so the contract price moves with them. Forced,
  // because this IS a deliberate edit to the adders — see recomputeAdderTotal.
  const restamped = await restampAddersForLender(user.companyId, leadId, lenderId);
  if (restamped > 0) await recomputeAdderTotal(user.companyId, leadId, { force: true });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const, clearedProduct, restampedAdders: restamped };
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

  // The id comes back so the screen can OPEN what was just added — adding a
  // provider is the first step of recording its terms, not an end in itself.
  let id: string;
  try {
    if (d.id) {
      const row = await prisma.solarProvider.update({
        where: { id: d.id },
        data: { name, ...(d.position == null ? {} : { position: d.position }) },
        select: { id: true },
      });
      id = row.id;
    } else {
      const row = await prisma.solarProvider.create({
        data: { companyId: user.companyId, kind: d.kind, name, position: d.position ?? 0 },
        select: { id: true },
      });
      id = row.id;
    }
  } catch {
    // The unique index is the enforcement; this is the message for it.
    return fail(`“${name}” is already on that list.`);
  }

  revalidatePath("/portal/settings/solar-providers");
  return { ok: true as const, id };
}

/**
 * What a provider does for a solar customer.
 *
 * A separate action from the rename above, deliberately. That one is called
 * from an inline text box on every row and posts a name; this one is a form
 * somebody opens on one provider and fills in. Folding them together would mean
 * every rename posted seven nullable fields, and any of them missing from the
 * payload would blank a rate the office had recorded.
 */
const providerTermsSchema = z.object({
  buyback: z.boolean(),
  /** Mills per exported kWh. 95 = $0.095. Null when the rate varies or is unknown. */
  buybackRateMills: z.number().int().min(0).max(2_000).nullable(),
  /**
   * Time-of-use, mills per kWh. Both or neither — see the pair check below.
   */
  touPeakRateMills: z.number().int().min(0).max(2_000).nullable(),
  touOffPeakRateMills: z.number().int().min(0).max(2_000).nullable(),
  touPeakWindow: z.string().max(60).nullable(),
  vpp: z.boolean(),
  vppProgramme: z.string().max(120).nullable(),
  vppUpfrontCents: z.number().int().min(0).max(100_000_00).nullable(),
  vppAnnualCents: z.number().int().min(0).max(100_000_00).nullable(),
  /**
   * Who the programme is open to. Every list EMPTY MEANS NO RESTRICTION, which
   * is why they are plain arrays with no "restrict?" flag beside them: there is
   * no difference worth storing between "open to everyone" and "nobody has
   * narrowed it", and a flag that could disagree with its own list is a third
   * state for a screen to render wrong.
   */
  vppFinanceProducts: z.array(z.enum(["cash", "loan", "lease", "ppa"])),
  vppBatteryIds: z.array(z.string().uuid()),
  vppProductIds: z.array(z.string().uuid()),
  notes: z.string().max(2_000).nullable(),
});

export async function saveSolarProviderTermsAction(
  id: string,
  input: z.infer<typeof providerTermsSchema>
) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = providerTermsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid provider terms.");
  const d = parsed.data;

  /**
   * A half-filled TOU pair is rejected, not stored.
   *
   * Savings are the SPREAD between the two, so one rate alone computes nothing
   * and `touSavings` returns null — the proposal quietly drops the line with
   * nothing on any screen saying why. Better to refuse the save while somebody
   * is looking at the box they left empty.
   */
  if ((d.touPeakRateMills == null) !== (d.touOffPeakRateMills == null)) {
    return fail("Enter both the peak and the off-peak rate, or neither.");
  }
  if (
    d.touPeakRateMills != null &&
    d.touOffPeakRateMills != null &&
    d.touPeakRateMills <= d.touOffPeakRateMills
  ) {
    return fail("The peak rate has to be above the off-peak rate.");
  }

  const row = await prisma.solarProvider.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!row) return fail("Provider not found.");

  /**
   * Only this company's catalogue, and only this company's rate sheet.
   *
   * The ids arrive from a browser, and a join row written against another
   * company's battery would put a name nobody here recognises on a programme —
   * the same reason every other action re-reads its foreign keys rather than
   * trusting the payload. Ids that survive the filter are the ones we write;
   * ones that do not are simply dropped.
   */
  const [batteries, products] = d.vpp
    ? await Promise.all([
        prisma.solarEquipment.findMany({
          where: { id: { in: d.vppBatteryIds }, companyId: user.companyId },
          select: { id: true },
        }),
        prisma.solarLenderProduct.findMany({
          where: { id: { in: d.vppProductIds }, companyId: user.companyId },
          select: { id: true },
        }),
      ])
    : [[], []];

  await prisma.solarProvider.update({
    where: { id },
    data: {
      buyback: d.buyback,
      // The figures follow their flag. Leaving a rate behind on a provider
      // somebody has just said does NOT buy back is the same class of bug as an
      // APR stranded on a lease: it is invisible until the day it is read.
      buybackRateMills: d.buyback ? d.buybackRateMills : null,
      touPeakRateMills: d.touPeakRateMills,
      touOffPeakRateMills: d.touOffPeakRateMills,
      touPeakWindow: d.touPeakWindow?.trim() || null,
      vpp: d.vpp,
      vppProgramme: d.vpp ? (d.vppProgramme?.trim() || null) : null,
      vppUpfrontCents: d.vpp ? d.vppUpfrontCents : null,
      vppAnnualCents: d.vpp ? d.vppAnnualCents : null,
      // The conditions follow their flag, exactly as the figures do. A battery
      // list left behind on a provider somebody has just said runs NO programme
      // is a condition on nothing, and it would come back the day the flag is
      // ticked again saying something nobody has checked since.
      vppFinanceProducts: d.vpp ? d.vppFinanceProducts : [],
      vppEquipment: {
        deleteMany: {},
        create: batteries.map((b) => ({ equipmentId: b.id })),
      },
      vppProducts: {
        deleteMany: {},
        create: products.map((p) => ({ productId: p.id })),
      },
      // Notes survive either flag: "checked with them in March, they do not"
      // is worth keeping on a provider that does neither.
      notes: d.notes?.trim() || null,
    },
  });

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
  /** The storage sticker, per battery. Its own column: one field holding both
   *  would be read back as $/W by every screen that prices a saved deal. */
  stickerPricePerBatteryCents: z.number().int().min(0).max(100_000_00).optional(),
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
    select: {
      systemSizeKwDc: true,
      lenderId: true,
      systemType: true,
      batteryQty: true,
      // The partner's per-battery rule, read off the LENDER rather than the
      // programme row — the same place the $/W ceiling is read from.
      lender: {
        select: { maxFinalPricePerBatteryCents: true, finalBatteryPriceMode: true },
      },
    },
  });
  const lenderBand = design?.lender ?? null;

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
        select: LENDER_TERMS_SELECT,
      })
    : null;

  // The adders are the DEAL's, read here rather than taken from the request.
  // Nothing was sending them, so every save wrote a zero over the cached total
  // and priced the contract without the extra work in it.
  const adders = await resolveAdderTotal(user.companyId, f.leadId);

  // Every product-specific column is gated on the product — see
  // financeRowForProduct for why "most of them" was a customer-facing defect.
  const rowData = financeRowForProduct({ ...f, ...adders }, {
    systemSizeKwDc: design?.systemSizeKwDc ?? 0,
    assumptions,
    lenderProduct: toLenderProductTerms(lenderProduct),
    targetNetPpwCents: assumptions.targetNetPpwCents,
  });

  /**
   * The storage sticker, and the contract that follows from it.
   *
   * `financeRowForProduct` prices per watt — the company default, the target
   * net, the partner's $/W ceiling. On a deal with no array every one of those
   * multiplies by zero, so a storage deal is priced here instead, through the
   * same ladder over batteries.
   */
  const isStorage = design?.systemType === "storage";
  const storageSticker = isStorage ? (f.stickerPricePerBatteryCents ?? 0) : 0;
  const storagePrice =
    isStorage && (f.product === "cash" || f.product === "loan") && storageSticker > 0
      ? priceStorageStored({
          product: f.product,
          batteryQty: design?.batteryQty ?? 0,
          stickerPricePerBatteryCents: storageSticker,
          dealerFeePct: f.product === "cash" ? 0 : (rowData.dealerFeePct ?? 0),
          adderTotalCents: adders.adderTotalCents,
          onTopAdderTotalCents: adders.onTopAdderTotalCents,
          rebateTotalCents: await dealRebateTotalCents(user.companyId, f.leadId),
          maxFinalPricePerBatteryCents: lenderBand?.maxFinalPricePerBatteryCents ?? null,
          finalBatteryPriceMode: lenderBand?.finalBatteryPriceMode ?? "cap",
        })
      : null;

  const data = {
    ...rowData,
    // Zeroed on a PV deal rather than left stale: a deal switched from storage
    // back to solar must not keep a price per battery nothing reads.
    stickerPricePerBatteryCents: isStorage ? storageSticker : 0,
    // The $/W sticker is meaningless on storage and would be read as one.
    ...(isStorage ? { grossPpwCents: 0 } : {}),
    ...(storagePrice ? { contractPriceCents: storagePrice.breakdown.contractPriceCents } : {}),
  };

  const saved = await prisma.solarFinance.upsert({
    where: { leadId: f.leadId },
    create: { companyId: user.companyId, leadId: f.leadId, ...data },
    update: data,
    select: {
      product: true, grossPpwCents: true, stickerPricePerBatteryCents: true,
      dealerFeePct: true, adderTotalCents: true,
      onTopAdderTotalCents: true,
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
  // Adders only: HOW the price is worked out. Six ways, because "$2,700",
  // "$2,700 each", "$10 a foot" and "$2,700 off" are four different prices
  // that a single amount column cannot tell apart.
  adderBasis: z
    .enum(["flat", "perUnit", "perFoot", "perWatt", "custom", "discount"])
    .nullable()
    .optional(),
  // The sentence a rep and a homeowner both read. What the work actually IS,
  // not a second copy of its name.
  description: z.string().trim().max(500).nullable().optional(),
  // The system-size band, kW DC, in which this lands on a deal by itself.
  // Capped at 1 MW: anything past that is not a residential design, it is a
  // decimal point in the wrong place disabling the rule.
  autoApplyMinKw: z.number().min(0).max(1000).nullable().optional(),
  autoApplyMaxKw: z.number().min(0).max(1000).nullable().optional(),
  // Adders only: this work is added to the loan ON TOP of a partner's fixed or
  // maximum $/W, at its own price, rather than coming out of the system price.
  financedOnTop: z.boolean().optional(),
  rank: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  // The AVL turns over annually. Bounded to a sane window so a typo cannot file
  // a product under the year 202 or 20260.
  avlYear: z.number().int().min(2000).max(2100).nullable().optional(),
  // The manufacturer's own datasheet, rendered on the customer's proposal.
  // http(s) only, and validated as a URL: a homeowner clicking "View details"
  // has to land on a document, and a `javascript:` string in a field that ends
  // up in an anchor on a public page is not a link, it is a script.
  specSheetUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((v) => /^https?:\/\//i.test(v), "Use a http:// or https:// link.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
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
  // Everything below is about adders and would be meaningless on a panel, so it
  // is refused rather than stored where nothing will ever read it again.
  if (d.kind !== "adder") {
    if (d.adderBasis) return fail("Only an adder has a pricing type.");
    if (d.autoApplyMinKw != null || d.autoApplyMaxKw != null) {
      return fail("Only an adder can be applied automatically by system size.");
    }
    if (d.financedOnTop) return fail("Only an adder can be financed on top of a fixed price.");
  }
  // A credit that rides ON TOP of a partner's price is money coming off a
  // number the partner did not fund — a rule with no arithmetic behind it.
  if (d.financedOnTop && d.adderBasis === "discount") {
    return fail("A discount cannot be financed on top of a fixed price.");
  }
  // A band that ends before it starts fires on nothing, which is a rule that
  // looks configured and does nothing — the worst of the three outcomes.
  if (d.autoApplyMinKw != null && d.autoApplyMaxKw != null && d.autoApplyMinKw >= d.autoApplyMaxKw) {
    return fail("The smallest system size has to be below the largest.");
  }
  // A per-watt adder's money lives in `priceMillsPerWatt`; every other basis
  // reads `priceCents`. Saving one with the wrong column filled is an adder
  // that prices at zero on every deal it lands on, silently.
  if (d.kind === "adder" && d.adderBasis) {
    if (d.adderBasis === "perWatt" && !d.priceMillsPerWatt) {
      return fail("A per-watt adder needs a rate per watt.");
    }
    if (d.adderBasis !== "perWatt" && d.priceMillsPerWatt) {
      return fail("Only a per-watt adder carries a rate per watt.");
    }
    if (d.adderBasis !== "perWatt" && d.adderBasis !== "custom" && !d.priceCents) {
      return fail("Give the adder a price.");
    }
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

  // The id comes back so the catalogue can OPEN what was just added — adding an
  // item is the first step of filling one in, not an end in itself.
  const savedId = await prisma.$transaction(async (tx) => {
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
      return id;
    }
    const row = await tx.solarEquipment.create({
      data: { companyId: user.companyId, ...d },
      select: { id: true },
    });
    return row.id;
  });

  revalidatePath("/portal/settings/solar-equipment");
  return { ok: true as const, id: savedId };
}

/**
 * Put the adders in the order the company wants them sold.
 *
 * The whole list, as ids, rather than "move this one up": rank is a number
 * per row and nudging one of them means rewriting its neighbour too, which two
 * people reordering at once do differently and both think they won. Sending the
 * order makes the last save the whole truth.
 *
 * Ranks are rewritten from zero rather than preserved, so a list that has been
 * edited for a year does not end up with four items all ranked 0 and an order
 * that depends on the alphabetical tie-break underneath it.
 */
export async function reorderSolarAddersAction(orderedIds: string[]) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = z.array(z.string().min(1)).max(500).safeParse(orderedIds);
  if (!parsed.success) return fail("That order could not be read.");
  const ids = [...new Set(parsed.data)];

  // Ours, and adders. An id from another company would silently renumber a row
  // this user is not allowed to see.
  const mine = await prisma.solarEquipment.findMany({
    where: { id: { in: ids }, companyId: user.companyId, kind: "adder" },
    select: { id: true },
  });
  if (mine.length !== ids.length) return fail("One of those adders is not in the catalogue.");

  await prisma.$transaction(
    ids.map((id, i) => prisma.solarEquipment.update({ where: { id }, data: { rank: i } }))
  );
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
  /**
   * The most this partner's paper ever puts in front of a homeowner per watt,
   * cents, dealer fee and adders included. Null clears the ceiling.
   *
   * Bounded by the same $0.50–$20.00/W band the deal-side price box uses, and
   * for the same reason: every value outside it is a typo, and a typo here is
   * not a rejected form but a whole lender's pricing quietly rewritten. A cap
   * of 55 (someone meaning $5.50 and typing cents) would quote every deal on
   * that partner at 55 cents a watt.
   */
  maxFinalPpwCents: z.number().int().min(50).max(2000).nullable().optional(),
  /**
   * Whether the figure above is a ceiling or this partner's flat price.
   *
   * Accepted always and simply stored: it is meaningless without a figure to
   * apply, and the pricing code already ignores it in that case, so refusing
   * one here would only make a lender impossible to pre-configure before its
   * rate is known.
   */
  finalPpwMode: z.enum(["cap", "flat"]).optional(),
  /**
   * The least this partner's deals may leave the company per watt, cents,
   * BEFORE its cut. Null clears the floor.
   *
   * Same band as the ceiling above, and not cross-validated against it: they
   * govern different numbers — one what the customer signs, one what the
   * company keeps — and a floor of $1.75 under a cap of $5.50 is the ordinary
   * arrangement, not a contradiction to reject.
   */
  minBasePpwCents: z.number().int().min(50).max(2000).nullable().optional(),
  /**
   * The same ceiling and floor over BATTERIES, for a deal with no watts.
   *
   * A separate range, not a shared one: $500-$100,000 a battery against
   * $0.50-$20.00 a watt. One rule covering both would validate nothing.
   */
  maxFinalPricePerBatteryCents: z.number().int().min(500_00).max(100_000_00).nullable().optional(),
  minBasePricePerBatteryCents: z.number().int().min(500_00).max(100_000_00).nullable().optional(),
  finalBatteryPriceMode: z.enum(["cap", "flat"]).optional(),
  /**
   * Whether this partner funds an array with no storage — see
   * SolarLenderBatteryRule. `required` BLOCKS generation on a batteryless
   * design; `warn` flags it and lets it through, which is what every lender did
   * before this existed; `optional` says nothing at all.
   */
  batteryRule: z.enum(["optional", "warn", "required"]).optional(),

  // ── The programme contribution ──────────────────────────────────────────
  // The only setting in this file that makes the contract value and the
  // customer's obligation two different numbers. See SolarLender's own note.

  /** Whether this partner's paper carries a contribution at all. */
  contractAdjustmentEnabled: z.boolean().optional(),
  /** How it is worked out. One member today — see SolarContractAdjustmentType. */
  contractAdjustmentType: z.enum(["fixed"]).optional(),
  /**
   * The fixed figure, cents. $1 to $5,000,000, and bounded for exactly the
   * reason the $/W cap is: every value outside that band is a typo, and a typo
   * here does not fail a form, it silently writes a contract value. Somebody
   * meaning $70,000 and typing it in dollars-as-cents would put $700 on the
   * paper; somebody slipping a zero would put $700,000.
   */
  contractAdjustmentCents: z.number().int().min(100).max(5_000_000_00).nullable().optional(),
  /**
   * What the customer's document calls it. NOT defaulted anywhere — see the
   * column's note. Length-capped because it is printed on a table row.
   */
  contractAdjustmentLabel: z.string().trim().max(120).nullable().optional(),
  /** The reconciliation paragraph, as a template. See `renderDisclosure`. */
  contractAdjustmentDisclosure: z.string().trim().max(4000).nullable().optional(),
  /**
   * When the programme starts applying. Blank clears it, meaning "already
   * running".
   *
   * Wrapped the same way `urlField` is, and for the same reason: an
   * `.optional().transform()` chain is a ZodEffects, and an effects-typed key
   * is REQUIRED on the object even when its value may be undefined — which
   * would force every caller that does not touch dates to send one.
   */
  contractAdjustmentEffectiveAt: z.optional(
    z
      .string()
      .trim()
      .max(40)
      .nullable()
      .transform((v) => (v ? new Date(v) : null))
      .refine(
        (d) => d === null || !Number.isNaN(d.getTime()),
        "The effective date is not a date."
      )
  ),
  /** What the household ends up owning, in this partner's own words. */
  ownershipDisclosure: z.string().trim().max(4000).nullable().optional(),
});

/**
 * The fields whose change is worth a line in the audit trail, and how each one
 * reads in it.
 *
 * ONLY the money and the wording. A rename, a rank or a notes edit is ordinary
 * housekeeping; these six decide what a contract says a household owes, and
 * "who changed the adjustment, from what, to what, and when" is the question
 * somebody will be asked to answer about them.
 */
const AUDITED_LENDER_FIELDS = [
  ["contractAdjustmentEnabled", "adjustment enabled"],
  ["contractAdjustmentType", "adjustment type"],
  ["contractAdjustmentCents", "adjustment amount"],
  ["contractAdjustmentLabel", "customer-facing label"],
  ["contractAdjustmentDisclosure", "customer disclosure"],
  ["contractAdjustmentEffectiveAt", "effective date"],
  ["ownershipDisclosure", "ownership wording"],
] as const;

type AuditedField = (typeof AUDITED_LENDER_FIELDS)[number][0];

/** How one previous-or-new value reads on an audit line. */
function auditValue(field: AuditedField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "not set";
  if (field === "contractAdjustmentCents" && typeof value === "number") {
    return (value / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "yes" : "no";
  const s = String(value);
  // The disclosure runs to four thousand characters; an audit line is read at a
  // glance, so it records THAT the wording moved and keeps enough to recognise
  // which wording it was.
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/**
 * Add or rename a lender.
 *
 * Names are unique per company, case-insensitively. Two "Credit Human" rows
 * would split one approved-vendor list across two lenders, and equipment tagged
 * against the wrong one would silently disappear from the selectors — which
 * looks exactly like equipment that was never approved.
 */
export async function upsertSolarLenderAction(
  id: string | null,
  /**
   * `z.input`, not `z.infer`. The effective date arrives as the string a date
   * input produces and is TRANSFORMED into a Date by the schema, so the output
   * type is not the shape a caller can send — typing the parameter as the
   * output would oblige the browser to construct a Date and post it across a
   * server-action boundary that does not carry one.
   */
  input: z.input<typeof lenderSchema>
) {
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

  /**
   * A contribution cannot be switched on half-configured.
   *
   * Refused HERE as well as at the readiness gate, and the two are not the same
   * check doing the same job. Readiness stops a broken programme reaching a
   * customer's document; this stops it being SAVED, so an admin finds out while
   * they are still looking at the form rather than a rep does, on a deal, a
   * fortnight later. Both are needed: a lender saved complete can be made
   * incomplete by nothing this action sees — a partial update from elsewhere,
   * a restored row — and the deal-side gate is what catches that.
   */
  if (d.contractAdjustmentEnabled) {
    const amount =
      d.contractAdjustmentCents ??
      (id
        ? (
            await prisma.solarLender.findFirst({
              where: { companyId: user.companyId, id },
              select: { contractAdjustmentCents: true },
            })
          )?.contractAdjustmentCents ?? null
        : null);
    if (amount == null || amount <= 0) {
      return fail("Set the adjustment amount before switching the contract adjustment on.");
    }
    if (!d.contractAdjustmentLabel?.trim()) {
      return fail(
        "A contract adjustment needs a customer-facing label — the approved term for it, exactly as the customer's proposal should read."
      );
    }
    if (!d.contractAdjustmentDisclosure?.trim()) {
      return fail(
        "A contract adjustment needs a customer disclosure explaining who is responsible for which amount."
      );
    }
  }

  /**
   * The row this call ended up writing. Returned so the caller can OPEN what it
   * just created — adding a partner is the first step of setting one up, and a
   * screen that leaves you on whoever was already selected makes you go and
   * find it.
   */
  let savedId = id;

  if (id) {
    /**
     * The row as it stands, for the audit line. Read inside the same request
     * that writes over it — the alternative is an audit trail that records what
     * somebody's browser last saw, which is not the same thing as what was
     * there.
     */
    const existing = await prisma.solarLender.findFirst({
      where: { companyId: user.companyId, id },
      select: {
        id: true,
        name: true,
        contractAdjustmentEnabled: true,
        contractAdjustmentType: true,
        contractAdjustmentCents: true,
        contractAdjustmentLabel: true,
        contractAdjustmentDisclosure: true,
        contractAdjustmentEffectiveAt: true,
        ownershipDisclosure: true,
      },
    });
    if (!existing) return fail("Not found.");
    await prisma.solarLender.update({ where: { id }, data: d });
    await logLenderAdjustmentChanges(user, { id, name: d.name }, existing, d);
    savedId = id;
  } else {
    const created = await prisma.solarLender.create({
      data: { companyId: user.companyId, ...d },
      select: { id: true },
    });
    // A lender created with a contribution already on it is a change from
    // nothing, and is recorded as one. Skipped entirely for the ordinary case,
    // so adding a lender does not write an audit row saying nothing happened.
    if (d.contractAdjustmentEnabled) {
      await logLenderAdjustmentChanges(user, { id: created.id, name: d.name }, null, d);
    }
    savedId = created.id;
  }
  revalidatePath("/portal/settings/solar-equipment");
  revalidatePath("/portal/settings/solar-lenders");
  return { ...ok(), id: savedId as string };
}

/**
 * Who changed a lender's contribution, from what, to what, and when.
 *
 * ONE ActivityLog row per save, listing every audited field that actually
 * moved — not one row per field, which would bury a single edit under seven
 * lines, and not one row per save regardless, which would fill the log with
 * "nothing changed".
 *
 * Company-scoped with NO lead: this is a settings change and belongs to no
 * deal. Which proposal it was applied to is answered from the other end — every
 * generated version records the figure it was built with on its own event, and
 * carries the frozen reconciliation in its snapshot.
 */
async function logLenderAdjustmentChanges(
  user: { companyId: string; userId: string; fullName: string },
  lender: { id: string; name: string },
  before: Partial<Record<AuditedField, unknown>> | null,
  after: Partial<Record<AuditedField, unknown>>
): Promise<void> {
  const changes = AUDITED_LENDER_FIELDS.flatMap(([field, label]) => {
    // A key the form did not send is a field nobody touched, which is different
    // from one set to null. `undefined` therefore means "unchanged" and is
    // skipped rather than recorded as a clearing.
    if (!(field in after) || after[field] === undefined) return [];
    const from = before ? before[field] : null;
    const to = after[field];
    const same =
      from instanceof Date && to instanceof Date
        ? from.getTime() === to.getTime()
        : (from ?? null) === (to ?? null);
    if (same) return [];
    return [
      {
        field,
        label,
        from: auditValue(field, from),
        to: auditValue(field, to),
      },
    ];
  });
  if (changes.length === 0) return;

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      vertical: "solar",
      message:
        `${user.fullName} changed ${lender.name}'s contract adjustment — ` +
        changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("; "),
      actorId: user.userId,
      metadata: { lenderId: lender.id, lenderName: lender.name, changes },
    },
  });
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

/**
 * Set which adders THIS lender funds on top of its own $/W, and which come out
 * of it.
 *
 * The whole set at once, the same way an approved-vendor list is written: the
 * screen sends the checkboxes as they now stand and the table is made to match.
 * A diff would have to describe three states — ticked, unticked, and never
 * asked about — over a wire, and getting that wrong silently moves money.
 *
 * BOTH ANSWERS ARE STORED. A row saying `false` is not the same as no row: no
 * row means "no opinion, use the catalogue", and `false` means "this partner
 * keeps it inside the price even though the catalogue puts it on top". The
 * second is the exact case a second flat-rate partner creates, and a table of
 * only the ticked ones cannot say it.
 *
 * Deals already quoted are NOT re-priced. `SolarDealAdder.financedOnTop` is
 * copied at pick time so that a Settings change can never move a number a
 * homeowner has already been shown; the new rules apply to lines added from
 * here on, and to every line on a deal whose lender is set again.
 */
export async function setLenderAdderRulesAction(
  lenderId: string,
  rules: { equipmentId: string; financedOnTop: boolean }[]
) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const lender = await prisma.solarLender.findFirst({
    where: { companyId: user.companyId, id: lenderId },
    select: { id: true },
  });
  if (!lender) return fail("Not found.");

  // Adders only, and only this company's. A module id here would attach a
  // pricing rule to something that can never be an adder line, and an id from
  // another tenant would attach one to somebody else's catalogue.
  const ids = [...new Set(rules.map((r) => r.equipmentId))];
  const valid = new Set(
    (
      await prisma.solarEquipment.findMany({
        where: { companyId: user.companyId, id: { in: ids }, kind: "adder" },
        select: { id: true },
      })
    ).map((e) => e.id)
  );

  const data = rules
    .filter((r) => valid.has(r.equipmentId))
    .map((r) => ({ lenderId, equipmentId: r.equipmentId, financedOnTop: r.financedOnTop }));

  await prisma.$transaction([
    prisma.solarLenderAdderRule.deleteMany({ where: { lenderId } }),
    ...(data.length
      ? [prisma.solarLenderAdderRule.createMany({ data, skipDuplicates: true })]
      : []),
  ]);
  revalidatePath("/portal/settings/solar-lenders");
  return { ok: true as const, count: data.filter((d) => d.financedOnTop).length };
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


// ---------------------------------------------------------------------------
// What the deal is selling
// ---------------------------------------------------------------------------

const systemTypeSchema = z.object({
  leadId: z.string().min(1),
  systemType: z.enum(["pv", "pv_storage", "storage"]),
});

/**
 * Set what this deal sells.
 *
 * SWITCHING TO STORAGE CLEARS THE ARRAY. A rep who designed 10 kW and then
 * learned the customer only wants the battery leaves a production figure, an
 * offset and a drawn layout on the row — and nothing downstream knows not to
 * trust them. `proposal-generate` copies what it finds, so a storage document
 * would quietly inherit the kilowatt-hours of an array nobody is installing.
 * This is the one place that can be sure, so it clears them here.
 *
 * Switching AWAY from storage clears nothing. The roof was never drawn, so
 * there is nothing stale to remove, and the battery stays because a
 * solar-plus-storage deal wants it.
 */
export async function setSolarSystemTypeAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = systemTypeSchema.safeParse(input);
  if (!parsed.success) return fail("Pick solar, solar + storage, or storage only.");
  const { leadId, systemType } = parsed.data;

  const design = await prisma.solarDesign.findFirst({
    where: { leadId, companyId: user.companyId },
    select: { id: true, systemType: true },
  });
  if (!design) return fail("This deal has no design yet.");
  if (design.systemType === systemType) return ok();

  await prisma.solarDesign.update({
    where: { id: design.id },
    data: {
      systemType,
      ...(systemType === "storage"
        ? {
            systemSizeKwDc: 0,
            systemSizeKwAc: 0,
            year1ProductionKwh: 0,
            offsetPct: 0,
            moduleQty: 0,
            layoutBlocks: [],
            layoutSetbacks: [],
            roofPlanes: [],
            yieldSource: null,
            yieldStation: null,
            yieldArrays: 0,
          }
        : {}),
    },
  });

  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}`);
  return ok();
}
