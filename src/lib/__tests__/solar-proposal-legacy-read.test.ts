import { describe, it, expect } from "vitest";
import { readProposalSnapshot } from "@/lib/solar-proposal";

/**
 * THE V9 RESPELLING, READ FROM BOTH SIDES.
 *
 * v9 renamed the price keys on `financing` and moved no number. Every proposal
 * signed before that release still carries the old spellings in the database,
 * so this reader is the only thing standing between a frozen document and a
 * screen that reports it as carrying no price at all.
 *
 * That failure is invisible to the compiler — stored JSON is `unknown`, so a
 * reader that goes straight at `financing.finalPriceCents` type-checks
 * perfectly and then returns undefined for every document written before this
 * release. It is caught here or it is caught by a customer.
 *
 * The shapes below are the ones actually in the table: a v7 document with the
 * retired names, a v9 document with the current ones, and the degenerate rows a
 * JSON column can always hand back.
 */

const V7 = {
  schemaVersion: 7,
  reference: "SP-LEGACY",
  system: { sizeKwDc: 12 },
  financing: {
    product: "loan",
    contractPriceCents: 5_080_000,
    grossPpwCents: 350,
    basePriceCents: 4_200_000,
    adderTotalCents: 385_000,
    batteryPriceCents: 495_000,
    monthlyPaymentCents: 27_400,
    rateMillsPerKwh: null,
  },
} as const;

describe("readProposalSnapshot translates a pre-v9 document", () => {
  it("answers every retired price key by its current name", () => {
    const f = readProposalSnapshot(V7)!.financing as unknown as Record<string, unknown>;
    expect(f.finalPriceCents).toBe(5_080_000);
    expect(f.baseFinalPpwCents).toBe(350);
    expect(f.baseFinalCents).toBe(4_200_000);
    expect(f.addersFinalCents).toBe(385_000);
    expect(f.equipmentFinalCents).toBe(495_000);
    expect(f.leasePaymentCents).toBe(27_400);
  });

  it("retires the old spellings rather than answering to both", () => {
    const f = readProposalSnapshot(V7)!.financing as unknown as Record<string, unknown>;
    for (const retired of [
      "contractPriceCents",
      "grossPpwCents",
      "basePriceCents",
      "adderTotalCents",
      "batteryPriceCents",
      "monthlyPaymentCents",
    ]) {
      expect(f, `${retired} should not survive the read`).not.toHaveProperty(retired);
    }
  });

  it("carries the keys it was never asked to rename straight through", () => {
    const s = readProposalSnapshot(V7)!;
    expect(s.reference).toBe("SP-LEGACY");
    expect(s.financing.product).toBe("loan");
    expect(s.financing.rateMillsPerKwh).toBeNull();
  });

  /**
   * The document says what it was WRITTEN as. Renderers branch on this number,
   * and a v7 page relabelled v9 would be a document claiming to be something it
   * is not — which is the one thing a frozen snapshot exists to prevent.
   */
  it("does not restamp the version it was written under", () => {
    expect(readProposalSnapshot(V7)!.schemaVersion).toBe(7);
  });

  /**
   * Prisma hands back the same object on a second read, and a reader that
   * rewrote it in place would leave the next caller looking at a document the
   * database never stored.
   */
  it("leaves the stored row untouched", () => {
    const row = JSON.parse(JSON.stringify(V7));
    readProposalSnapshot(row);
    expect(row.financing.contractPriceCents).toBe(5_080_000);
    expect(row.financing).not.toHaveProperty("finalPriceCents");
  });
});

/**
 * The half that had no fixture. `options[].financing` is a whole financing
 * block of its own, and it is the one the customer's payment menu reads — so a
 * document translated only at the top level renders a menu of empty prices.
 */
describe("readProposalSnapshot translates the financing nested in every option", () => {
  const WITH_OPTIONS = {
    schemaVersion: 7,
    financing: { product: "loan", contractPriceCents: 5_080_000 },
    options: [
      { key: "cash", quoted: false, financing: { product: "cash", contractPriceCents: 4_900_000 } },
      {
        key: "loan:1",
        quoted: true,
        financing: { product: "loan", contractPriceCents: 5_080_000, basePriceCents: 4_200_000 },
      },
    ],
  };

  it("respells each option's own block, not merely the document's", () => {
    const opts = readProposalSnapshot(WITH_OPTIONS)!.options as unknown as {
      financing: Record<string, unknown>;
    }[];
    expect(opts[0].financing.finalPriceCents).toBe(4_900_000);
    expect(opts[1].financing.finalPriceCents).toBe(5_080_000);
    expect(opts[1].financing.baseFinalCents).toBe(4_200_000);
    for (const o of opts) expect(o.financing).not.toHaveProperty("contractPriceCents");
  });

  it("keeps everything else about an option intact", () => {
    const opts = readProposalSnapshot(WITH_OPTIONS)!.options as unknown as {
      key: string;
      quoted: boolean;
    }[];
    expect(opts.map((o) => o.key)).toEqual(["cash", "loan:1"]);
    expect(opts[1].quoted).toBe(true);
  });

  it("translates the options even when the document's own block needs nothing", () => {
    const topLevelAlreadyCurrent = {
      schemaVersion: 9,
      financing: { product: "loan", finalPriceCents: 1 },
      options: [{ key: "cash", financing: { contractPriceCents: 4_900_000 } }],
    };
    const opts = readProposalSnapshot(topLevelAlreadyCurrent)!.options as unknown as {
      financing: Record<string, unknown>;
    }[];
    expect(opts[0].financing.finalPriceCents).toBe(4_900_000);
  });

  it("leaves the stored options untouched", () => {
    const row = JSON.parse(JSON.stringify(WITH_OPTIONS));
    readProposalSnapshot(row);
    expect(row.options[0].financing.contractPriceCents).toBe(4_900_000);
    expect(row.options[0].financing).not.toHaveProperty("finalPriceCents");
  });

  it("does not throw on an options array holding something that is not an option", () => {
    expect(() => readProposalSnapshot({ options: [null, 7, "x"] })).not.toThrow();
  });
});

