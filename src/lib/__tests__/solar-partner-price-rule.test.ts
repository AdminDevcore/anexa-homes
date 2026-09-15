import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CI guard: every screen that prices a deal applies the partner's rule.
 *
 * `pricePurchase` prices whatever sticker it is handed. That is correct and
 * deliberate — it is the arithmetic, not the policy — but it means a caller
 * that hands it the raw `base ÷ (1 − fee)` sticker has quietly opted out of
 * `capStickerToFinalPpw`, and on a capped or flat partner the figure it
 * produces is not the one the customer can be sold.
 *
 * The defect this exists to prevent, in its original form: the solar builder's
 * quoted strip and its unsaved-changes banner both priced this way. On Amos
 * Capital Fund — $5.50/W FLAT, fee and adders included — an 11 kW deal carrying
 * a $2,550 trenching adder showed $168.13/mo on the shelf of cards and
 * $188.60/mo in the strip directly underneath them, and the banner offered to
 * save a $67,896 contract the server was never going to write. A rep reads
 * whichever number is nearest their thumb.
 *
 * So: a file that calls `pricePurchase` must also apply the rule, by calling
 * `capStickerToFinalPpw`, or one of the three functions that wrap it —
 * `priceStoredPurchase`, `financeRowForProduct`, `compareOffers`. A file that
 * genuinely has no partner to be held to goes in ALLOWED with the reason why.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src"];
const SCAN_EXT = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build", "__tests__"]);

const PRICES = /\bpricePurchase\s*\(/;

/** The rule itself, and every function that applies it on a caller's behalf. */
const APPLIES_RULE = /\b(capStickerToFinalPpw|priceStoredPurchase|financeRowForProduct|compareOffers)\b/;

/**
 * Comment lines discuss these identifiers by name — this file's own subject
 * matter is heavily commented, and the docblock above `pricePurchase` names
 * both sides. Allowlisting whole files instead would blind the guard to a real
 * call added to them later.
 */
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/** Reviewed exceptions, keyed by repo-relative path (POSIX separators). */
const ALLOWED: Record<string, string> = {
  // The definition. `pricePurchase` and `capStickerToFinalPpw` both live here,
  // and the second is written in terms of the first.
  "src/lib/solar-money.ts": "declares both the arithmetic and the rule",
  // Prices the SNAPSHOT's stored figures, which were held to the partner's rule
  // before they were stored: `financeRowForProduct` caps at save, generation
  // re-caps and writes back, and every alternative on the payment menu is built
  // by `financeRowForProduct` against its own lender. By the time a sticker
  // reaches here it has already been through the rule, and applying it a second
  // time against the QUOTED lender would hold Climate First's column to Amos's
  // price list.
  "src/lib/solar-proposal.ts": "prices already-capped stored figures",
  // A worked example on the pay-structure form: a fixed illustrative system at
  // the company's own figures, with no deal, no customer and no lender. There
  // is no partner here to be held to.
  "src/components/portal/member-pay-structure.tsx": "hypothetical example, no lender",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * The SECOND guard, and it fails silently in a way the first one does not.
 *
 * `SolarFinance.adderTotalCents` stopped meaning "the extra work" the day a
 * roof could be financed on top of a partner's price: it means the half of it
 * inside that price, and `onTopAdderTotalCents` is the other half. A caller
 * that reads the first column and forgets the second still compiles, still
 * prices, and quietly drops a $7,000 roof off the contract — the customer signs
 * $55,000 for a job that was supposed to be $62,000, and nothing on any screen
 * says so.
 *
 * So a file that reads `adderTotalCents` off a SolarFinance row — the tell is
 * `finance.adderTotalCents` or `fin.adderTotalCents` — must also mention
 * `onTopAdderTotalCents` somewhere, or say in ALLOWED_ADDER_SPLIT why it does
 * not.
 */
const READS_FINANCE_ADDERS = /\b(finance|fin|f|row)\??\.adderTotalCents\b/;
const READS_ON_TOP = /\bonTopAdderTotalCents\b/;

const ALLOWED_ADDER_SPLIT: Record<string, string> = {
  // Reads the column only to decide whether a LEGACY deal — one priced before
  // adders were itemised — should keep its typed total. Never prices with it.
  "src/server/modules/solar/adders.ts": "reads it to preserve a legacy typed total",
  // Renders the SNAPSHOT, whose `adderTotalCents` is a different figure from
  // the database column of that name: it is what the customer pays for the
  // extra work, at sticker, with a roof financed on top already inside it —
  // `purchase.adderStickerCents`. There is no second half left to read.
  "src/components/proposal/solar/index.tsx": "renders the snapshot's combined sticker figure",
  // The cost chapter, split out of index.tsx on 2026-08-30. Same argument word
  // for word: it renders the frozen snapshot, where `adderTotalCents` is
  // already `purchase.adderStickerCents` — the whole of the extra work at
  // sticker, a roof financed on top included. It prices nothing.
  "src/components/proposal/solar/chapters/cost.tsx":
    "renders the snapshot's combined sticker figure",
};

describe("no screen loses a roof that is financed on top", () => {
  it("every reader of a finance row's adder total also reads the on-top half", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        const source = readFileSync(file, "utf8");

        const reads = source
          .split("\n")
          .some((line) => !COMMENT.test(line) && READS_FINANCE_ADDERS.test(line));
        if (!reads) continue;

        if (rel in ALLOWED_ADDER_SPLIT) continue;
        if (READS_ON_TOP.test(source)) continue;

        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files read a deal's adder total but never the half financed on top, ` +
        `so a roof added to the loan would be missing from whatever they price. ` +
        `Read onTopAdderTotalCents too, or add the file to ALLOWED_ADDER_SPLIT ` +
        `with the reason it does not price anything.`
    ).toEqual([]);
  });
});

