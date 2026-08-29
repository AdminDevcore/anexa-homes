/**
 * What a provider does for a solar customer, as one line.
 *
 * Two screens ask this — the settings list, where the office fills it in, and
 * the Energy step, where a rep reads it back the moment they pick a provider —
 * and they have to agree to the word. A rep quoting "they buy back at nine and
 * a half cents" from a summary the settings page wrote differently is the
 * failure this exists to prevent.
 *
 * NOTHING HERE REACHES A HOMEOWNER'S DOCUMENT. This is the office's own record
 * of what it has confirmed with each provider; the proposal's arithmetic does
 * not read it. A buyback rate that priced exported kWh into a 25-year model
 * would be a promise, and this is a note.
 */
import type { FinanceProduct } from "@prisma/client";
import { PRODUCT_LABEL } from "@/lib/solar-lender-product";

/** One thing on a programme's list, as an id and the way it reads. */
export type VppListItem = { id: string; label: string };

/**
 * Who a provider's VPP programme is actually open to.
 *
 * A VPP is not offered to everyone who buys a battery: it runs on SOME ways of
 * paying and SOME hardware, and a rep who reads "$500/yr" without reading the
 * conditions has promised a homeowner money they will not receive.
 *
 * THREE AXES, ALL ANDed, AND EMPTY MEANS "NO RESTRICTION" ON EVERY ONE. An
 * office that has never opened the screen has recorded no conditions, not the
 * absence of any qualifying hardware — reading an empty list as "nothing
 * qualifies" would turn every programme already on the list ineligible on every
 * deal overnight.
 */
export type VppRestrictions = {
  /** Which ways of paying qualify. Empty is any. */
  vppFinanceProducts: FinanceProduct[];
  /** Which batteries the programme enrols. Empty is any. */
  vppBatteries: VppListItem[];
  /** Which named rate-sheet products it accepts. Empty is any. */
  vppProducts: VppListItem[];
};

export type ProviderTerms = {
  buyback: boolean;
  /** Mills per exported kWh. 95 = $0.095/kWh. */
  buybackRateMills: number | null;
  /**
   * The provider's time-of-use rates, mills per kWh, and the window in words.
   *
   * THE ONE THING HERE THAT DOES REACH A HOMEOWNER'S DOCUMENT — the note at the
   * top of this file holds for everything else. A storage proposal's savings
   * figure is the spread between these two, so unlike the buyback rate beside
   * them these are arithmetic, not a record of a phone call.
   *
   * Both or neither. Null means this provider has no TOU plan on file and the
   * savings line is OMITTED rather than derived from the blended rate.
   */
  touPeakRateMills: number | null;
  touOffPeakRateMills: number | null;
  /** "4pm – 8pm". A sentence on a proposal; nothing parses it. */
  touPeakWindow: string | null;
  vpp: boolean;
  vppProgramme: string | null;
  vppUpfrontCents: number | null;
  vppAnnualCents: number | null;
  notes: string | null;
} & VppRestrictions;

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/**
 * The buyback half. Null when nobody has said either way.
 *
 * "Buys back" with no rate is a real and useful answer — plenty of providers
 * buy back at a figure that moves with the market — so the flag prints on its
 * own rather than waiting for a number that may never exist.
 */
export function buybackLine(t: ProviderTerms): string | null {
  if (!t.buyback) return null;
  return t.buybackRateMills && t.buybackRateMills > 0
    ? `Buyback $${(t.buybackRateMills / 1000).toFixed(3)}/kWh`
    : "Buys back exported power";
}

/**
 * The battery-programme half.
 *
 * The programme's own name leads when it has one, because that is what the
 * customer signs up to and what they will see on their own statement — a rep
 * saying "your retailer pays you" when the paperwork says Renew Home has just
 * created a question they cannot answer.
 */
export function vppLine(t: ProviderTerms): string | null {
  if (!t.vpp) return null;
  const money = [
    t.vppUpfrontCents && t.vppUpfrontCents > 0 ? `${usd(t.vppUpfrontCents)} upfront` : null,
    t.vppAnnualCents && t.vppAnnualCents > 0 ? `${usd(t.vppAnnualCents)}/yr` : null,
  ].filter(Boolean);
  const name = t.vppProgramme?.trim();
  const head = name ? `VPP · ${name}` : "Battery programme";
  return money.length > 0 ? `${head} — ${money.join(" + ")}` : head;
}

/**
 * Both halves, for a one-line summary beside a provider's name.
 *
 * Empty means NOTHING IS RECORDED, which the callers render as its own
 * sentence rather than as blank space: on a screen whose whole job is to answer
 * "do they buy back?", silence reads as "no" when it means "nobody checked".
 */
export function providerTermsLine(t: ProviderTerms): string {
  return [buybackLine(t), vppLine(t)].filter(Boolean).join(" · ");
}

/** True when somebody has actually recorded something about this provider. */
export function hasProviderTerms(t: ProviderTerms): boolean {
  return t.buyback || t.vpp || !!t.notes?.trim();
}

// ── Who the programme is open to ───────────────────────────────────────────

/** Has anybody recorded a condition on this programme at all? */
export function hasVppRestrictions(t: VppRestrictions): boolean {
  return (
    t.vppFinanceProducts.length > 0 || t.vppBatteries.length > 0 || t.vppProducts.length > 0
  );
}

