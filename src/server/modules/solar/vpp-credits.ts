import { prisma } from "@/server/db/client";
import type { FinanceProduct } from "@prisma/client";
import { solarEquipmentLabel } from "@/lib/solar-equipment-label";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { vppEligibility, type VppDealFacts } from "@/lib/solar-provider-terms";
import type { VppCredit } from "@/lib/solar-proposal";

/**
 * What this deal's battery actually earns, resolved against the provider list.
 *
 * A VPP is not offered to everyone who buys a battery — see the programme's
 * three condition lists on `solar_providers` — so the money only reaches a
 * customer's savings model when THIS design's hardware and THIS deal's
 * financing clear them. The eligibility rule itself lives in
 * `@/lib/solar-provider-terms` and is the same one the rep reads on the Energy
 * step: a homeowner must never be quoted a credit the rep was told they do not
 * qualify for.
 *
 * PER BATTERY. The office records what one battery earns, the design says how
 * many there are, and the multiplication happens here — once, at the boundary —
 * so no renderer downstream has to know the rule.
 *
 * Zero batteries is the ordinary case and returns nothing: a programme pays for
 * hardware, and a design without any earns nothing however open the programme.
 */
export async function resolveVppCredits(args: {
  companyId: string;
  /** The two providers a design can name. Either may be null.  */
  utilityProvider: string | null;
  electricProvider: string | null;
  batteryId: string | null;
  batteryQty: number;
  batteryLabel: string | null;
  financeProduct: FinanceProduct | null;
  financeProductId: string | null;
}): Promise<VppCredit[]> {
  /**
   * A battery chosen with no quantity typed is ONE battery.
   *
   * The same rule the snapshot's equipment card already uses — it prints
   * "1 total" for exactly this row — and it has to be the same rule, or a deal
   * would show one battery on its equipment card and earn for none. The
   * quantity box is optional on the designer and most reps never open it.
   */
  const qty = args.batteryId ? Math.max(1, args.batteryQty) : 0;
  if (qty === 0 || !args.batteryId) return [];

  const names = [args.utilityProvider, args.electricProvider]
    .map((n) => n?.trim())
    .filter((n): n is string => !!n);
  if (names.length === 0) return [];

  const providers = await prisma.solarProvider.findMany({
    where: { companyId: args.companyId, vpp: true, name: { in: names } },
    select: {
      name: true,
      buyback: true, buybackRateMills: true,
      touPeakRateMills: true, touOffPeakRateMills: true, touPeakWindow: true,
      vpp: true, vppProgramme: true, vppUpfrontCents: true, vppAnnualCents: true,
      vppFinanceProducts: true,
      notes: true,
      vppEquipment: {
        select: {
          equipment: { select: { id: true, manufacturer: true, model: true, ratingW: true } },
        },
      },
      vppProducts: {
        select: {
          product: {
            select: {
              id: true, name: true, product: true, aprPct: true, termMonths: true,
              dealerFeePct: true, leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true,
              escalatorPct: true, termYears: true,
              lender: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (providers.length === 0) return [];

  /**
   * The product LABEL is resolved for the verdict's sake only. Nothing here
   * reaches the customer; it is the reason string a rep would have read.
   */
  const quoted = args.financeProductId
    ? await prisma.solarLenderProduct.findFirst({
        where: { id: args.financeProductId, companyId: args.companyId },
        select: {
          name: true, product: true, aprPct: true, termMonths: true, dealerFeePct: true,
          leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true, escalatorPct: true,
          termYears: true, lender: { select: { name: true } },
        },
      })
    : null;

  const deal: VppDealFacts = {
    batteryId: args.batteryId,
    batteryLabel: args.batteryLabel,
    financeProduct: args.financeProduct,
    financeProductId: args.financeProductId,
    financeProductLabel: quoted
      ? `${quoted.lender.name} ${lenderProductLabel(quoted)}`
      : null,
  };

  const credits: VppCredit[] = [];
  for (const p of providers) {
    const terms = {
      ...p,
      vppBatteries: p.vppEquipment.map((e) => ({
        id: e.equipment.id,
        label: solarEquipmentLabel(e.equipment),
      })),
      vppProducts: p.vppProducts.map((x) => ({
        id: x.product.id,
        label: `${x.product.lender.name} ${lenderProductLabel(x.product)}`,
      })),
    };

    /**
     * `unrestricted` counts and `unknown` does not.
     *
     * A programme with no conditions recorded is open — that is what an empty
     * list means everywhere else in this feature. But a programme WITH a
     * condition whose answer is still missing has not been cleared, and pricing
     * a maybe into a homeowner's twenty-five-year model is the thing this whole
     * eligibility layer exists to prevent.
     */
    const verdict = vppEligibility(terms, deal);
    if (verdict.state !== "eligible" && verdict.state !== "unrestricted") continue;

    const annualCents = (p.vppAnnualCents ?? 0) * qty;
    const upfrontCents = (p.vppUpfrontCents ?? 0) * qty;
    if (annualCents <= 0 && upfrontCents <= 0) continue;

    credits.push({
      programme: p.vppProgramme?.trim() || "Battery programme",
      provider: p.name,
      annualCents,
      upfrontCents,
      batteryQty: qty,
    });
  }

  return credits;
}
