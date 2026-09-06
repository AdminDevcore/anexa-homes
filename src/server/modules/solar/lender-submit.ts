import { prisma } from "@/server/db/client";
import { decryptField } from "@/server/lib/crypto";
import { buildAmosPayload, preflightAmosSubmission } from "./amos-payload";
import { submitToAmos, AmosSubmissionError } from "./amos-client";

/**
 * Sending a priced deal into the lender's own system.
 *
 * NOT a "use server" module, deliberately. Every export of one of those is a
 * callable endpoint, and this is the shared middle: the two doors onto it —
 * the customer's Qualify button and anything internal that follows it — each
 * establish their own authorization first and then call in here with a
 * companyId they resolved themselves. Nothing in this file trusts its caller
 * to have done that; it just refuses to look at a row outside the company it
 * was handed.
 *
 * THE CREDENTIAL IS THE LENDER'S OWN. Every partner issues its own key, so the
 * key travels with the lender row on the deal (`SolarLender.apiKeyEncrypted`)
 * and is decrypted here, per submission. There is no company-wide lender key
 * and no environment variable — which is why this works for the second partner
 * without a line of code changing.
 *
 * WHAT LEAVES ANEXA
 *
 * Name, contact details, property address, system design and the quoted
 * amount. Never an SSN, never a date of birth, never a consent flag — the
 * authorization to pull credit has to be the customer's own, captured on the
 * lender's page under their disclosures.
 */

/**
 * What the caller should DO about a failure, which is a different question
 * from what went wrong:
 *   "deal"      — fix the deal and try again (missing email, unmatched panel).
 *   "config"    — nobody on site can fix it; an admin must fix lender settings.
 *   "transient" — try again as-is; re-sending the same deal is safe.
 */
export type FailureKind = "deal" | "config" | "transient";

export type SubmissionSummary = {
  customer: string;
  property: string;
  system: string;
  financing: string;
};

/**
 * Is this deal's lender wired for API submission, and would a send succeed?
 *
 * Read-only and safe to call on render. Resolved on the SERVER at page render
 * for both doors: the customer's document is only ever handed the `ready`
 * case, and the rep's preview is handed the blockers too. Answering BEFORE the
 * click is the whole point — the alternative is an error in front of a
 * customer.
 */
export type LenderSubmissionStatus =
  | { mode: "link" }
  | { mode: "api"; lenderName: string; ready: true; summary: SubmissionSummary }
  | { mode: "api"; lenderName: string; ready: false; problems: string[] };

export type LenderSubmitResult =
  | {
      ok: true;
      referenceNumber: string;
      /** Present for a handoff on the device in hand; null when the lender emailed it. */
      customerUrl: string | null;
      sentTo: string;
      lenderName: string;
    }
  | { ok: false; error: string; kind: FailureKind; problems?: string[] };

const fail = (error: string, kind: FailureKind = "deal"): LenderSubmitResult => ({
  ok: false,
  error,
  kind,
});

export async function readLenderSubmission(
  leadId: string,
  companyId: string,
): Promise<LenderSubmissionStatus> {
  const design = await loadDesign(leadId, companyId);
  if (!design?.lender) return { mode: "link" };

  const { lender } = design;
  if (!lender.apiBaseUrl || !lender.apiKeyEncrypted || !lender.apiProductSlug) {
    return { mode: "link" };
  }

  const problems = preflightAmosSubmission(design.lead, asSubmitted(design), lender.name);
  if (problems.length > 0) {
    return { mode: "api", lenderName: lender.name, ready: false, problems };
  }

  const money = await loadMoney(leadId, companyId);
  if (money.problem) {
    return { mode: "api", lenderName: lender.name, ready: false, problems: [money.problem] };
  }

  // Built on the SERVER from the same rows the submission reads, so the
  // confirmation shows what will actually be sent rather than whatever the
  // browser happened to be holding.
  return {
    mode: "api",
    lenderName: lender.name,
    ready: true,
    summary: {
      customer: `${design.lead.firstName} ${design.lead.lastName}`.trim(),
      property: [design.lead.address, design.lead.city, design.lead.state, design.lead.zip]
        .filter(Boolean)
        .join(", "),
      system: describeSystem(design),
      financing: `${usd(money.amountCents)} over ${money.termMonths} months`,
    },
  };
}

