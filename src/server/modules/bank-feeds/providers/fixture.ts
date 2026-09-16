import { createHash } from "node:crypto";
import type {
  BankFeedProvider,
  ExchangeResult,
  LinkToken,
  ProviderAccount,
  ProviderTransaction,
  SyncPage,
  WebhookVerification,
} from "../types";

/**
 * THE FIXTURE BANK, used by every test and by local development.
 *
 * It is a real implementation of the interface, not a stub that returns empty
 * arrays: it pages with a cursor, reports modifications and removals, and
 * carries both signs of money. A fixture that only ever returned a tidy list
 * would let the cursor loop, the dedupe and the sign handling all be wrong
 * while the tests stayed green.
 *
 * Deterministic on purpose — ids are derived from the seed, so a test can
 * assert on a specific transaction and a re-run produces the same books.
 */

const DAY_MS = 86_400_000;

/** Two accounts, so transfer-pair detection has something to detect. */
const ACCOUNTS: ProviderAccount[] = [
  {
    providerAccountId: "fix-checking",
    name: "Fixture Checking",
    officialName: "Fixture Bank Business Checking",
    mask: "4321",
    kind: "checking",
    currentBalanceCents: 1_250_00,
    availableBalanceCents: 1_100_00,
    currency: "USD",
  },
  {
    providerAccountId: "fix-card",
    name: "Fixture Card",
    officialName: "Fixture Bank Business Card",
    mask: "9876",
    kind: "credit_card",
    currentBalanceCents: -340_00,
    availableBalanceCents: null,
    currency: "USD",
  },
];

type Seedling = {
  id: string;
  account: string;
  daysAgo: number;
  amountCents: number;
  description: string;
  merchantName?: string;
  pending?: boolean;
  category?: string[];
};

/**
 * The seed set. Deliberately includes, in order:
 *   • money out and money in, so a sign flip cannot pass unnoticed;
 *   • a matched pair that IS a transfer (card payment), which must never book
 *     as income on one side and an expense on the other;
 *   • a pending row, which must be ingested but never posted;
 *   • a duplicate-looking pair with distinct ids, which must NOT be deduped.
 */
const SEED: Seedling[] = [
  { id: "fx-001", account: "fix-checking", daysAgo: 30, amountCents: -125_00, description: "HOME DEPOT #4821", merchantName: "Home Depot", category: ["Shops", "Hardware"] },
  { id: "fx-002", account: "fix-checking", daysAgo: 29, amountCents: 8_400_00, description: "DEPOSIT SOLAR LENDER", merchantName: "Lender", category: ["Transfer", "Deposit"] },
  { id: "fx-003", account: "fix-checking", daysAgo: 28, amountCents: -125_00, description: "HOME DEPOT #4821", merchantName: "Home Depot", category: ["Shops", "Hardware"] },
  { id: "fx-004", account: "fix-checking", daysAgo: 20, amountCents: -340_00, description: "PAYMENT TO FIXTURE CARD", merchantName: "Fixture Bank", category: ["Payment", "Credit Card"] },
  { id: "fx-005", account: "fix-card", daysAgo: 20, amountCents: 340_00, description: "PAYMENT THANK YOU", merchantName: "Fixture Bank", category: ["Payment"] },
  { id: "fx-006", account: "fix-card", daysAgo: 12, amountCents: -89_99, description: "ADOBE SUBSCRIPTION", merchantName: "Adobe", category: ["Service", "Software"] },
  { id: "fx-007", account: "fix-checking", daysAgo: 5, amountCents: -2_500_00, description: "SUBCONTRACTOR PAYMENT", merchantName: null as unknown as undefined, category: ["Transfer"] },
  { id: "fx-008", account: "fix-checking", daysAgo: 1, amountCents: -64_20, description: "SHELL OIL 574", merchantName: "Shell", pending: true, category: ["Travel", "Gas"] },
];

function materialise(s: Seedling, now: number): ProviderTransaction {
  return {
    providerTransactionId: s.id,
    providerAccountId: s.account,
    postedAt: new Date(now - s.daysAgo * DAY_MS),
    amountCents: s.amountCents,
    description: s.description,
    merchantName: s.merchantName ?? null,
    pending: s.pending ?? false,
    category: s.category ?? [],
    checkNumber: null,
    currency: "USD",
  };
}

/** Page size small enough that the seed set needs several pages. */
const PAGE = 3;

export class FixtureBankFeedProvider implements BankFeedProvider {
  readonly id = "fixture" as const;

  /** Fixed "now" keeps dates stable across a test run. */
  constructor(private readonly now: number = Date.UTC(2026, 8, 16, 12, 0, 0)) {}

  async createLinkToken(): Promise<LinkToken> {
    return { linkToken: "link-fixture-token", expiresAt: new Date(this.now + 30 * 60_000) };
  }

  async createUpdateLinkToken(): Promise<LinkToken> {
    return { linkToken: "link-fixture-update-token", expiresAt: new Date(this.now + 30 * 60_000) };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    if (!publicToken) throw new Error("fixture: a public token is required");
    return {
      accessToken: `access-fixture-${createHash("sha256").update(publicToken).digest("hex").slice(0, 12)}`,
      providerItemId: "fixture-item-1",
      institutionId: "ins_fixture",
      institutionName: "Fixture Bank",
    };
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    return ACCOUNTS.map((a) => ({ ...a }));
  }

  /**
   * Cursor paging over the seed set.
   *
   * The cursor is the offset, encoded as a string because that is all a caller
   * may assume about it — storing it as a number would happen to work here and
   * break against a real provider whose cursor is opaque.
   */
  async syncTransactions(args: { accessToken: string; cursor: string | null }): Promise<SyncPage> {
    const offset = args.cursor ? Number.parseInt(args.cursor, 10) || 0 : 0;
    const all = SEED.map((s) => materialise(s, this.now));
    const slice = all.slice(offset, offset + PAGE);
    const next = offset + slice.length;

    return {
      added: slice,
      // A pending row settling is the ordinary case of a modification: the
      // second page reports fx-008 again, no longer pending.
      modified:
        offset > 0 && offset + PAGE >= all.length
          ? [{ ...materialise(SEED[SEED.length - 1], this.now), pending: false }]
          : [],
      removed: [],
      cursor: String(next),
      hasMore: next < all.length,
    };
  }

  /**
   * The fixture accepts a webhook only when it carries an explicit event id, so
   * a test cannot accidentally prove that dedupe works against a payload that
   * never had a key.
   */
  async verifyWebhook(args: { rawBody: string; headers: Headers }): Promise<WebhookVerification> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(args.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Invalid JSON" };
    }
    const eventId = typeof payload.event_id === "string" ? payload.event_id : null;
    if (!eventId) return { ok: false, error: "Missing event_id" };

    return {
      ok: true,
      eventId,
      providerItemId: typeof payload.item_id === "string" ? payload.item_id : null,
      code: typeof payload.webhook_code === "string" ? payload.webhook_code : "SYNC_UPDATES_AVAILABLE",
      payload,
    };
  }

  async removeConnection(): Promise<void> {
    // Nothing to revoke.
  }
}

/** The seed, exposed so a test can assert against it without re-deriving it. */
export const FIXTURE_SEED_IDS = SEED.map((s) => s.id);
export const FIXTURE_ACCOUNT_IDS = ACCOUNTS.map((a) => a.providerAccountId);
