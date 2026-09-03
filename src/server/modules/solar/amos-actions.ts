"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { revalidatePath } from "next/cache";
import { decryptField, encryptField, maskTail } from "@/server/lib/crypto";
import { buildAmosPayload, preflightAmosSubmission } from "./amos-payload";
import { submitToAmos, AmosSubmissionError } from "./amos-client";

/**
 * Submitting a deal to a lender that accepts applications over an API.
 *
 * Its own module rather than more of `actions.ts`. Every export of a
 * "use server" file is a callable endpoint, so each one re-establishes who the
 * caller is and scopes every query to their company — a lead id posted from
 * elsewhere must never reach another company's deal, and a lender id from
 * elsewhere must never lend us its credentials.
 *
 * WHAT LEAVES ANEXA
 *
 * Name, contact details, property address, system design and the quoted
 * amount. Never an SSN, never a date of birth, never a consent flag — the
 * authorization to pull credit has to be the customer's own, captured on the
 * lender's page under their disclosures.
 */

const fail = (error: string, kind: FailureKind = "deal") =>
  ({ ok: false as const, error, kind });

/**
 * What a rep should DO about it, which is a different question from what went
 * wrong:
 *   "deal"    — fix the deal and try again (missing email, unmatched panel).
 *   "config"  — nobody on site can fix it; an admin must fix lender settings.
 *   "transient" — try again as-is; re-sending the same deal is safe.
 */
type FailureKind = "deal" | "config" | "transient";

export type AmosSubmitResult =
  | {
      ok: true;
      referenceNumber: string;
      /** Present for an in-person handoff; null when the customer was emailed. */
      customerUrl: string | null;
      sentTo: string;
    }
  | { ok: false; error: string; kind: FailureKind; problems?: string[] };

const submitSchema = z.object({
  leadId: z.string().min(1),
  /** The rep's answer. Anexa does not store this, so it is asked at send time. */
  ownerOccupied: z.boolean(),
  /** `in_person` hands the link back; `customer` emails it and returns nothing. */
  delivery: z.enum(["in_person", "customer"]).default("in_person"),
});

/**
 * Is this deal's lender wired for API submission, and would a send succeed?
 *
 * Read-only, and safe to call on render: the Qualify button uses it to decide
 * between submitting and opening the old link, and to explain itself when the
 * deal is not ready. Reporting the blockers BEFORE the click is the whole
 * point — the alternative is an error in front of a customer.
 */
export type AmosSubmissionSummary = {
  customer: string;
  property: string;
  system: string;
  financing: string;
};

export async function amosSubmissionStatusAction(leadId: string): Promise<
  | { mode: "link" }
  | { mode: "api"; lenderName: string; ready: true; summary: AmosSubmissionSummary }
  | { mode: "api"; lenderName: string; ready: false; problems: string[] }
> {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) return { mode: "link" };

  const design = await loadDesign(leadId, user.companyId);
  if (!design?.lender) return { mode: "link" };

  const { lender } = design;
  if (!lender.apiBaseUrl || !lender.apiKeyEncrypted || !lender.apiProductSlug) {
    return { mode: "link" };
  }

  const problems = preflightAmosSubmission(design.lead, design);
  if (problems.length > 0) {
    return { mode: "api", lenderName: lender.name, ready: false, problems };
  }

  const finance = await prisma.solarFinance.findFirst({
    where: { leadId, companyId: user.companyId },
    select: { contractPriceCents: true, downPaymentCents: true, loanTermMonths: true },
  });
  const amountCents = (finance?.contractPriceCents ?? 0) - (finance?.downPaymentCents ?? 0);
  if (amountCents <= 0 || !finance?.loanTermMonths) {
    return {
      mode: "api",
      lenderName: lender.name,
      ready: false,
      problems: [
        amountCents <= 0
          ? "This deal has no financed amount yet. Price it first."
          : "This deal has no loan term yet. Choose one first.",
      ],
    };
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
      financing: `${usd(amountCents)} over ${finance.loanTermMonths} months`,
    },
  };
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