export type LenderSubmitInput = {
  leadId: string;
  companyId: string;
  /**
   * Whether the applicant lives in the property. Anexa does not record it
   * anywhere and the lender requires it, so it is asked at submission time —
   * of the homeowner, on their own document, because it is a statement about
   * them and nobody else should be making it on their behalf.
   */
  ownerOccupied: boolean;
  /**
   * Whether the response ALSO carries the completion link.
   *
   * BOTH VALUES EMAIL THE CUSTOMER. The lender's invitation always emails, and
   * texts too when a phone number is on file — there is no per-channel switch
   * and no way to suppress delivery. `in_person` only adds the link to the
   * response so a rep can hand over their own device.
   *
   * This matters for testing: there is no such thing as a silent submission.
   * A smoke test reaches whoever is on the lead, so put your own email AND
   * your own phone on it first.
   */
  delivery?: "in_person" | "customer";
  /** Used only when the deal has no assigned rep of its own. */
  fallbackRepName: string;
};

export async function submitDealToLender(input: LenderSubmitInput): Promise<LenderSubmitResult> {
  const { leadId, companyId, ownerOccupied, delivery = "in_person", fallbackRepName } = input;

  const design = await loadDesign(leadId, companyId);
  if (!design) return fail("Deal not found.");

  const lender = design.lender;
  if (!lender) return fail("This deal has no lender selected.");

  const apiKey = decryptField(lender.apiKeyEncrypted);
  if (!lender.apiBaseUrl || !apiKey || !lender.apiProductSlug) {
    return fail(
      `${lender.name} is not set up for direct submission. An administrator can add its API details in Settings → Lenders.`,
      "config",
    );
  }

  // Renamed to this partner's own vocabulary before either the check or the
  // build sees it, so the two can never disagree about what is being sent.
  const submitted = asSubmitted(design);

  const problems = preflightAmosSubmission(design.lead, submitted, lender.name);
  if (problems.length > 0) {
    return {
      ok: false,
      kind: "deal",
      error: "This deal is missing information the lender requires.",
      problems,
    };
  }

  const money = await loadMoney(leadId, companyId);
  if (money.problem) return fail(money.problem);

  const payload = buildAmosPayload(design.lead, submitted, {
    productSlug: lender.apiProductSlug,
    externalId: lenderReference(design.id, design.lenderSubmissionAttempt),
    amountCents: money.amountCents,
    termMonths: money.termMonths,
    // The rep on the deal if there is one, otherwise whoever the caller named.
    // The lender takes a typed name and maps it to a real login on their side.
    salesRepName: repName(design.lead.assignedRep) ?? fallbackRepName,
    ownerOccupied,
    delivery,
  });

  try {
    const result = await submitToAmos({ baseUrl: lender.apiBaseUrl, apiKey }, payload);
    return {
      ok: true,
      referenceNumber: result.referenceNumber,
      customerUrl: result.customerUrl,
      sentTo: result.sentTo,
      lenderName: lender.name,
    };
  } catch (e) {
    if (e instanceof AmosSubmissionError) {
      return {
        ok: false,
        error: e.message,
        kind: e.isConfigProblem
          ? "config"
          : e.code === "network_error" || e.code === "internal_error" || e.code === "bad_response"
            ? "transient"
            : "deal",
      };
    }
    // Never surface an unexpected error verbatim: it can carry a connection
    // string or another company's identifiers.
    return fail(
      "Something went wrong sending this deal. Re-sending the same deal is safe.",
      "transient",
    );
  }
}

