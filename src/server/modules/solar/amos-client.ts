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

/**
 * Strip anything an HTTP header cannot carry.
 *
 * A key pasted out of a terminal arrives with the shell's prompt glyph on the
 * front — "❯", U+276F — and that one character makes the Authorization header
 * impossible to encode, so `fetch` throws before a request is ever sent.
 *
 * Stripping rather than refusing is correct here, and is not papering over a
 * corrupt value: a byte outside printable ASCII CANNOT be part of a working
 * credential, because no such key could ever be sent. Removing it recovers
 * exactly the key the lender issued. Keys already stored with the glyph — the
 * reason this exists — therefore start working without anyone re-pasting.
 *
 * `setSolarLenderApiKeyAction` still refuses one at paste time, where the
 * person can see what they pasted. This is the belt to that's braces.
 */
function headerSafeKey(apiKey: string): { key: string; stripped: number } {
  const key = apiKey.replace(/[^\x20-\x7e]/g, '').trim()
  return { key, stripped: [...apiKey].length - [...key].length }
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
  const url = applicationsUrl(creds.baseUrl)

  // The host, for the error a human reads. Named separately because a
  // malformed address is the single most common cause of a failure here, and
  // "could not reach the lender" without saying WHICH address was tried sends
  // an admin looking at their firewall instead of at the typo they made.
  let host: string
  try {
    host = new URL(url).host
  } catch {
    throw new AmosSubmissionError(
      'network_error',
      `"${creds.baseUrl}" is not a valid API address. Fix it in Settings → Lenders → Direct submission.`,
    )
  }

  const { key, stripped } = headerSafeKey(creds.apiKey)
  if (stripped > 0) {
    // Worth a line: the stored credential is grubby even though the request
    // will now succeed, and an admin should re-paste it cleanly at some point.
    console.warn('[amos-client] stripped characters an HTTP header cannot carry from the API key', {
      host,
      stripped,
    })
  }
  if (!key) {
    throw new AmosSubmissionError(
      'unauthorized',
      'No usable API key is configured for this lender. Add one in Settings → Lenders → Direct submission.',
    )
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        // Never logged, never echoed into an error — see the test that asserts
        // the key cannot appear in a thrown error's message or stack.
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (cause) {
    // The underlying reason, on the server only. Swallowing it entirely — as
    // this did — turns every DNS typo, TLS failure and refused connection into
    // one indistinguishable message, and leaves nothing behind to diagnose
    // from. The rep still sees the friendly sentence below.
    console.error('[amos-client] submission fetch failed', {
      host,
      cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      // Node puts the useful part here: ENOTFOUND, ECONNREFUSED, CERT_HAS_EXPIRED.
      code: (cause as { cause?: { code?: string } })?.cause?.code ?? null,
    })

    const reason = (cause as { cause?: { code?: string } })?.cause?.code
    const hint =
      reason === 'ENOTFOUND'
        ? ` The address "${host}" does not resolve — check it in Settings → Lenders → Direct submission.`
        : reason === 'ECONNREFUSED'
          ? ` Nothing is answering at "${host}".`
          : reason === 'CERT_HAS_EXPIRED' || reason === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
            ? ` The certificate at "${host}" could not be verified.`
            : ''

    throw new AmosSubmissionError(
      'network_error',
      `Could not reach ${host}.${hint} Re-sending the same deal is safe.`,
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

    // A REJECTION is not a crash, so it used to pass silently to the toast and
    // nowhere else — which meant the only record of why a deal was refused
    // lived on a screen someone had already closed. The lender's own logs are
    // not always reachable from here; ours are.
    console.error('[amos-client] submission rejected by the lender', {
      host,
      status: res.status,
      code,
      message,
      details: err?.details ?? null,
      // Which deal, so a refusal can be traced back without guessing.
      externalId: payload.externalId,
    })

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
