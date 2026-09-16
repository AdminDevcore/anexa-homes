/**
 * THE BANK FEED PROVIDER INTERFACE.
 *
 * Everything that talks to a bank sits behind this, selected by
 * `BANK_FEED_PROVIDER`. Tests use the fixture and never reach the network, so
 * the whole ingest path — cursor paging, dedupe, the review queue, transfer
 * pairing — is exercised without credentials.
 *
 * ── THE SIGN CONVENTION, WHICH IS THE TRAP ──────────────────────────────────
 * `amountCents` here is SIGNED FROM THE ACCOUNT HOLDER'S POINT OF VIEW:
 *
 *     negative = money LEFT the account (a purchase, a payment out)
 *     positive = money ARRIVED (a deposit, a refund)
 *
 * Plaid does the opposite: it reports a positive amount for money leaving a
 * depository account. A provider adapter MUST flip it, and `plaid.ts` does so in
 * exactly one place. Getting this backwards does not crash and does not fail to
 * balance — it silently books every expense as income, so the P&L inverts while
 * every individual entry still looks perfectly ordinary. The fixture provider
 * deliberately includes both directions so a test would catch the flip.
 *
 * Amounts are integer cents everywhere. Providers quote decimal strings or
 * floats; conversion happens inside the adapter, never above it.
 */

export type BankFeedProviderId = "plaid" | "fixture";

/** What kind of account this is, in OUR vocabulary rather than the provider's. */
export type ProviderAccountKind = "checking" | "savings" | "credit_card" | "other";

export type ProviderAccount = {
  /** Stable id at the provider. Unique within a connection, not globally. */
  providerAccountId: string;
  name: string;
  officialName: string | null;
  /** Last four, when the provider discloses it. */
  mask: string | null;
  kind: ProviderAccountKind;
  /**
   * Balances as the BANK sees them, which is not the book balance: pending
   * authorisations, float and anything we have posted but the bank has not.
   * Shown beside the book balance during reconciliation, never substituted for
   * it.
   */
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  currency: string;
};

export type ProviderTransaction = {
  /** Stable id at the provider — the dedupe key for the whole ingest. */
  providerTransactionId: string;
  providerAccountId: string;
  /** The date the bank posted it. Reconciliation matches on this, not on ours. */
  postedAt: Date;
  /** SIGNED cents, account holder's view. Negative left the account. */
  amountCents: number;
  description: string;
  merchantName: string | null;
  /**
   * A pending row can change or vanish entirely. It is ingested so the review
   * queue can show it, but it is never posted to the journal: posting a pending
   * authorisation books money that may never move.
   */
  pending: boolean;
  /** The provider's category guess. ADVISORY ONLY — never auto-posts an account. */
  category: string[];
  checkNumber: string | null;
  currency: string;
};

/**
 * One page of a cursor sync.
 *
 * `removed` matters more than it looks: a bank can retract a transaction it
 * already reported. If we have posted a journal entry from it, that entry must
 * be voided by reversal rather than deleted, like every other void.
 */
export type SyncPage = {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removed: string[];
  /** Pass back on the next call. Null means the provider has no cursor yet. */
  cursor: string | null;
  hasMore: boolean;
};

export type LinkToken = { linkToken: string; expiresAt: Date | null };

export type ExchangeResult = {
  /** SECRET. Encrypted at rest with FINANCE_ENC_KEY; never logged, never returned to a client. */
  accessToken: string;
  /** The provider's id for the connection ("item" at Plaid). */
  providerItemId: string;
  institutionId: string | null;
  institutionName: string | null;
};

/**
 * The result of verifying an inbound webhook, over the RAW body.
 *
 * `eventId` is what the receiver dedupes on. When a provider does not supply
 * one, the adapter derives a stable key from the payload rather than letting
 * the caller invent one — an at-least-once delivery with no dedupe key is a
 * duplicate waiting to happen.
 */
export type WebhookVerification =
  | {
      ok: true;
      eventId: string;
      providerItemId: string | null;
      /** The provider's event name, e.g. "SYNC_UPDATES_AVAILABLE". */
      code: string;
      payload: Record<string, unknown>;
    }
  | { ok: false; error: string };

export interface BankFeedProvider {
  readonly id: BankFeedProviderId;

  /** Token that opens the provider's connect widget in the browser. */
  createLinkToken(args: { companyId: string; userId: string; webhookUrl: string | null }): Promise<LinkToken>;

  /**
   * Token for RECONNECTING an existing connection whose credentials expired.
   * A different call at Plaid, and the reason a broken feed can be repaired
   * without losing the connection's history.
   */
  createUpdateLinkToken(args: { accessToken: string; webhookUrl: string | null }): Promise<LinkToken>;

  /** Exchange the short-lived public token from the widget for a durable one. */
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>;

  listAccounts(accessToken: string): Promise<ProviderAccount[]>;

  /**
   * One page of changes since `cursor`. The caller loops while `hasMore`,
   * persisting the cursor after each page so an interrupted sync resumes
   * instead of restarting.
   */
  syncTransactions(args: { accessToken: string; cursor: string | null }): Promise<SyncPage>;

  /** Verify an inbound webhook over the raw bytes. Never over a re-serialised object. */
  verifyWebhook(args: { rawBody: string; headers: Headers }): Promise<WebhookVerification>;

  /** Best-effort revocation at the provider when a connection is removed. */
  removeConnection(accessToken: string): Promise<void>;
}

/** How many days of history to pull on a new connection. */
export const HISTORY_DAYS = 730;
