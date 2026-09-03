import type { AmosApplicationPayload } from './amos-payload'

/**
 * The network call to a lender's partner API.
 *
 * Deliberately thin and deliberately NOT retrying. The submission is
 * idempotent on `externalId`, so a retry is safe — but it is the rep's to
 * make, in front of the customer, with the error on screen. A silent retry
 * loop inside a click handler turns a five-second failure into a thirty-second
 * one and tells nobody why.
 */

export type AmosCredentials = {
  /** e.g. "https://admin.amoscapitalfund.com" — trailing slash tolerated. */
  baseUrl: string
  apiKey: string
}

export type AmosSubmissionResult = {
  applicationId: string
  referenceNumber: string
  /** Present only for an in-person handoff. */
  customerUrl: string | null
  /** Where the lender emailed the link. */
  sentTo: string
  expiresAt: string
}

/**
 * Codes the lender documents. `network_error` and `bad_response` are ours, for
 * the cases where we never got a documented answer at all.
 */
type AmosErrorCode =
  | 'unauthorized'
  | 'key_revoked'
  | 'key_expired'
  | 'company_not_active'
  | 'invalid_request'
  | 'unknown_product'
  | 'unknown_equipment'
  | 'state_not_supported'
  | 'rate_limited'
  | 'conflict'
  | 'internal_error'
  | 'network_error'
  | 'bad_response'

/** Codes that mean "the integration is misconfigured", not "this deal is wrong". */
const CONFIG_PROBLEM_CODES = new Set<AmosErrorCode>([
  'unauthorized',
  'key_revoked',
  'key_expired',
  'company_not_active',
  'unknown_product',
])

export class AmosSubmissionError extends Error {
  constructor(
    readonly code: AmosErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AmosSubmissionError'
  }

  /**
   * True when a rep can do nothing about it and an admin must fix the lender's
   * settings. The UI says "contact your administrator" rather than offering a
   * retry that cannot succeed.
   */
  get isConfigProblem(): boolean {
    return CONFIG_PROBLEM_CODES.has(this.code)
  }
}

function applicationsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/partner/applications`
}

/** Append the offending items to the message so a rep can act without a log. */
function withDetails(message: string, details: unknown): string {
  if (!Array.isArray(details) || details.length === 0) return message
  const named = details
    .map((d) =>
      d && typeof d === 'object'
        ? Object.values(d as Record<string, unknown>)
            .filter((v) => typeof v === 'string')
            .join(' ')
        : String(d),
    )
    .filter(Boolean)
  return named.length > 0 ? `${message} (${named.join('; ')})` : message
}

export async function submitToAmos(
  creds: AmosCredentials,
  payload: AmosApplicationPayload,
): Promise<AmosSubmissionResult> {
  let res: Response
  try {
    res = await fetch(applicationsUrl(creds.baseUrl), {
      method: 'POST',
      headers: {
        // Never logged, never echoed into an error — see the test that asserts
        // the key cannot appear in a thrown error's message or stack.
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new AmosSubmissionError(
      'network_error',
      'Could not reach the lender. Check your connection and try again — re-sending the same deal is safe.',
    )
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new AmosSubmissionError(
      'bad_response',
      `The lender returned an unreadable response (HTTP ${res.status}). Try again in a moment.`,
      res.status,
    )
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } })?.error
    const code = (err?.code ?? 'bad_response') as AmosErrorCode
    const message = err?.message ?? `The lender rejected the submission (HTTP ${res.status}).`
    throw new AmosSubmissionError(code, withDetails(message, err?.details), res.status, err?.details)
  }

  const ok = body as Partial<AmosSubmissionResult>
  if (!ok.applicationId || !ok.referenceNumber) {
    throw new AmosSubmissionError(
      'bad_response',
      'The lender accepted the deal but returned no reference number. Check their portal before re-sending.',
      res.status,
    )
  }

  return {
    applicationId: ok.applicationId,
    referenceNumber: ok.referenceNumber,
    customerUrl: ok.customerUrl ?? null,
    sentTo: ok.sentTo ?? '',
    expiresAt: ok.expiresAt ?? '',
  }
}
