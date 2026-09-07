import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { decryptField } from "@/server/lib/crypto";
import {
  buildAmosPayload,
  preflightAmosSubmission,
  savingsProblems,
  type AmosApplicationPayload,
  type AmosSystemFigures,
} from "./amos-payload";
import { postSolarUtilityCents, type SavingsModel } from "@/lib/solar-proposal";
import { submitToAmos, validateWithAmos, AmosSubmissionError, type AmosValidation } from "./amos-client";

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

  const quoted = await loadQuoted(leadId, companyId);

  // Both sets at once. A rep who fixes the panel mapping only to be told about
  // the missing rate has been sent round the loop twice for one visit.
  const problems = [
    ...preflightAmosSubmission(design.lead, asSubmitted(design), lender.name),
    ...savingsProblems(quoted.system),
  ];
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

/**
 * WHAT WOULD BE SENT, FOR SOMEBODY TO LOOK AT.
 *
 * The exact body `submitDealToLender` would post, built by the same function
 * from the same rows — not a description of it, and not a second rendering that
 * can drift. If this is wrong, the submission is wrong.
 *
 * `ownerOccupied` is the one field this cannot know: nothing stores it, it is
 * asked at the moment of sending, and the preview says so rather than implying
 * the answer is already on the deal.
 *
 * Read-only and safe on render, like `readLenderSubmission` beside it. The
 * API key is not in the result and cannot be — it travels as a header.
 */
export type LenderPayloadPreview =
  | { mode: "link" }
  | { mode: "api"; lenderName: string; ready: false; problems: string[] }
  | { mode: "api"; lenderName: string; ready: true; payload: AmosApplicationPayload };

export async function readLenderPayloadPreview(
  leadId: string,
  companyId: string,
  fallbackRepName: string,
): Promise<LenderPayloadPreview> {
  const design = await loadDesign(leadId, companyId);
  if (!design?.lender) return { mode: "link" };

  const { lender } = design;
  if (!lender.apiBaseUrl || !lender.apiKeyEncrypted || !lender.apiProductSlug) {
    return { mode: "link" };
  }

  const quoted = await loadQuoted(leadId, companyId);
  const problems = [
    ...preflightAmosSubmission(design.lead, asSubmitted(design), lender.name),
    ...savingsProblems(quoted.system),
  ];
  if (problems.length > 0) {
    return { mode: "api", lenderName: lender.name, ready: false, problems };
  }

  const money = await loadMoney(leadId, companyId);
  if (money.problem) {
    return { mode: "api", lenderName: lender.name, ready: false, problems: [money.problem] };
  }

  return {
    mode: "api",
    lenderName: lender.name,
    ready: true,
    payload: buildAmosPayload(design.lead, asSubmitted(design), {
      productSlug: lender.apiProductSlug,
      externalId: lenderReference(design.id, design.lenderSubmissionAttempt),
      amountCents: money.amountCents,
      termMonths: money.termMonths,
      salesRepName: repName(design.lead.assignedRep) ?? fallbackRepName,
      // The rep answers this at the moment of sending; the panel labels it.
      ownerOccupied: true,
      delivery: "in_person",
      system: quoted.system!,
    }),
  };
}

/**
 * Ask the lender whether this deal would be accepted, WITHOUT sending it.
 *
 * Their validation endpoint creates nothing — no application, no credit file,
 * no email to the household — so this is safe to press as often as anybody
 * likes, which is the whole reason it is worth having. See `validateWithAmos`.
 *
 * A deal that our OWN preflight refuses never reaches them: those problems are
 * already the answer, and asking a partner to confirm what we can see from here
 * is a request nobody needs to make.
 */
export type LenderCheckResult =
  | { ok: true; lenderName: string; valid: boolean; problems: string[] }
  | { ok: false; error: string };

export async function checkDealWithLender(
  leadId: string,
  companyId: string,
  fallbackRepName: string,
): Promise<LenderCheckResult> {
  const preview = await readLenderPayloadPreview(leadId, companyId, fallbackRepName);
  if (preview.mode === "link") {
    return { ok: false, error: "This deal's lender is not set up for direct submission." };
  }
  if (!preview.ready) {
    return { ok: true, lenderName: preview.lenderName, valid: false, problems: preview.problems };
  }

  const design = await loadDesign(leadId, companyId);
  const lender = design?.lender;
  const apiKey = decryptField(lender?.apiKeyEncrypted);
  if (!lender?.apiBaseUrl || !apiKey) {
    return { ok: false, error: "This lender has no usable API credentials." };
  }

  try {
    const result: AmosValidation = await validateWithAmos(
      { baseUrl: lender.apiBaseUrl, apiKey },
      preview.payload,
    );
    return {
      ok: true,
      lenderName: lender.name,
      valid: result.valid,
      // Their field paths carried through: "system.estMonthlySaving" is the
      // difference between a rep fixing the right number and guessing.
      problems: result.problems.map((p) => (p.field ? `${p.field}: ${p.message}` : p.message)),
    };
  } catch (e) {
    if (e instanceof AmosSubmissionError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not reach the lender to check this deal." };
  }
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

  const quoted = await loadQuoted(leadId, companyId);

  const problems = [
    ...preflightAmosSubmission(design.lead, submitted, lender.name),
    ...savingsProblems(quoted.system),
  ];
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
    // Non-null by construction: `savingsProblems(null)` returns a problem, and
    // a non-empty problem list has already returned above.
    system: quoted.system!,
  });

  const log = (row: Omit<SubmissionLog, "payload">) =>
    recordSubmission(companyId, leadId, lender, payload, fallbackRepName, row);

  try {
    const result = await submitToAmos({ baseUrl: lender.apiBaseUrl, apiKey }, payload);
    await log({
      ok: true,
      status: 201,
      code: null,
      message: null,
      referenceNumber: result.referenceNumber,
      applicationId: result.applicationId,
    });
    return {
      ok: true,
      referenceNumber: result.referenceNumber,
      customerUrl: result.customerUrl,
      sentTo: result.sentTo,
      lenderName: lender.name,
    };
  } catch (e) {
    if (e instanceof AmosSubmissionError) {
      await log({
        ok: false,
        status: e.status ?? null,
        code: e.code,
        message: e.message,
        referenceNumber: null,
        applicationId: null,
      });
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
    // The row records that an attempt was made and that nobody knows what
    // happened to it — which is exactly the state somebody has to reconcile
    // against the lender's portal.
    await log({
      ok: false,
      status: null,
      code: "unexpected",
      message: "An unexpected error occurred; see the server log.",
      referenceNumber: null,
      applicationId: null,
    });
    // Never surface an unexpected error verbatim: it can carry a connection
    // string or another company's identifiers.
    return fail(
      "Something went wrong sending this deal. Re-sending the same deal is safe.",
      "transient",
    );
  }
}