/**
 * The reference this deal is filed under at the lender.
 *
 * The design id until somebody has had to abandon it, and `id-N` after. Exported
 * so the screen that offers a fresh reference can show which one a failure was
 * filed under — a rep on the phone to the lender's support desk needs to be
 * able to read it out, and "the design id" is not something they can see.
 */
export function lenderReference(designId: string, attempt: number): string {
  return attempt > 0 ? `${designId}-${attempt}` : designId;
}

/**
 * THE MONEY — READ OFF THE DOCUMENT THE CUSTOMER WAS SHOWN.
 *
 * The live proposal's FROZEN figures, not the live pricing rows. The lender has
 * to be asked for the amount on the sheet in front of the household, and on a
 * partner carrying a programme contribution those are two different numbers:
 * `SolarFinance.contractPriceCents` is the household's own price, while the
 * document quotes its payment from the contract value the partner's paper is
 * written at. Reading the rows sent Amos $70,180 for a deal whose proposal says
 * $150,180 and whose payment is $417.17 a month — an $80,000 understatement on
 * a real credit application, and it is only luck that their 500 got there
 * first.
 *
 * The snapshot cannot drift the way the rows can, either: a rep re-pricing
 * mid-application cannot move what has already been submitted, because the
 * figure came from a document that is frozen. Same principle as every
 * reporting surface — see resolveReportedSystem.
 *
 * FALLS BACK to SolarFinance when no proposal has been generated, which is the
 * only route that reaches here without one.
 */
async function loadMoney(leadId: string, companyId: string) {
  const quoted = await quotedFromProposal(leadId, companyId);
  if (quoted) return { problem: null, ...quoted };

  const finance = await prisma.solarFinance.findFirst({
    where: { leadId, companyId },
    select: { contractPriceCents: true, downPaymentCents: true, loanTermMonths: true },
  });
  const amountCents = (finance?.contractPriceCents ?? 0) - (finance?.downPaymentCents ?? 0);
  if (amountCents <= 0) {
    return { problem: "This deal has no financed amount yet. Price it first." as const };
  }
  if (!finance?.loanTermMonths) {
    return { problem: "This deal has no loan term yet. Choose one first." as const };
  }
  return { problem: null, amountCents, termMonths: finance.loanTermMonths };
}

/**
 * The amount and term the CURRENT document quotes, or null if it says neither.
 *
 * Superseded versions are excluded for the same reason `qualifyOnProposal`
 * refuses to submit from one: it quotes a price the deal is no longer written
 * at. A snapshot older than the field simply has no answer here and the rows
 * below take over, which is the right reading of an older proposal rather than
 * a guess at one.
 */
async function quotedFromProposal(leadId: string, companyId: string) {
  const live = await prisma.solarProposal.findFirst({
    where: { leadId, companyId, supersededAt: null },
    orderBy: { version: "desc" },
    select: { snapshot: true },
  });
  const financing = (live?.snapshot as { financing?: Record<string, unknown> } | null)?.financing;
  if (!financing) return null;

  const amountCents = financing.financedAmountCents;
  const termMonths = financing.loanTermMonths;
  if (typeof amountCents !== "number" || amountCents <= 0) return null;
  if (typeof termMonths !== "number" || termMonths <= 0) return null;

  return { amountCents, termMonths };
}

/** "10.7 kW · 26 x Qcells Q.PEAK 410 · 2 x Enphase IQ Battery 5P" */
function describeSystem(design: {
  systemSizeKwDc: number;
  moduleQty: number;
  batteryQty: number;
  module: { manufacturer: string | null; model: string } | null;
  battery: { manufacturer: string | null; model: string } | null;
}): string {
  const parts = [`${design.systemSizeKwDc.toFixed(1)} kW`];
  if (design.module && design.moduleQty > 0) {
    parts.push(
      `${design.moduleQty} x ${[design.module.manufacturer, design.module.model].filter(Boolean).join(" ")}`,
    );
  }
  if (design.battery && design.batteryQty > 0) {
    parts.push(
      `${design.batteryQty} x ${[design.battery.manufacturer, design.battery.model].filter(Boolean).join(" ")}`,
    );
  }
  return parts.join(" · ");
}

