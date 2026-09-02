"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import {
  annualFromMonthlyKwh,
  annualUsageFromBill,
  effectiveUsageKwh,
  monthlyBillFromUsage,
} from "@/lib/solar-energy";
import { offsetPct } from "@/lib/solar-money";
import { addressChanged } from "@/server/modules/geo/resolve";
import { leadContactFields } from "@/server/modules/leads/contact-fields";

// `actions.ts` is a "use server" module, so its helpers cannot be shared —
// every export from one has to be an async server function.
const fail = (error: string) => ({ ok: false as const, error });

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

const energySchema = z.object({
  leadId: z.string().min(1),
  utilityProvider: z.string().max(120).nullable(),
  electricProvider: z.string().max(120).nullable(),
  basis: z.enum(["usage", "bill", "rate"]),
  avgMonthlyBillCents: z.number().int().min(0).max(1_000_000).nullable(),
  // usage basis: either of these, whichever the rep had to hand
  annualUsageKwh: z.number().int().min(0).max(1_000_000).nullable(),
  avgMonthlyUsageKwh: z.number().min(0).max(100_000).nullable(),
  // bill and rate bases
  utilityRateMills: z.number().int().min(0).max(2_000).nullable(),
});

/**
 * Save what the customer uses and what they pay for it.
 *
 * The stored `annualUsageKwh` is always the ONE consumption figure, whichever
 * method produced it — everything downstream reads that field and must not have
 * to know how it was arrived at. `usageBasis` records the method purely so the
 * step reopens the way the rep left it.
 *
 * The derivation happens HERE, not in the browser. The form shows the same
 * figure while a rep types, but the number that gets stored is the one the
 * server computed: offset, and every saving figure under it, hangs off this.
 */
export async function saveSolarEnergyAction(input: z.infer<typeof energySchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = energySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid energy details.");
  const d = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: d.leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  /**
   * TWO FIGURES IN, THE THIRD WORKED OUT. Which two depends on the basis:
   *
   *   usage  — kWh and the bill; the rate falls out of bill ÷ usage
   *   bill   — the bill and the rate; the usage falls out of bill ÷ rate
   *   rate   — kWh and the rate; the bill falls out of usage × rate
   *
   * The third basis exists because the first one could only ever DERIVE the
   * rate, and a derived rate is bill ÷ usage — which quietly includes every
   * fixed charge on the bill, the delivery fee and the meter charge and the
   * taxes, spread across the kilowatt-hours as though they were energy. On a
   * $180 bill against 14,000 kWh that reads $0.154/kWh when the customer's
   * actual energy rate is nearer $0.11, and every savings figure on the
   * proposal is built on the wrong one. A rep holding the bill can read the
   * real rate off it; there was nowhere to type it unless they also let the
   * usage be derived, which they usually do not want.
   */
  const annualUsageKwh =
    d.basis === "bill"
      ? annualUsageFromBill(d.avgMonthlyBillCents, d.utilityRateMills)
      : (d.annualUsageKwh || annualFromMonthlyKwh(d.avgMonthlyUsageKwh));

  // Offset depends on usage, so changing usage has to recompute it. Production
  // does NOT change here — that follows the module count, which only the layout
  // sets. Without this, editing usage leaves a stale offset on the deal.
  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { year1ProductionKwh: true, usageAdjustmentKwh: true },
  });
  // Against the bill figure PLUS what this deal's adders will add to it. The
  // EV charger on the quote is part of what the array has to cover, and an
  // offset that ignores it is a coverage promise nobody sized for.
  const usageKwh = effectiveUsageKwh(annualUsageKwh, existing?.usageAdjustmentKwh);
  const computedOffset =
    usageKwh && existing?.year1ProductionKwh
      ? offsetPct(existing.year1ProductionKwh, usageKwh)
      : 0;

  const data = {
    utilityProvider: d.utilityProvider,
    electricProvider: d.electricProvider,
    usageBasis: d.basis,
    // On the rate basis the bill is the DERIVED side, so it is computed here
    // rather than trusted from the browser — the same discipline the usage
    // gets. A bill posted from the form on that basis is ignored.
    avgMonthlyBillCents:
      d.basis === "rate"
        ? monthlyBillFromUsage(annualUsageKwh, d.utilityRateMills)
        : d.avgMonthlyBillCents,
    annualUsageKwh,
    // The two bases where the rep was TOLD a rate keep it; the usage basis
    // leaves it null so it stays derived from bill ÷ usage. Storing one there
    // would quietly make it un-derivable.
    utilityRateMills: d.basis === "usage" ? null : d.utilityRateMills,
    offsetPct: computedOffset,
  };

  await prisma.solarDesign.upsert({
    where: { leadId: d.leadId },
    create: { companyId: user.companyId, leadId: d.leadId, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const, annualUsageKwh };
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

const customerSchema = z.object({ leadId: z.string().min(1), ...leadContactFields });

/**
 * Save the customer's own details from the proposal builder.
 *
 * Deliberately narrow: it writes the contact fields and NOTHING else. Posting
 * the full lead shape back from here would let a proposal screen quietly
 * reassign a rep or move a deal's stage as a side effect of fixing a phone
 * number.
 */
export async function saveCustomerDetailsAction(input: z.infer<typeof customerSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid customer details.");
  const d = parsed.data;

  const existing = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: d.leadId },
    select: { id: true, address: true, city: true, state: true, zip: true },
  });
  if (!existing) return fail("Deal not found.");

  // Coordinates are a CACHE of the address, so correcting the address has to
  // invalidate them — the same rule updateLeadAction follows, which is why the
  // comparison is shared code rather than a second opinion about it. The
  // satellite route re-geocodes whenever lat is null.
  const moved = addressChanged(existing, {
    address: d.address || null,
    city: d.city || null,
    state: d.state || null,
    zip: d.zip || null,
  });

  await prisma.lead.update({
    where: { id: d.leadId },
    data: {
      firstName: d.firstName,
      lastName: d.lastName,
      coOwnerName: d.coOwnerName || null,
      coOwnerEmail: d.coOwnerEmail || null,
      coOwnerPhone: d.coOwnerPhone || null,
      preferredLanguage: d.preferredLanguage || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      ...(moved ? { lat: null, lng: null, geocodedAt: null } : {}),
    },
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const, addressMoved: moved };
}