type SubmissionLog = {
  payload: AmosApplicationPayload;
  ok: boolean;
  status: number | null;
  code: string | null;
  message: string | null;
  referenceNumber: string | null;
  applicationId: string | null;
};

/**
 * The record of one attempt, written whatever the outcome.
 *
 * NEVER LET THE BOOKKEEPING COST THE APPLICATION. By the time this runs the
 * deal is already with the lender — or already refused by them — and neither
 * fact changes because a log row would not insert. Same rule the qualify event
 * beside it follows.
 *
 * The API key is not in `payload` and cannot be: it travels as an HTTP header
 * and this column is written from the payload object, never from the request.
 */
async function recordSubmission(
  companyId: string,
  leadId: string,
  lender: { id: string; name: string },
  payload: AmosApplicationPayload,
  actorName: string,
  row: Omit<SubmissionLog, "payload">,
) {
  try {
    await prisma.solarLenderSubmission.create({
      data: {
        companyId,
        leadId,
        lenderId: lender.id,
        lenderName: lender.name,
        externalId: payload.externalId,
        request: payload as unknown as Prisma.InputJsonValue,
        ok: row.ok,
        status: row.status,
        code: row.code,
        message: row.message,
        referenceNumber: row.referenceNumber,
        applicationId: row.applicationId,
        actorName,
      },
    });
  } catch (e) {
    console.error("[lender-submit] could not record the attempt", e);
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
 * THE SAVINGS ANALYSIS, READ OFF THE DOCUMENT THE CUSTOMER WAS SHOWN.
 *
 * Same source and same reasoning as the money above: the live proposal's frozen
 * snapshot, never the pricing rows. A rep re-pricing a deal mid-application
 * cannot move what has already been submitted, and the lender is told what the
 * sheet in the household's hands says rather than what the database says now.
 *
 * Superseded versions are excluded exactly as `quotedFromProposal` excludes
 * them: a replaced document describes a system this deal is no longer written
 * at, and its saving is the saving of a different quote.
 *
 * NO FALLBACK TO THE LIVE ROWS, deliberately. There is no live savings model to
 * fall back TO — the comparison is worked out at generation and frozen — so the
 * alternative would be inventing a second arithmetic for a figure that lands on
 * a credit application. A deal with no document is refused instead, in words a
 * rep can act on. See `savingsProblems`.
 *
 * Returns null when nothing can be resolved, which that function turns into the
 * blocking problem.
 */
async function loadQuoted(
  leadId: string,
  companyId: string,
): Promise<{ system: AmosSystemFigures | null }> {
  const live = await prisma.solarProposal.findFirst({
    where: { leadId, companyId, supersededAt: null },
    orderBy: { version: "desc" },
    select: { snapshot: true },
  });
  const snapshot = live?.snapshot as
    | {
        system?: { year1ProductionKwh?: unknown };
        energy?: { annualUsageKwh?: unknown };
        assumptions?: { currentRateMillsPerKwh?: unknown };
        savings?: SavingsModel;
      }
    | null
    | undefined;
  if (!snapshot?.savings) return { system: null };

  const avoided = year1UtilityAvoided(snapshot.savings);
  if (avoided == null) return { system: null };

  return {
    system: {
      annualProductionKwh: num(snapshot.system?.year1ProductionKwh),
      annualConsumptionKwh: num(snapshot.energy?.annualUsageKwh),
      retailRateMillsPerKwh: num(snapshot.assumptions?.currentRateMillsPerKwh),
      annualUtilityAvoidedCents: avoided,
    },
  };
}

/**
 * A snapshot's own value, or zero.
 *
 * A JSON column is `unknown` however carefully it was written, and the fields
 * read here have all been added over time — an older document is missing some
 * of them. Zero is the honest reading of "this document does not say", and
 * `savingsProblems` refuses every one of these figures at zero rather than
 * sending it.
 */
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Year one's avoided utility cost, defended against a hand-written snapshot.
 *
 * `year1UtilityAvoidedCents` is the arithmetic and lives with the savings
 * model; this is the part that cannot trust its input, because the input is a
 * JSON column that has held eight schema versions.
 */
function year1UtilityAvoided(savings: SavingsModel): number | null {
  const y1 = Array.isArray(savings.years) ? savings.years[0] : null;
  if (!y1 || typeof y1.utilityCostCents !== "number") return null;
  return Math.round(y1.utilityCostCents - postSolarUtilityCents(y1));
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
