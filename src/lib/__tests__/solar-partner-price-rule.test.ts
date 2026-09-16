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
 * So: a file that prices a deal must also apply the rule — by calling
 * `capStickerToFinalPpw`, or one of the functions that wrap it
 * (`priceStoredPurchase`, `financeRowForProduct`, `compareOffers`), or by
 * PASSING the rule to `priceDeal`. A file that genuinely has no partner to be
 * held to goes in ALLOWED with the reason why.
 *
 * WHY `priceDeal` COUNTS AS PRICING HERE: this guard was written against
 * `pricePurchase`, which was the only way to price a deal at the time. Stage 4c
 * moves all twenty-five price sites onto `priceDeal`, and every site converted
 * stopped matching the trigger — so the guard was quietly losing a file per
 * commit and would have finished Stage 4 passing with nothing left to check. A
 * guard that can be retired by a refactor it cannot see is not a guard.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src"];
const SCAN_EXT = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".next-e2e", "dist", "build", "__tests__"]);

/**
 * `priceDeal` is here for a reason worth stating: this guard was keyed to
 * `pricePurchase` alone, and Stage 4c is moving every price site in the product
 * onto `priceDeal`. Each conversion therefore removed a file from this guard's
 * view — not by defeating it, but by no longer matching its trigger. Left as it
 * was, the guard would end Stage 4 passing because it had nothing left to check.
 *
 * A `priceDeal` caller applies the rule by PASSING it, so the field names count
 * as evidence below alongside the functions that apply it on a caller's behalf.
 */
const PRICES = /\b(pricePurchase|priceDeal)\s*\(/;

/** The rule itself, every function that applies it, and passing it directly. */
const APPLIES_RULE =
  /\b(capStickerToFinalPpw|capStickerToFinalUnit|priceStoredPurchase|priceStorageStored|financeRowForProduct|compareOffers|priceRulePpwCents|priceRulePerBatteryCents)\b/;

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
/**
 * Both spellings, because the figure has two names. `maxFinalPpwCents` is what
 * the database column is still called; `priceRulePpwCents` is what the code
 * calls it since the Stage 2 rename, and it is the name every converted site
 * reads. Matching only the disk name would leave this guard watching a spelling
 * the new code no longer uses.
 */
const READS_FIGURE =
  /\b(maxFinalPpwCents|maxFinalPricePerBatteryCents|priceRulePpwCents|priceRulePerBatteryCents)\b/;
const APPLIES_FIGURE =
  /\b(capStickerToFinalPpw|capStickerToFinalUnit|priceStoredPurchase|priceStorageStored|financeRowForProduct|priceDeal)\s*\(/;
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
  it("every deal-pricing caller applies the cap, or is a reviewed exception", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        const code = readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => !COMMENT.test(line));

        if (!code.some((line) => PRICES.test(line))) continue;

        if (rel in ALLOWED) continue;
        // Evidence is read from CODE, not from the raw source. This subject
        // matter is heavily commented — the conversions themselves explain what
        // they replaced, by name — and a prose mention of `priceStoredPurchase`
        // would otherwise excuse a file that never calls it. Measured before
        // tightening: no file under src/ was passing on a comment-only mention.
        if (code.some((line) => APPLIES_RULE.test(line))) continue;

        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files price a deal but never apply the partner's cap or flat price. ` +
        `Pass priceRulePpwCents / priceRulePerBatteryCents to priceDeal, or price ` +
        `through priceStoredPurchase / compareOffers / financeRowForProduct, ` +
        `or add the file to ALLOWED with the reason it has no partner.`
    ).toEqual([]);
  });
});

/**
 * THE GUARDS' OWN NEGATIVE CONTROL.
 *
 * Everything above asserts that `src/` is clean. A guard whose pattern matched
 * nothing whatsoever would assert exactly that, just as green, and no one would
 * be able to tell the two apart by looking at a passing run — which is the only
 * thing anyone ever looks at.
 *
 * These pin the MECHANISM rather than the tree: that the trigger fires on what
 * it should, ignores what it should, and actually reports a file that prices
 * without a rule.
 *
 * Written when `priceDeal` was added to the trigger, because that change was
 * only safe if the trigger still fired. It was measured at the time: under
 * `src/`, the old `pricePurchase`-only trigger saw 3 files and the new one sees
 * 11. The 8 it had been missing were the Stage 4c conversions — each had
 * silently left the guard's view on the commit that converted it, which is how
 * a guard gets retired by a refactor without anyone deciding to retire it.
 */
const wouldFlag = (source: string): boolean => {
  const code = source.split("\n").filter((line) => !COMMENT.test(line));
  if (!code.some((line) => PRICES.test(line))) return false;
  return !code.some((line) => APPLIES_RULE.test(line));
};