describe("readProposalSnapshot leaves a v9 document alone", () => {
  const V9 = {
    schemaVersion: 9,
    financing: { product: "cash", finalPriceCents: 2_800_000, baseFinalCents: 2_800_000 },
  };

  it("hands back the very object it was given, uncopied", () => {
    expect(readProposalSnapshot(V9)).toBe(V9);
  });

  /**
   * Nothing writes both spellings. A hand-edited row can carry them, and the
   * current name is the one a writer meant last.
   */
  it("prefers the current spelling when a row carries both", () => {
    const mixed = {
      schemaVersion: 9,
      financing: { finalPriceCents: 111, contractPriceCents: 999 },
    };
    const f = readProposalSnapshot(mixed)!.financing as unknown as Record<string, unknown>;
    expect(f.finalPriceCents).toBe(111);
    expect(f).not.toHaveProperty("contractPriceCents");
  });
});

describe("readProposalSnapshot survives what a JSON column can hold", () => {
  it("reads null as null", () => {
    expect(readProposalSnapshot(null)).toBeNull();
    expect(readProposalSnapshot(undefined)).toBeNull();
  });

  it("passes a document with no financing block through untouched", () => {
    const bare = { schemaVersion: 1, reference: "SP-1" };
    expect(readProposalSnapshot(bare)).toBe(bare);
  });

  it("does not throw on a scalar where an object was expected", () => {
    expect(() => readProposalSnapshot("not a document")).not.toThrow();
    expect(() => readProposalSnapshot({ financing: 4 })).not.toThrow();
  });
});

/**
 * THE DEALER FEE COMES OFF ON READ.
 *
 * Three renderers were each taking it off on the way to the screen, so a fourth
 * would have printed it. The strip moved into the reader; these are the tests
 * that say so, and they are the only thing that can — a frozen label is stored
 * JSON, so a renderer that stops stripping type-checks perfectly and shows a
 * homeowner what their lender charges us.
 */
describe("readProposalSnapshot takes the dealer fee off a frozen label", () => {
  const V7_LABELLED = {
    schemaVersion: 7,
    financing: {
      product: "loan",
      contractPriceCents: 5_080_000,
      lenderProductLabel: "Credit Humen · 30 yr · 0% · fee 25%",
    },
    options: [
      {
        key: "loan:1",
        label: "Credit Humen · 30 yr · 0% · fee 25%",
        financing: { product: "loan", contractPriceCents: 5_080_000 },
      },
      { key: "cash", label: "Pay in full", financing: { product: "cash", contractPriceCents: 4_200_000 } },
    ],
  };

  it("answers the frozen label by its current name, without the fee", () => {
    const f = readProposalSnapshot(V7_LABELLED)!.financing as unknown as Record<string, unknown>;
    expect(f.programmeLabel).toBe("Credit Humen · 30 yr · 0%");
    expect(f).not.toHaveProperty("lenderProductLabel");
  });

  it("strips the option labels too — the menu prints those, not `financing`", () => {
    const opts = readProposalSnapshot(V7_LABELLED)!.options as unknown as { label: string }[];
    expect(opts[0].label).toBe("Credit Humen · 30 yr · 0%");
    // A label that never carried a fee is handed back exactly as it was.
    expect(opts[1].label).toBe("Pay in full");
  });

  it("leaves a document whose labels are already clean untouched", () => {
    const clean = {
      schemaVersion: 9,
      financing: { product: "loan", finalPriceCents: 1, programmeLabel: "Amos 30 Year Solar" },
      options: [{ key: "loan:1", label: "Amos · 30 yr · 0%", financing: { product: "loan", finalPriceCents: 1 } }],
    };
    expect(readProposalSnapshot(clean)).toBe(clean);
  });
});

/**
 * The lease payment has been called three things. Every one of them has to read.
 */
describe("readProposalSnapshot answers a lease payment under all three spellings", () => {
  const read = (financing: Record<string, unknown>) =>
    readProposalSnapshot({ financing })!.financing as unknown as Record<string, unknown>;

  it("reads the pre-v9 spelling", () => {
    expect(read({ product: "lease", monthlyPaymentCents: 17_500 }).leasePaymentCents).toBe(17_500);
  });

  it("reads the spelling v9 first shipped with, and retires it", () => {
    const f = read({ product: "lease", leaseMonthlyCents: 21_500 });
    expect(f.leasePaymentCents).toBe(21_500);
    expect(f).not.toHaveProperty("leaseMonthlyCents");
  });

  it("prefers the current key when a hand-edited row carries two", () => {
    expect(read({ leasePaymentCents: 111, monthlyPaymentCents: 999 }).leasePaymentCents).toBe(111);
  });
});