// ---------------------------------------------------------------------------
// Time-of-use, for THIS deal
// ---------------------------------------------------------------------------

const touSchema = z.object({
  leadId: z.string().min(1),
  /** Both, or both null. Mills per kWh. */
  touPeakRateMills: z.number().int().min(0).max(2_000).nullable(),
  touOffPeakRateMills: z.number().int().min(0).max(2_000).nullable(),
});

/**
 * Override this deal's peak / off-peak rates.
 *
 * NULL means "read the provider's", which is where they normally come from —
 * this exists for the household on a plan that does not match the published
 * one. Storing a copy of the provider's rates instead would freeze them: a
 * provider that repriced would leave every deal quoting last year's spread.
 *
 * Both or neither, and peak above off-peak. Savings ARE the spread, so one rate
 * alone computes nothing and `touSavings` returns null — the proposal would
 * drop the line with no screen saying why. Rejected here while somebody is
 * still looking at the box they left empty.
 */
export async function saveSolarTouOverrideAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = touSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid rates." };
  const { leadId, touPeakRateMills, touOffPeakRateMills } = parsed.data;

  if ((touPeakRateMills == null) !== (touOffPeakRateMills == null)) {
    return { ok: false as const, error: "Enter both the peak and the off-peak rate, or neither." };
  }
  if (
    touPeakRateMills != null &&
    touOffPeakRateMills != null &&
    touPeakRateMills <= touOffPeakRateMills
  ) {
    return { ok: false as const, error: "The peak rate has to be above the off-peak rate." };
  }

  const design = await prisma.solarDesign.findFirst({
    where: { leadId, companyId: user.companyId },
    select: { id: true },
  });
  if (!design) return { ok: false as const, error: "This deal has no design yet." };

  await prisma.solarDesign.update({
    where: { id: design.id },
    data: { touPeakRateMills, touOffPeakRateMills },
  });
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const };
}