/** Cents to "$48,750" — whole dollars; the cents are noise at this size. */
function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** The deal's rep, as the lender wants it: a typed name, or nothing. */
function repName(rep: { firstName: string; lastName: string } | null): string | null {
  if (!rep) return null;
  const name = `${rep.firstName} ${rep.lastName}`.trim();
  return name.length > 0 ? name : null;
}

const EQUIPMENT_SELECT = {
  manufacturer: true,
  model: true,
  ratingW: true,
  lenderApprovals: { select: { lenderId: true, lenderBrand: true, lenderModel: true } },
} as const;

type CatalogueItem = {
  manufacturer: string | null;
  model: string;
  ratingW?: number | null;
  lenderApprovals?: { lenderId: string; lenderBrand: string | null; lenderModel: string | null }[];
};

/**
 * One catalogue item as the LENDER knows it.
 *
 * Our catalogue names a SKU with its wattage on the end; a partner's approved-
 * vendor list names a product family. Both names are correct and they are
 * rarely the same string, so the submission carries the partner's where an
 * admin has mapped it — see `SolarEquipmentLender.lenderModel`.
 *
 * A missing mapping is NOT silently corrected to something near it. Sending a
 * panel the customer is not getting, onto a real credit application, to save
 * an admin a dropdown, is not a trade this module is allowed to make: the
 * preflight refuses the deal instead, on a rep's screen.
 */
function withLenderNames(item: CatalogueItem | null, lenderId: string) {
  if (!item) return null;
  // Defensive on the relation rather than the row: a caller that selects the
  // item without its approvals would otherwise throw INSIDE a submission,
  // and "no mapping" is the honest reading of "we did not load any" -- it
  // sends our own name, exactly as this did before mappings existed.
  const mapped = (item.lenderApprovals ?? []).find((a) => a.lenderId === lenderId);
  return {
    manufacturer: item.manufacturer,
    model: item.model,
    ratingW: item.ratingW ?? null,
    lenderBrand: mapped?.lenderBrand ?? null,
    lenderModel: mapped?.lenderModel ?? null,
  };
}

/** The design as the lender's mapping renames it. */
function asSubmitted<T extends { lender: { id: string } | null; module: CatalogueItem | null; inverter: CatalogueItem | null; battery: CatalogueItem | null }>(
  design: T,
) {
  const lenderId = design.lender?.id ?? "";
  return {
    ...design,
    module: withLenderNames(design.module, lenderId),
    inverter: withLenderNames(design.inverter, lenderId),
    battery: withLenderNames(design.battery, lenderId),
  };
}

/** Everything both entry points read, scoped to the company the caller resolved. */
async function loadDesign(leadId: string, companyId: string) {
  return prisma.solarDesign.findFirst({
    where: { leadId, companyId },
    select: {
      id: true,
      systemSizeKwDc: true,
      year1ProductionKwh: true,
      annualUsageKwh: true,
      moduleQty: true,
      batteryQty: true,
      lenderSubmissionAttempt: true,
      /**
       * Each item's own name AND every partner's name for it.
       *
       * All of the approval rows rather than just this deal's lender: Prisma
       * cannot filter a nested relation on a sibling field of the parent row
       * (`lender.id` is selected in the same query), and an item is approved by
       * a handful of partners at most. `withLenderNames` picks the right one.
       */
      module: { select: EQUIPMENT_SELECT },
      inverter: { select: EQUIPMENT_SELECT },
      battery: { select: EQUIPMENT_SELECT },
      lender: {
        select: {
          id: true,
          name: true,
          apiBaseUrl: true,
          apiKeyEncrypted: true,
          apiProductSlug: true,
        },
      },
      lead: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          assignedRep: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
}