/**
 * A list of names, shortened before it stops being readable.
 *
 * A programme's battery list runs to three or four; a product list picked off a
 * full rate sheet can run to thirty, and thirty names printed under a provider
 * card is not a line anybody reads. The count is kept rather than dropped —
 * "+27 more" tells a rep to open the settings screen, where blank space would
 * have told them the list ended at three.
 */
function namesLine(items: VppListItem[], limit = 3): string {
  const shown = items.slice(0, limit).map((i) => i.label);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

/** "cash or loan", "loan", "loan, lease or PPA" — how a rep would say it. */
function financeTypesLine(products: FinanceProduct[]): string {
  const names = products.map((p) => PRODUCT_LABEL[p]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * What the programme requires, as one line — a fact about the PROGRAMME, true
 * before any deal exists, which is why it renders on the settings screen and on
 * a deal that has not been designed yet alike.
 *
 * Null when nothing is recorded, so a caller can tell "open to everyone" from
 * "open to these three batteries" instead of printing an empty requirement.
 */
export function vppRequirementsLine(t: ProviderTerms): string | null {
  if (!t.vpp || !hasVppRestrictions(t)) return null;
  const parts: string[] = [];
  if (t.vppFinanceProducts.length > 0) {
    parts.push(`Needs ${financeTypesLine(t.vppFinanceProducts)}`);
  }
  if (t.vppProducts.length > 0) parts.push(namesLine(t.vppProducts));
  if (t.vppBatteries.length > 0) parts.push(namesLine(t.vppBatteries));
  return parts.join(" · ");
}

/**
 * As much of the deal as the rep has filled in so far.
 *
 * A deal carries exactly ONE battery and ONE finance row — SolarDesign.batteryId
 * and SolarFinance, which is unique per lead — so this is three facts, not two
 * lists. `financeProductId` is null on cash by definition, and on a loan whose
 * terms were typed by hand rather than picked off the rate sheet.
 */
export type VppDealFacts = {
  batteryId: string | null;
  batteryLabel: string | null;
  financeProduct: FinanceProduct | null;
  financeProductId: string | null;
  financeProductLabel: string | null;
};

/**
 * What we can say about this deal and this programme.
 *
 * `unknown` is a real answer and deliberately not folded into `ineligible`. A
 * deal with no battery picked yet has not failed the battery test — nobody has
 * taken it — and telling a rep on step 2 that their customer does not qualify
 * for a programme they have not designed for yet is how a rep learns to ignore
 * the line.
 */
export type VppVerdict =
  | { state: "unrestricted" }
  | { state: "unknown"; reasons: string[] }
  | { state: "eligible" }
  | { state: "ineligible"; reasons: string[] };

/**
 * Whether THIS deal clears the programme's conditions.
 *
 * A DEFINITE FAILURE OUTRANKS A MISSING FACT. A design holding a battery that
 * is not on the list is ineligible whether or not financing has been chosen —
 * waiting for the finance row before saying so would leave the wrong battery on
 * the deal for another two steps.
 *
 * Nothing here blocks anything, and nothing reaches the customer's document.
 * This is the office's own record of what it has confirmed, read back to the
 * rep who is about to quote it.
 */
export function vppEligibility(t: ProviderTerms, deal: VppDealFacts): VppVerdict {
  if (!t.vpp || !hasVppRestrictions(t)) return { state: "unrestricted" };

  const fails: string[] = [];
  const missing: string[] = [];

  if (t.vppBatteries.length > 0) {
    if (!deal.batteryId) {
      missing.push("no battery on this design yet");
    } else if (!t.vppBatteries.some((b) => b.id === deal.batteryId)) {
      fails.push(`${deal.batteryLabel ?? "this battery"} is not on the programme`);
    }
  }

  const restrictsFinance = t.vppFinanceProducts.length > 0 || t.vppProducts.length > 0;
  if (restrictsFinance) {
    if (!deal.financeProduct) {
      missing.push("nothing quoted yet");
    } else {
      if (
        t.vppFinanceProducts.length > 0 &&
        !t.vppFinanceProducts.includes(deal.financeProduct)
      ) {
        fails.push(`${PRODUCT_LABEL[deal.financeProduct].toLowerCase()} does not qualify`);
      } else if (t.vppProducts.length > 0 && deal.financeProduct !== "cash") {
        // Cash is exempt: it never names a rate-sheet row, so a product list
        // cannot rule it out and it stands or falls on the type list alone.
        //
        // Every other product is judged on the row it names — and an offer that
        // names NO row while the programme lists specific ones does not pass.
        // Hand-typed terms are precisely the case where nobody has checked the
        // paper against the programme, and passing them would let the one deal
        // that skipped the rate sheet be the one we over-promise on.
        if (!deal.financeProductId) {
          fails.push("hand-entered terms are not on the programme's list");
        } else if (!t.vppProducts.some((p) => p.id === deal.financeProductId)) {
          fails.push(`${deal.financeProductLabel ?? "this product"} is not on the programme`);
        }
      }
    }
  }

  if (fails.length > 0) return { state: "ineligible", reasons: fails };
  if (missing.length > 0) return { state: "unknown", reasons: missing };
  return { state: "eligible" };
}

/**
 * The verdict as the sentence both screens print, so neither can word it its
 * own way. Null when there is nothing to say.
 */
export function vppVerdictLine(v: VppVerdict): string | null {
  switch (v.state) {
    case "unrestricted":
      return null;
    case "eligible":
      return "This deal qualifies.";
    case "unknown":
      return `Can't tell yet — ${v.reasons.join(", ")}.`;
    case "ineligible":
      return `Not eligible — ${v.reasons.join("; ")}.`;
  }
}
