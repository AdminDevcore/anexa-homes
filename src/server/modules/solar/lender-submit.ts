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
import { postSolarUtilityCents, type SavingsModel, type SavingsYear } from "@/lib/solar-proposal";
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

  const quoted = await loadQuoted(
    leadId,
    companyId,
    lender.submissionSavingBasis,
    lender.submissionSavingHorizon,
  );

  // Both sets at once. A rep who fixes the panel mapping only to be told about
  // the missing rate has been sent round the loop twice for one visit.
  const problems = [
    ...preflightAmosSubmission(design.lead, asSubmitted(design), lender.name),
    ...savingsProblems(quoted.system),
  ];
  if (problems.length > 0) {
    return { mode: "api", lenderName: lender.name, ready: false, problems };
  }

  const money = await loadMoney(leadId, companyId, lender.submissionAmountBasis);
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
  /**
   * Whoever is looking. Both callers are a signed-in rep, so this is the
   * SUBMITTER as well as the fallback — a partner set to `submitter` previews
   * the name it would really be sent.
   */
  fallbackRepName: string,
): Promise<LenderPayloadPreview> {
  const design = await loadDesign(leadId, companyId);
  if (!design?.lender) return { mode: "link" };

  const { lender } = design;
  if (!lender.apiBaseUrl || !lender.apiKeyEncrypted || !lender.apiProductSlug) {
    return { mode: "link" };
  }

  const quoted = await loadQuoted(
    leadId,
    companyId,
    lender.submissionSavingBasis,
    lender.submissionSavingHorizon,
  );
  const problems = [
    ...preflightAmosSubmission(design.lead, asSubmitted(design), lender.name),
    ...savingsProblems(quoted.system),
  ];
  if (problems.length > 0) {
    return { mode: "api", lenderName: lender.name, ready: false, problems };
  }

  const money = await loadMoney(leadId, companyId, lender.submissionAmountBasis);
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
      salesRepName: resolveRepName(
        lender.submissionRepNameBasis,
        lender.submissionRepName,
        design.lead.assignedRep,
        fallbackRepName,
        fallbackRepName,
      ),
      // The rep answers this at the moment of sending; the panel labels it.
      ownerOccupied: true,
      delivery: lender.submissionDelivery,
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
   * Used only when the deal has no assigned rep of its own.
   *
   * DISTINCT FROM THE SUBMITTER, which is why they are two fields. On the
   * customer's own door nobody at the company pressed anything, and the
   * fallback there is the company's name — sending that as "the person who
   * submitted this" would name a homeowner's own click as a salesperson.
   */
  fallbackRepName: string;
  /**
   * Who pressed the button, where somebody at the company did. Null on the
   * customer's door. Read only by a partner set to `submitter`; see
   * `resolveRepName`.
   */
  submitterName?: string | null;
};

