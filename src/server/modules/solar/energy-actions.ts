"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { annualFromMonthlyKwh, annualUsageFromBill } from "@/lib/solar-energy";
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
  basis: z.enum(["usage", "bill"]),
  avgMonthlyBillCents: z.number().int().min(0).max(1_000_000).nullable(),
  // usage basis: either of these, whichever the rep had to hand
  annualUsageKwh: z.number().int().min(0).max(1_000_000).nullable(),
  avgMonthlyUsageKwh: z.number().min(0).max(100_000).nullable(),
  // bill basis
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

  const annualUsageKwh =
    d.basis === "bill"
      ? annualUsageFromBill(d.avgMonthlyBillCents, d.utilityRateMills)
      : (d.annualUsageKwh || annualFromMonthlyKwh(d.avgMonthlyUsageKwh));

  // Offset depends on usage, so changing usage has to recompute it. Production
  // does NOT change here — that follows the module count, which only the layout
  // sets. Without this, editing usage leaves a stale offset on the deal.
  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { year1ProductionKwh: true },
  });
  const computedOffset =
    annualUsageKwh && existing?.year1ProductionKwh
      ? offsetPct(existing.year1ProductionKwh, annualUsageKwh)
      : 0;

  const data = {
    utilityProvider: d.utilityProvider,
    electricProvider: d.electricProvider,
    usageBasis: d.basis,
    avgMonthlyBillCents: d.avgMonthlyBillCents,
    annualUsageKwh,
    // Only the bill basis has a rate the rep was told. In usage basis the rate
    // stays DERIVED, so storing one here would quietly make it un-derivable.
    utilityRateMills: d.basis === "bill" ? d.utilityRateMills : null,
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
