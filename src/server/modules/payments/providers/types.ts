/**
 * THE ACH PROVIDER BOUNDARY.
 *
 * Everything here is plain data. The interface deliberately knows nothing about
 * Prisma, our models, or our ledger — a provider's job is to move money and
 * report what happened to it, and letting `Payment` leak across this line would
 * make swapping providers a change to the books rather than a change to an
 * adapter.
 *
 * `docs/ach-provider-comparison.md` explains which provider to choose and why
 * nothing is blocked on choosing one: `ACH_PROVIDER` selects the
 * implementation, defaults to the fixture, and every test runs against the
 * fixture.
 *
 * ── BANK DETAILS ARE DECRYPTED AT THE CALL SITE ─────────────────────────────
 * `TransferRequest` carries a real routing and account number, because the
 * provider genuinely needs them. They are decrypted immediately before the call
 * and must never be logged, serialised into an error, or stored anywhere but
 * the encrypted columns they came from.
 */

export type AchProviderId = "fixture" | "plaid" | "dwolla";

export type AchAccountType = "checking" | "savings";

/**
 * The lifecycle of an ACH payment, as the books need to understand it.
 *
 * `returned` is the one that matters and the one a naive integration forgets:
 * ACH can bounce DAYS after it looked successful — insufficient funds, a closed
 * account, a wrong number — so "sent" is never the end of the story and a
 * payment is not safely done until it settles.
 */
export type TransferStatus = "pending" | "sent" | "settled" | "returned" | "failed";

export type TransferRequest = {
  /**
   * OUR payment id, used as the provider's idempotency key.
   *
   * This is the single most important field here. A network timeout on a send
   * is indistinguishable from a success, and a retry without a key pays the
   * vendor twice. Keying on our own id means a retry is the same request.
   */
  idempotencyKey: string;
  amountCents: number;
  routingNumber: string;
  accountNumber: string;
  accountType: AchAccountType;
  payeeName: string;
  memo?: string | null;
};

export type TransferResult =
  | { ok: true; providerTransferId: string; status: TransferStatus }
  | {
      ok: false;
      error: string;
      /**
       * Whether trying again could succeed. A timeout is retryable; "account
       * closed" is not. Retrying a non-retryable failure forever is how a
       * queue becomes a denial-of-service against your own provider.
       */
      retryable: boolean;
    };

/**
 * What a verified webhook tells us.
 *
 * `eventId` is required because dedupe is by event id: providers redeliver, and
 * an event applied twice moves a payment's status backwards or reverses a
 * reversal.
 */
export type WebhookEvent = {
  eventId: string;
  kind: string;
  /** Null when the event is not about a specific transfer. */
  providerTransferId: string | null;
  status: TransferStatus | null;
  returnCode?: string | null;
  returnReason?: string | null;
  payload: Record<string, unknown>;
};

export type WebhookVerification = { ok: true; event: WebhookEvent } | { ok: false; error: string };

export interface AchProvider {
  readonly id: AchProviderId;

  /** Send money. MUST be idempotent on `idempotencyKey`. */
  send(req: TransferRequest): Promise<TransferResult>;

  /** Ask the provider where a transfer stands. Null if it has never heard of it. */
  getStatus(providerTransferId: string): Promise<TransferStatus | null>;

  /**
   * Verify a webhook's signature over the RAW body and return what it says.
   *
   * The raw body, not the parsed object: re-serialising JSON changes bytes —
   * key order, whitespace, unicode escapes — and the signature is over the
   * bytes the provider sent. Comparisons must be timing-safe.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerification;
}
