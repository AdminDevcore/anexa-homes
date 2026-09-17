import type { SolarEquipmentKind } from "@prisma/client";
import type { AdderBasis } from "@/lib/solar-adders";

/** One piece of hardware on the catalogue. */
export type Item = {
  id: string;
  kind: SolarEquipmentKind;
  manufacturer: string | null;
  model: string;
  ratingW: number | null;
  widthMm: number | null;
  heightMm: number | null;
  costCents: number;
  priceCents: number;
  isActive: boolean;
  isDefault: boolean;
  avlYear: number | null;
  specSheetUrl: string | null;
  lenderIds: string[];
  /** The serving route with a cache-buster, or null when none is set. */
  photoUrl: string | null;
};

/**
 * One adder.
 *
 * Not a piece of equipment with a price: a priced RULE — how the money is
 * worked out, the words a homeowner reads, and the system size that puts it on
 * a deal by itself.
 */
export type AdderItem = {
  id: string;
  label: string;
  description: string | null;
  basis: AdderBasis;
  priceCents: number;
  priceMillsPerWatt: number | null;
  costCents: number;
  autoApplyMinKw: number | null;
  autoApplyMaxKw: number | null;
  /**
   * This work is added to the loan ON TOP of a partner's fixed or maximum $/W,
   * instead of coming out of the system price, the dealer fee still applied. The re-roof.
   */
  outsidePriceRule: boolean;
  rank: number;
  isActive: boolean;
};

export type Lender = {
  id: string;
  name: string;
  isActive: boolean;
  rank: number;
  notes: string | null;
};

export const KINDS: { value: SolarEquipmentKind; label: string; one: string; ratingLabel: string }[] = [
  { value: "module", label: "Modules", one: "module", ratingLabel: "W per panel" },
  { value: "inverter", label: "Inverters", one: "inverter", ratingLabel: "Rated W" },
  { value: "battery", label: "Batteries", one: "battery", ratingLabel: "Usable Wh" },
];

export const money = (c: number) =>
  (c / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** What the rate sheet says an adder costs: "$2,700", "$10.00/ft", "−$500". */
export function catalogueRateLabel(item: {
  basis: AdderBasis;
  priceCents: number;
  priceMillsPerWatt: number | null;
}): string {
  if (item.basis === "perWatt") {
    const dollars = (item.priceMillsPerWatt ?? 0) / 1000;
    return `$${dollars.toFixed(3).replace(/0$/, "")}/W`;
  }
  const amount = `$${(item.priceCents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
  if (item.basis === "perFoot") return `${amount}/ft`;
  if (item.basis === "perUnit") return `${amount} each`;
  if (item.basis === "discount") return `−${amount}`;
  return amount;
}

/** "under 5 kW", "5–8 kW", "8 kW and up" — the band, as a person would say it. */
export function bandLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null) return `under ${max} kW`;
  if (max == null) return `${min} kW and up`;
  return `${min}–${max} kW`;
}

/** The name a catalogue item is known by, however much of it is filled in. */
export const itemName = (i: Item) =>
  [i.manufacturer, i.model].filter(Boolean).join(" ") || i.model;