describe("the partner-rule guard can still fail", () => {
  it("reports a priceDeal call that passes no partner rule", () => {
    expect(wouldFlag(`const p = priceDeal({ product: "loan", dealerFeePct: 25 });`)).toBe(true);
  });

  it("reports a pricePurchase call that applies no cap", () => {
    expect(wouldFlag(`const b = pricePurchase({ stickerPpwCents: 400 });`)).toBe(true);
  });

  it("clears a priceDeal call that passes the partner's rule", () => {
    expect(wouldFlag(`const p = priceDeal({ priceRulePpwCents: 550 });`)).toBe(false);
  });

  it("clears a pricePurchase call that caps the sticker first", () => {
    expect(
      wouldFlag(`const c = capStickerToFinalPpw({});\nconst b = pricePurchase({ stickerPpwCents: c });`)
    ).toBe(false);
  });

  it("is NOT satisfied by a comment that merely names the rule", () => {
    // The tightening this file now applies: evidence must be in code. Before it,
    // a file could be excused by prose describing what it used to call — and
    // every Stage 4c conversion leaves exactly that prose behind.
    expect(
      wouldFlag(`// already held to the ceiling by priceStoredPurchase upstream\nconst p = priceDeal({});`)
    ).toBe(true);
  });

  it("does not fire on an identifier that merely begins with the name", () => {
    // `PriceDealInput` is a type and `priceDealInput` a variable; neither prices
    // anything. The trigger requires the call parenthesis for this reason.
    expect(wouldFlag(`const x: PriceDealInput = y;\nconst z = priceDealInput;`)).toBe(false);
  });
});

describe("the basis guard watches both spellings of the partner's figure", () => {
  it("matches the database column name and the code's name for it", () => {
    // Stage 2 renamed the field in code while the column kept its old name, so
    // a guard watching only one spelling watches only half the callers.
    expect(READS_FIGURE.test("maxFinalPpwCents")).toBe(true);
    expect(READS_FIGURE.test("priceRulePpwCents")).toBe(true);
    expect(READS_FIGURE.test("maxFinalPricePerBatteryCents")).toBe(true);
    expect(READS_FIGURE.test("priceRulePerBatteryCents")).toBe(true);
  });

  it("counts priceDeal as applying the figure", () => {
    expect(APPLIES_FIGURE.test("priceDeal({")).toBe(true);
    expect(APPLIES_FIGURE.test("priceStoredPurchase({")).toBe(true);
  });
});

/**
 * THE RATCHET: a deal is priced through ONE door.
 *
 * Stage 4c ended with every price site in the product going through
 * `priceDeal()` and no file outside the pricing library calling the arithmetic
 * underneath it. That is a property of the tree today, not a rule — and an
 * unenforced property lasts exactly until the next screen needs a price and
 * finds `pricePurchase` first, which is how the eleven independent price sites
 * came to exist in the first place.
 *
 * The guard above does NOT cover this. It asks whether a caller applies the
 * partner's rule; a new `pricePurchase` caller that dutifully caps first would
 * satisfy it completely while still being a twelfth independent derivation of
 * the customer's price, free to drift from the other eleven the moment either
 * changes.
 *
 * So: the primitives are the pricing library's to call. Everything else asks
 * `priceDeal()`.
 *
 * `basePpwFromSticker`, `grossPpwFromNet` and `underBaseFloor` are deliberately
 * NOT listed. They convert between a base and a sticker, or judge a floor; they
 * price nothing, `priceDeal` has no door that answers those questions, and nine
 * files legitimately use them.
 */
const RAW_PRICE =
  /\b(pricePurchase|priceStoredPurchase|priceStoragePurchase|priceStorageStored|priceUnits|capStickerToFinalPpw|capStickerToFinalUnit)\s*\(/;

/** The pricing library itself. Reviewed exceptions go here with the reason. */
const ALLOWED_RAW_PRICE: Record<string, string> = {
  // Declares the arithmetic. Every one of these functions lives here.
  "src/lib/solar-money.ts": "declares the primitives",
  // THE ONE DOOR. `priceDeal` is the only thing that may call them, which is
  // the whole point of the rule — its two branches delegate to
  // `priceStoredPurchase` and `priceStorageStored`.
  "src/lib/solar-price-deal.ts": "the one door every site prices through",
};

describe("a deal is priced through one door", () => {
  it("no file outside the pricing library calls the arithmetic directly", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        if (rel in ALLOWED_RAW_PRICE) continue;

        const code = readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => !COMMENT.test(line));

        if (code.some((line) => RAW_PRICE.test(line))) offenders.push(rel);
      }
    }

    expect(
      offenders,
      `These files price a deal with the raw arithmetic instead of priceDeal(). ` +
        `Stage 4c removed the last of them; a new one is a twelfth independent ` +
        `derivation of the customer's price. Call priceDeal(), or add the file to ` +
        `ALLOWED_RAW_PRICE with the reason it cannot.`
    ).toEqual([]);
  });

  it("can still fail — it is not a pattern that matches nothing", () => {
    // The same lesson as the negative control above: a ratchet whose regex
    // matched nothing would pass just as green as one holding the line.
    const lines = (s: string) => s.split("\n").filter((l) => !COMMENT.test(l));
    expect(lines(`const b = pricePurchase({ stickerPpwCents: 400 });`).some((l) => RAW_PRICE.test(l))).toBe(true);
    expect(lines(`const c = capStickerToFinalUnit({ units: 2 });`).some((l) => RAW_PRICE.test(l))).toBe(true);
    expect(lines(`const s = priceStorageStored({ batteryQty: 2 });`).some((l) => RAW_PRICE.test(l))).toBe(true);
    // The approved way through, and the conversions that are not pricing.
    expect(lines(`const p = priceDeal({ priceRulePpwCents: 550 });`).some((l) => RAW_PRICE.test(l))).toBe(false);
    expect(lines(`const base = basePpwFromSticker(550, 65);`).some((l) => RAW_PRICE.test(l))).toBe(false);
    expect(lines(`const up = grossPpwFromNet(350, 18);`).some((l) => RAW_PRICE.test(l))).toBe(false);
  });
});