export async function submitDealToLenderAction(
  input: z.infer<typeof submitSchema>,
): Promise<AmosSubmitResult> {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.", "config");

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { leadId, ownerOccupied, delivery } = parsed.data;

  const design = await loadDesign(leadId, user.companyId);
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

  const problems = preflightAmosSubmission(design.lead, design);
  if (problems.length > 0) {
    return {
      ok: false,
      kind: "deal",
      error: "This deal is missing information the lender requires.",
      problems,
    };
  }

  // The money lives on SolarFinance, not the design. Financed amount is the
  // contract price less anything the customer puts down — the same figure the
  // proposal quotes a payment from, so the lender is asked for exactly what
  // the customer was shown.
  const finance = await prisma.solarFinance.findFirst({
    where: { leadId, companyId: user.companyId },
    select: { contractPriceCents: true, downPaymentCents: true, loanTermMonths: true },
  });
  const amountCents =
    (finance?.contractPriceCents ?? 0) - (finance?.downPaymentCents ?? 0);
  if (amountCents <= 0) {
    return fail("This deal has no financed amount to submit. Price the deal first.");
  }
  if (!finance?.loanTermMonths) {
    return fail("This deal has no loan term to submit. Choose a term first.");
  }

  const payload = buildAmosPayload(design.lead, design, {
    productSlug: lender.apiProductSlug,
    amountCents,
    termMonths: finance.loanTermMonths,
    // The rep on the deal if there is one, otherwise whoever is sending. The
    // lender takes a typed name and maps it to a real login on their side.
    salesRepName: repName(design.lead.assignedRep) ?? user.fullName,
    ownerOccupied,
    delivery,
  });

  try {
    const result = await submitToAmos(
      { baseUrl: lender.apiBaseUrl, apiKey },
      payload,
    );
    return {
      ok: true,
      referenceNumber: result.referenceNumber,
      customerUrl: result.customerUrl,
      sentTo: result.sentTo,
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

/** The deal's rep, as the lender wants it: a typed name, or nothing. */
function repName(rep: { firstName: string; lastName: string } | null): string | null {
  if (!rep) return null;
  const name = `${rep.firstName} ${rep.lastName}`.trim();
  return name.length > 0 ? name : null;
}

/** Everything both entry points read, scoped to the caller's company. */
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
      module: { select: { manufacturer: true, model: true } },
      inverter: { select: { manufacturer: true, model: true } },
      battery: { select: { manufacturer: true, model: true } },
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

/**
 * Store a lender's API key.
 *
 * Its own action, separate from `saveSolarLenderAction`, because a secret must
 * only ever travel INBOUND. A form that edits the key alongside the other
 * fields has to be given the current value to send it back, which means
 * shipping a live credential to a browser on every settings page load. This
 * one takes a key and returns nothing but success.
 */
export async function setSolarLenderApiKeyAction(
  lenderId: string,
  apiKey: string,
): Promise<{ ok: true; masked: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };

  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Paste the key the lender issued you." };
  if (key.length > 200) return { ok: false, error: "That does not look like an API key." };

  /**
   * An HTTP header value can only hold bytes. A key pasted out of a terminal
   * commonly arrives with the shell's prompt glyph on the front — "❯", U+276F —
   * and that single character makes the Authorization header impossible to
   * encode, so `fetch` throws BEFORE any request is sent. The failure then
   * looks exactly like the network being down, which is where a real
   * afternoon went.
   *
   * Refused here, at the moment of pasting, where the person can see what they
   * pasted. `stray` names the offending character so the message is actionable
   * rather than a shrug.
   */
  const stray = [...key].find((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7e);
  if (stray) {
    return {
      ok: false,
      error:
        `That key contains a character it cannot have: "${stray}". ` +
        "It usually means a shell prompt or a line break was copied along with the key. " +
        "Copy just the key itself and paste it again.",
    };
  }

  const lender = await prisma.solarLender.findFirst({
    where: { id: lenderId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lender) return { ok: false, error: "Lender not found." };

  await prisma.solarLender.update({
    where: { id: lender.id },
    data: { apiKeyEncrypted: encryptField(key) },
  });
  revalidatePath("/portal/settings/lenders");

  // The last four, so the person who pasted it can confirm they pasted the
  // right one. Never the whole key again.
  return { ok: true, masked: maskTail(key) };
}

/** Remove a lender's API key. The lender falls back to its link. */
export async function clearSolarLenderApiKeyAction(
  lenderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };

  const lender = await prisma.solarLender.findFirst({
    where: { id: lenderId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lender) return { ok: false, error: "Lender not found." };

  await prisma.solarLender.update({
    where: { id: lender.id },
    data: { apiKeyEncrypted: null },
  });
  revalidatePath("/portal/settings/lenders");
  return { ok: true };
}