/**
 * The THIRD guard: a partner's figure never travels without its programme's basis.
 *
 * `maxFinalPpwCents` stopped meaning "the final price" the day a programme
 * could say its partner's $5.50 is the GROSS or the BASE with the dealer fee on
 * top. A caller that hands the figure to the rule and forgets the basis still
 * compiles — the basis is optional and defaults to `final` — and quietly prices
 * a gross-priced programme with the fee inside the $5.50 instead of on top.
 *
 * So a file that reads a partner's figure AND applies the rule must mention the
 * programme's basis somewhere.
 */
const READS_FIGURE = /\b(maxFinalPpwCents|maxFinalPricePerBatteryCents)\b/;
const APPLIES_FIGURE =
  /\b(capStickerToFinalPpw|capStickerToFinalUnit|priceStoredPurchase|priceStorageStored|financeRowForProduct)\s*\(/;
const READS_BASIS = /[pP]pwBasis|[bB]atteryPriceBasis|\bbasis:/;

describe("no partner figure is applied without its programme's basis", () => {
  it("every file applying a lender's $/W or $/battery also reads the basis", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        const code = readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => !COMMENT.test(line));

        const reads = code.some((line) => READS_FIGURE.test(line));
        const applies = code.some((line) => APPLIES_FIGURE.test(line));
        if (!reads || !applies) continue;
        if (code.some((line) => READS_BASIS.test(line))) continue;

        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files apply a partner's figure without the programme's basis, so a ` +
        `gross- or base-priced programme would be priced with the fee inside the ` +
        `figure. Pass ppwBasis / batteryPriceBasis from the quoted programme.`
    ).toEqual([]);
  });
});

describe("a deal is never priced without its partner's rule", () => {
  it("every pricePurchase caller applies the cap, or is a reviewed exception", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        const source = readFileSync(file, "utf8");

        const calls = source
          .split("\n")
          .some((line) => !COMMENT.test(line) && PRICES.test(line));
        if (!calls) continue;

        if (rel in ALLOWED) continue;
        if (APPLIES_RULE.test(source)) continue;

        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files price a deal but never apply the partner's cap or flat price. ` +
        `Price through priceStoredPurchase / compareOffers / financeRowForProduct, ` +
        `or add the file to ALLOWED with the reason it has no partner.`
    ).toEqual([]);
  });
});

/**
 * The FOURTH guard: a battery is never priced without its partner's fee switch.
 *
 * `batteryInsideFee` is optional and reads as off, so a caller that prices a
 * battery and forgets the switch still compiles — and quietly quotes the
 * battery on top, at its catalogue price, on a partner that takes its fee on
 * it. One screen then shows a final price $24,000 under the next.
 *
 * So a file that prices a deal AND handles the battery's price must mention the
 * switch, or say in ALLOWED_BATTERY why it does not.
 */
const PRICES_ANY = /\b(pricePurchase|priceStoredPurchase|priceUnits)\s*\(/;
const HANDLES_BATTERY = /\bbatteryPriceCents\b/;
const READS_SWITCH = /\bbatteryInsideFee\b/;

const ALLOWED_BATTERY: Record<string, string> = {
  "src/lib/solar-money.ts": "declares the switch and the arithmetic",
};

describe("no battery is priced without its partner's fee switch", () => {
  it("every file pricing a deal with a battery on it also passes batteryInsideFee", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        const code = readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => !COMMENT.test(line));

        if (!code.some((line) => PRICES_ANY.test(line))) continue;
        if (!code.some((line) => HANDLES_BATTERY.test(line))) continue;
        if (rel in ALLOWED_BATTERY) continue;
        if (code.some((line) => READS_SWITCH.test(line))) continue;

        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files price a deal carrying a battery without the partner's fee switch, ` +
        `so a partner that takes its fee on the battery would be quoted with it on top. ` +
        `Pass batteryInsideFee from the quoted programme's lender.`
    ).toEqual([]);
  });
});
