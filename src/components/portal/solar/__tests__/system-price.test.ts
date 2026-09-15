import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pricePurchase } from "@/lib/solar-money";
import { SystemPriceCard } from "../system-price";

type Props = Parameters<typeof SystemPriceCard>[0];

/**
 * The deal the dealer fee went missing on, 2026-09-14: 12.76 kW on Amos 30 Year
 * Solar, $1.93/W base, two batteries at $36,000, Amos capping the customer at
 * $5.50/W with a $2.00/W floor. The rate sheet had the programme's fee at 0%.
 */
const deal: Props = {
  systemSizeKwDc: 12.76,
  basePpwCents: 193,
  defaultPpwCents: 250,
  adderTotalCents: 0,
  batteryPriceCents: 7_200_000,
  batteryLabel: "Battery",
  batteryQty: 2,
  quotedFeePct: 0,
  quotedMaxFinalPpwCents: 550,
  quotedFinalPpwMode: "cap",
  quotedMinBasePpwCents: 200,
  quotedLabel: "Amos Capital Fund · Amos 30 Year Solar",
  canEdit: false,
  onChange: () => {},
};

function card(overrides: Partial<Props>) {
  const html = renderToStaticMarkup(createElement(SystemPriceCard, { ...deal, ...overrides }));
  /** The figure in a test id, as a number of dollars. Null when the rung is absent. */
  const read = (id: string) => {
    const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`));
    return m ? Number(m[1].replace(/[^0-9.]/g, "")) : null;
  };
  /** How many times a figure is printed as a whole text node. */
  const printed = (text: string) => html.split(`>${text}<`).length - 1;
  return { html, read, printed };
}

describe("SystemPriceCard — the dealer fee and the final price", () => {
  it("prints both on a 0% programme, instead of stopping at the gross", () => {
    const { html, read } = card({});

    expect(html).toContain("Dealer fee · 0%");
    expect(read("gross-total")).toBe(96627);
    expect(read("fee-total")).toBe(0);
    expect(read("final-total")).toBe(96627);
  });

  it("keeps the fee on the ladder when a cap binds, and the column adds up", () => {
    const { html, read, printed } = card({ quotedFeePct: 65 });

    // $5.50/W × 12,760 W = $70,180 sticker, of which Amos keeps 65% ($45,617)
    // and the company keeps $24,563 — plus the $72,000 of storage on both sides.
    expect(html).toContain("Dealer fee · 65%");
    expect(read("gross-total")).toBe(96563);
    expect(read("fee-total")).toBe(45617);
    expect(read("final-total")).toBe(142180);
    expect(read("gross-total")! + read("fee-total")!).toBe(read("final-total"));

    // The same money the pricing engine charges at the capped sticker.
    const priced = pricePurchase({
      product: "loan",
      systemSizeKwDc: 12.76,
      stickerPpwCents: 550,
      dealerFeePct: 65,
      adderTotalCents: 0,
      batteryPriceCents: 7_200_000,
    });
    expect(read("fee-total")).toBe(Math.round(priced.dealerFeeCents / 100));
    expect(read("gross-total")).toBe(Math.round(priced.grossPriceCents / 100));

    // The base on the ladder is the one that survived the cap, and says so; the
    // headline gross is that same figure, not one built from the typed base.
    expect(html).toContain("after the $5.50/W cap");
    expect(printed("$96,563")).toBe(2);
    expect(html).not.toContain("$96,627");
  });

  it("does the same under a flat rate that moved a higher typed base", () => {
    const { html, read } = card({
      systemSizeKwDc: 10,
      basePpwCents: 300,
      batteryPriceCents: 0,
      batteryQty: 0,
      quotedFeePct: 65,
      quotedFinalPpwMode: "flat",
    });

    expect(read("gross-total")).toBe(19250);
    expect(read("fee-total")).toBe(35750);
    expect(read("final-total")).toBe(55000);
    expect(html).toContain("after the $5.50/W flat rate");
  });

  it("leaves an uncapped programme on the typed base, with the fee as the difference", () => {
    const { html, read } = card({
      systemSizeKwDc: 10,
      basePpwCents: 300,
      adderTotalCents: 385_000,
      batteryPriceCents: 0,
      batteryQty: 0,
      quotedFeePct: 25,
      quotedMaxFinalPpwCents: null,
      quotedMinBasePpwCents: null,
    });

    expect(read("gross-total")).toBe(33850);
    expect(html).toContain("Dealer fee · 25%");
    expect(read("fee-total")).toBe(11283);
    expect(read("final-total")).toBe(45133);
    expect(html).not.toContain("after the $");
  });

  it("ends at the gross on cash, where no lender takes a cut", () => {
    const { html, read } = card({
      quotedFeePct: null,
      quotedMaxFinalPpwCents: null,
      quotedMinBasePpwCents: null,
      quotedLabel: null,
    });

    expect(read("gross-total")).toBe(96627);
    expect(read("fee-total")).toBeNull();
    expect(read("final-total")).toBeNull();
    expect(html).not.toContain("Dealer fee");
  });
});

describe("SystemPriceCard — a partner that takes its fee on the battery", () => {
  it("puts the battery inside the dealer fee, and says so", () => {
    const { html, read } = card({
      basePpwCents: 200,
      quotedFeePct: 25,
      quotedMaxFinalPpwCents: null,
      quotedMinBasePpwCents: null,
      quotedLabel: "Credit Human · 20 yr",
      quotedBatteryInsideFee: true,
    });

    // Gross $97,520 = $25,520 base + $72,000 of batteries. The fee is 25% of the
    // final price, battery included: the system at $2.67/W and $96,000 of
    // batteries, a quarter of each.
    expect(read("gross-total")).toBe(97520);
    expect(read("fee-total")).toBe(32549);
    expect(read("final-total")).toBe(130069);
    expect(read("gross-total")! + read("fee-total")!).toBe(read("final-total"));
    expect(html).toContain("adders and battery included");
    expect(html).toContain("$96,000 for the Battery × 2: its $72,000 catalogue price");
  });

  it("leaves the battery on top when the partner does not take its fee on it", () => {
    const { html, read } = card({
      basePpwCents: 200,
      quotedFeePct: 25,
      quotedMaxFinalPpwCents: null,
      quotedMinBasePpwCents: null,
      quotedLabel: "Credit Human · 20 yr",
    });

    expect(read("fee-total")).toBe(8549);
    expect(read("final-total")).toBe(106069);
    expect(html).toContain("adders included");
    expect(html).toContain("$72,000 for the Battery × 2, priced from the catalogue and added on top");
  });
});