export async function submitDealToLender(input: LenderSubmitInput): Promise<LenderSubmitResult> {
  const { leadId, companyId, ownerOccupied, fallbackRepName, submitterName = null } = input;

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

  const quoted = await loadQuoted(
    leadId,
    companyId,
    lender.submissionSavingBasis,
    lender.submissionSavingHorizon,
  );

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

  const money = await loadMoney(leadId, companyId, lender.submissionAmountBasis);
  if (money.problem) return fail(money.problem);

  const payload = buildAmosPayload(design.lead, submitted, {
    productSlug: lender.apiProductSlug,
    externalId: lenderReference(design.id, design.lenderSubmissionAttempt),
    amountCents: money.amountCents,
    termMonths: money.termMonths,
    // Whichever name THIS partner reconciles against — see `resolveRepName`.
    salesRepName: resolveRepName(
      lender.submissionRepNameBasis,
      lender.submissionRepName,
      design.lead.assignedRep,
      submitterName,
      fallbackRepName,
    ),
    ownerOccupied,
    // The partner's own rule about who completes the application, not the
    // caller's preference. Both doors used to state `in_person` and neither
    // could be told otherwise.
    delivery: lender.submissionDelivery,
    // Non-null by construction: `savingsProblems(null)` returns a problem, and
    // a non-empty problem list has already returned above.
    system: quoted.system!,
  });

  const log = (row: Omit<SubmissionLog, "payload">) =>
    recordSubmission(
      companyId, leadId, lender, payload, fallbackRepName,
      // Recorded, not inferred: the lender's settings can be changed afterwards,
      // and "what did we ask them to fund, and on what basis" has to stay
      // answerable about THIS attempt. The saving needs both halves — the same
      // $2,900 is a different claim in year one than averaged over thirty.
      lender.submissionAmountBasis,
      `${lender.submissionSavingBasis}/${lender.submissionSavingHorizon}`,
      row,
    );

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
  amountBasis: string,
  savingBasis: string,
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
        amountBasis,
        savingBasis,
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
async function loadMoney(leadId: string, companyId: string, basis: AmountBasis) {
  const quoted = await quotedFromProposal(leadId, companyId, basis);
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
  savingBasis: SavingBasis,
  savingHorizon: SavingHorizon,
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

  const avoided = savingOnBasis(snapshot.savings, savingBasis, savingHorizon);
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

/** What a partner means by "estimated saving". */
export type SavingBasis = "utility_avoided" | "net_of_payment";

/** Which year of a decades-long comparison that saving describes. */
export type SavingHorizon = "year_one" | "term_average";

/**
 * ONE YEAR'S SAVING, on the basis this partner underwrites.
 *
 * `utility_avoided` is the electricity bill that stops arriving.
 * `net_of_payment` goes on to subtract what the system costs the household
 * that year, which on a thirty-year loan is routinely NEGATIVE — a true figure
 * that a partner whose amount pattern has no minus sign cannot accept.
 * `savingsProblems` refuses it rather than sending it, and the settings screen
 * says so beside the option.
 *
 * Returns null for a row the document cannot answer from, which is how an
 * average knows to give up rather than to divide by a smaller number than it
 * counted.
 */
function savingInYear(y: SavingsYear, basis: SavingBasis): number | null {
  if (!y || typeof y.utilityCostCents !== "number") return null;

  // OPT IN EXPLICITLY. Anything that is not the net reading is the avoided
  // one — the safe default, and the only one most partners can accept. Netting
  // must never be what an unrecognised value falls through to: it is the branch
  // that produces a negative figure and blocks the deal.
  if (basis !== "net_of_payment") return y.utilityCostCents - postSolarUtilityCents(y);

  // What solar costs the household that year, read off the row rather than
  // rebuilt: the payment, the fee, the battery programme and any credit relief
  // are already netted into it by the model that priced the document.
  const solarCost = typeof y.solarCostCents === "number" ? y.solarCostCents : 0;
  return y.utilityCostCents - solarCost;
}

/**
 * The saving this partner is told, on its basis and over its horizon.
 *
 * TWO SETTINGS, ONE SUBTRACTION. The basis decides what comes off the utility
 * bill; the horizon decides over how many years the same subtraction is read.
 * `term_average` is emphatically not a second arithmetic — it is `savingInYear`
 * applied to every row the document froze instead of only the first, which is
 * why a proposal priced before the meter fee existed still reports the figure
 * it was priced at in both readings. Averaging a stored total would have been
 * one line shorter and would have bypassed `postSolarUtilityCents`.
 *
 * WHY THE HORIZON IS A PARTNER'S CHOICE. The comparison runs for the life of
 * the loan and the utility side escalates every year, so year one is the
 * SMALLEST of thirty true answers. A partner whose form asks what the household
 * saves "per year" over the term means the average; one testing a first-year
 * minimum means year one. Only they know which.
 *
 * FAILS SAFE TO YEAR ONE, in every direction: an unrecognised horizon, an
 * empty or absent year list, a row the document cannot answer from. That is
 * both the figure every submission carried before this existed and the smaller
 * one — and overstating a saving on a credit application is the direction that
 * does harm.
 *
 * This is the part that cannot trust its input: the input is a JSON column that
 * has held eight schema versions.
 */
function savingOnBasis(
  savings: SavingsModel,
  basis: SavingBasis,
  horizon: SavingHorizon,
): number | null {
  const years = Array.isArray(savings.years) ? savings.years : [];
  const y1 = years[0] ? savingInYear(years[0], basis) : null;
  if (y1 == null) return null;
  if (horizon !== "term_average") return Math.round(y1);

  // Every year or none. A horizon averaged over the rows that happened to parse
  // is a figure with no stated meaning, and the document that could not answer
  // for year seventeen is exactly the one nobody should be averaging.
  const each = years.map((y) => savingInYear(y, basis));
  if (each.length === 0 || each.some((v) => v == null)) return Math.round(y1);

  const total = each.reduce((n: number, v) => n + (v as number), 0);
  return Math.round(total / each.length);
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
async function quotedFromProposal(leadId: string, companyId: string, basis: AmountBasis) {
  const live = await prisma.solarProposal.findFirst({
    where: { leadId, companyId, supersededAt: null },
    orderBy: { version: "desc" },
    select: { snapshot: true },
  });
  const financing = (live?.snapshot as { financing?: Record<string, unknown> } | null)?.financing;
  if (!financing) return null;

  const amountCents = amountOnBasis(financing, basis);
  const termMonths = financing.loanTermMonths;
  if (typeof amountCents !== "number" || amountCents <= 0) return null;
  if (typeof termMonths !== "number" || termMonths <= 0) return null;

  return { amountCents, termMonths };
}

/**
 * A snapshot money figure, or null when the document does not carry one.
 *
 * Distinct from `num` above, which reports a missing figure as zero: for the
 * system figures that is the honest reading and `savingsProblems` refuses it,
 * but an AMOUNT of zero and an amount the document never stated are different
 * facts, and only one of them may fall back to the contract value.
 */
function cents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Which of a document's several true amounts this partner underwrites. */
export type AmountBasis = "contract_value" | "customer_obligation" | "after_credits";

/**
 * THE FIGURE THE PARTNER'S PAPER IS WRITTEN AT.
 *
 * Every branch reads the FROZEN document, never the live rows, so the answer is
 * the one on the sheet in the household's hands whichever basis a partner uses.
 *
 * `contract_value` is what every submission sent before this was configurable,
 * and is the fallback for each of the others: a document that cannot express
 * the requested basis reports the contract value rather than guessing, and the
 * caller's preflight is what refuses a figure that came out at zero.
 */
function amountOnBasis(financing: Record<string, unknown>, basis: AmountBasis): number | null {
  const contract = cents(financing.financedAmountCents);
  if (contract == null) return null;

  if (basis === "customer_obligation") {
    // Only a partner with a programme contribution has two numbers here. On
    // every other deal the obligation IS the contract value, and the absent
    // block is the document saying so rather than failing to mention it.
    const adj = financing.lenderAdjustment as { customerObligationCents?: unknown } | null;
    return cents(adj?.customerObligationCents) ?? contract;
  }

  if (basis === "after_credits") {
    // The credits the document actually quotes, summed off the ladder rather
    // than recomputed: a rate applied here would diverge from the page the
    // household read the moment either changed. A document quoting none
    // subtracts nothing.
    const ladder = financing.creditLadder as { credits?: { amountCents?: unknown }[] } | null;
    const credits = (ladder?.credits ?? []).reduce((n, c) => n + (cents(c.amountCents) ?? 0), 0);
    return contract - credits;
  }

  // EVERY OTHER VALUE IS THE CONTRACT VALUE, including one this build does not
  // recognise. The fallback has to be the figure that has always been sent and
  // is right for almost every partner — an unknown basis quietly resolving to
  // one of the smaller readings would understate a credit application, and a
  // column can outlive the code that understands it.
  return contract;
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

/** Whose name this partner wants on the application as the seller. */
export type RepNameBasis = "deal_rep" | "submitter" | "fixed";

/**
 * THE NAME ON THE APPLICATION, and it is not the same person to every partner.
 *
 * The lender takes a typed name and reconciles it on their side, which is why
 * this matters more than it looks: a partner matching against its own approved
 * roster refuses an application naming somebody not on it, and a partner
 * matching against its portal logins refuses one naming somebody who has none.
 * Both refusals arrive as a generic decline days later.
 *
 *   deal_rep   the rep the deal is assigned to, falling back to whoever caused
 *              this submission. EXACTLY what was sent before this existed, and
 *              what every partner keeps until somebody changes it.
 *   submitter  the person who pressed the button, whatever the deal says. On
 *              the customer's own door nobody at the company pressed anything,
 *              so this reads as `deal_rep` there rather than naming a homeowner
 *              as the seller.
 *   fixed      one registered dealer contact, every time.
 *
 * FAILS SAFE TO `deal_rep` — on an unrecognised basis, and on a `fixed`
 * partner whose name nobody has typed. An empty `salesRepName` is a field the
 * lender rejects the whole application over, so a blank box must never become
 * one; it falls through to the name that has always been sent instead.
 */
function resolveRepName(
  basis: RepNameBasis,
  fixedName: string | null,
  assignedRep: { firstName: string; lastName: string } | null,
  submitterName: string | null,
  fallbackRepName: string,
): string {
  const dealRep = () => repName(assignedRep) ?? fallbackRepName;

  if (basis === "fixed") {
    const typed = (fixedName ?? "").trim();
    return typed.length > 0 ? typed : dealRep();
  }
  if (basis === "submitter") {
    const pressed = (submitterName ?? "").trim();
    return pressed.length > 0 ? pressed : dealRep();
  }
  return dealRep();
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
          // WHICH FIGURE THIS PARTNER UNDERWRITES, and what it means by a
          // saving. Facts about the partner, so they travel with the lender row
          // exactly as its key does.
          submissionAmountBasis: true,
          submissionSavingBasis: true,
          submissionSavingHorizon: true,
          // Whose name goes on it, and whether a rep may hand their device
          // over. Facts about the partner for the same reason.
          submissionRepNameBasis: true,
          submissionRepName: true,
          submissionDelivery: true,
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
