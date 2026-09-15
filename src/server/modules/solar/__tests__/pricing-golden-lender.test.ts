import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEALS, priceToday, storageToday } from "@/lib/__tests__/pricing-golden-deals";

/**
 * GOLDEN: THE AMOUNT A LENDER IS ASKED FOR, ON EVERY BASIS.
 *
 * Pricing rework, Stage 0. Characterization of `amountOnBasis`
 * (lender-submit.ts), which is not exported, through the real submission path
 * with the database and the network mocked — the same seams
 * lender-submit.test.ts uses. The frozen documents are the golden deals, built
 * by the real snapshot builder, so the figures here are the ones the pure
 * golden tests pin on the proposal itself.
 *
 * Stage 5 (D2, D6) is approved to change these: the lender amount becomes the
 * credits-applied net final including the sign-today credit, and the
 * per-lender basis retires.
 */

const decryptField = vi.fn();
vi.mock("@/server/lib/crypto", () => ({
  decryptField: (...a: unknown[]) => decryptField(...a),
  encryptField: vi.fn(),
  maskTail: () => "MASKED",
}));

const designFindFirst = vi.fn();
const financeFindFirst = vi.fn();
const proposalFindFirst = vi.fn();
const submissionCreate = vi.fn();
const fieldMapFindMany = vi.fn();
const companyFindFirst = vi.fn();
vi.mock("@/server/db/client", () => ({
  prisma: {
    solarDesign: { findFirst: (...a: unknown[]) => designFindFirst(...a) },
    solarFinance: { findFirst: (...a: unknown[]) => financeFindFirst(...a) },
    solarProposal: { findFirst: (...a: unknown[]) => proposalFindFirst(...a) },
    solarLenderSubmission: { create: (...a: unknown[]) => submissionCreate(...a) },
    solarLenderFieldMap: { findMany: (...a: unknown[]) => fieldMapFindMany(...a) },
    company: { findFirst: (...a: unknown[]) => companyFindFirst(...a) },
  },
}));

const submitToAmos = vi.fn();
const validateWithAmos = vi.fn();
vi.mock("../amos-client", async () => {
  const actual = await vi.importActual<typeof import("../amos-client")>("../amos-client");
  return {
    ...actual,
    submitToAmos: (...a: unknown[]) => submitToAmos(...a),
    validateWithAmos: (...a: unknown[]) => validateWithAmos(...a),
  };
});

const { submitDealToLender } = await import("../lender-submit");

const LEAD = {
  firstName: "Dana",
  lastName: "Reyes",
  email: "dana@example.com",
  phone: "5125550143",
  address: "4120 Sage Hollow Dr",
  city: "Austin",
  state: "TX",
  zip: "78735",
  assignedRep: { firstName: "Marco", lastName: "Diaz" },
};

/** The design lender-submit.test.ts submits: money is read off the frozen document, not this. */
const DESIGN = {
  id: "design-abc",
  systemSizeKwDc: 10.66,
  year1ProductionKwh: 14200,
  annualUsageKwh: 15800,
  moduleQty: 26,
  batteryQty: 0,
  module: {
    manufacturer: "Qcells",
    model: "Q.PEAK 410",
    lenderApprovals: [{ lenderId: "lender-1", lenderBrand: "Qcells", lenderModel: "Q.PEAK DUO BLK ML-G10+" }],
  },
  inverter: {
    manufacturer: "Enphase",
    model: "IQ8PLUS",
    lenderApprovals: [{ lenderId: "lender-1", lenderBrand: "Enphase", lenderModel: "IQ8PLUS-72-M-US" }],
  },
  battery: null,
  lender: {
    id: "lender-1",
    name: "Amos Capital Fund",
    apiBaseUrl: "https://lender.test",
    apiKeyEncrypted: "ENCRYPTED",
    apiProductSlug: "solar-installation-financing",
    submissionAmountBasis: "contract_value",
    submissionSavingBasis: "utility_avoided",
    submissionSavingHorizon: "year_one",
    submissionRepNameBasis: "deal_rep",
    submissionRepName: null,
    submissionDelivery: "in_person",
  },
  lead: LEAD,
};

const INPUT = { leadId: "lead-1", companyId: "co-1", ownerOccupied: true, fallbackRepName: "Anexa Homes" };
const BASES = ["contract_value", "customer_obligation", "after_credits"] as const;

/** The worked example with the §4.4 sign-today credit: a $2.50/W cap hands back $17,000. */
const WORKED_EXAMPLE_SIGN_TODAY = priceToday({
  ...DEALS.workedExample,
  signToday: { mode: "above_cap", fixedCents: null, capPpwCents: 250 },
});

const DOCUMENTS = {
  workedExample: priceToday(DEALS.workedExample).snapshot,
  workedExampleSignToday250: WORKED_EXAMPLE_SIGN_TODAY.snapshot,
  cappedPartner: priceToday(DEALS.cappedPartner).snapshot,
  storageOnly: storageToday().snapshot,
};

beforeEach(() => {
  decryptField.mockReset().mockReturnValue("ak_live_secret");
  designFindFirst.mockReset().mockResolvedValue(DESIGN);
  financeFindFirst.mockReset().mockResolvedValue(null);
  proposalFindFirst.mockReset();
  submissionCreate.mockReset().mockResolvedValue({});
  fieldMapFindMany.mockReset().mockResolvedValue([]);
  companyFindFirst.mockReset().mockResolvedValue({ name: "Anexa Homes" });
  validateWithAmos.mockReset().mockResolvedValue({ valid: true, problems: [] });
  submitToAmos.mockReset().mockResolvedValue({
    applicationId: "app-1",
    referenceNumber: "AMS-1042",
    customerUrl: "https://lender.test/complete/tok",
    sentTo: "dana@example.com",
    expiresAt: "2026-09-10T00:00:00.000Z",
  });
});

async function requestedAmount(snapshot: unknown, basis: (typeof BASES)[number]) {
  submitToAmos.mockClear();
  designFindFirst.mockResolvedValue({ ...DESIGN, lender: { ...DESIGN.lender, submissionAmountBasis: basis } });
  proposalFindFirst.mockResolvedValue({ snapshot });
  const r = await submitDealToLender(INPUT);
  if (!r.ok) return { refused: r };
  return {
    requestedAmount: submitToAmos.mock.calls[0]?.[1]?.requestedAmount as string,
    termMonths: submitToAmos.mock.calls[0]?.[1]?.termMonths as unknown,
  };
}

describe("golden: the lender requested amount", () => {
  it("asks for the pre-credit amount financed, or that less the credit lines, never less the sign-today credit (L10)", async () => {
    const q = (WORKED_EXAMPLE_SIGN_TODAY.snapshot.options ?? []).find((o) => o.quoted)!;
    // The document says $28,453.33 is financed with credits applied...
    expect(q.creditsApplied?.financedAmountCents).toBe(2_845_333);
    // ...and the lender is asked for $45,453.33 on "after credits".
    expect(await requestedAmount(DOCUMENTS.workedExampleSignToday250, "after_credits")).toMatchObject({
      requestedAmount: "45453.33",
    });
    expect(await requestedAmount(DOCUMENTS.workedExample, "contract_value")).toMatchObject({
      requestedAmount: "64933.33",
    });
  });

  it("pins every golden document on every basis", async () => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, snapshot] of Object.entries(DOCUMENTS)) {
      out[key] = {};
      for (const basis of BASES) out[key][basis] = await requestedAmount(snapshot, basis);
    }
    expect(out).toMatchSnapshot();
  });
});
