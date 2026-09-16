import { createHash, timingSafeEqual } from "node:crypto";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type AccountBase,
  type Transaction as PlaidTransaction,
  type RemovedTransaction,
} from "plaid";
import { importJWK, jwtVerify, decodeProtectedHeader, type JWK } from "jose";
import type {
  BankFeedProvider,
  ExchangeResult,
  LinkToken,
  ProviderAccount,
  ProviderAccountKind,
  ProviderTransaction,
  SyncPage,
  WebhookVerification,
} from "../types";
import { HISTORY_DAYS } from "../types";

/**
 * THE PLAID ADAPTER.
 *
 * Everything Plaid-specific stops here. Above this file the rest of the system
 * knows only `BankFeedProvider`, which is what lets every test run against the
 * fixture and what would let Plaid be replaced without touching the ingest.
 *
 * ── THE SIGN FLIP, IN ONE PLACE ─────────────────────────────────────────────
 * Plaid reports a POSITIVE amount when money LEAVES a depository account. Our
 * interface is signed from the account holder's view, where money leaving is
 * negative. The flip happens in `toTransaction` and nowhere else.
 *
 * This is the single most dangerous line in the file. Getting it backwards does
 * not throw, does not fail to balance, and does not look wrong in the review
 * queue — it books every expense as income. The P&L inverts while each entry
 * stays internally consistent.
 *
 * ── WEBHOOKS ARE JWTs, NOT HMACs ────────────────────────────────────────────
 * Plaid signs with ES256 and puts the JWT in `plaid-verification`. The body is
 * NOT in the token: the token carries `request_body_sha256`, which must be
 * compared against a hash of the RAW bytes. Re-serialising the parsed object
 * changes the bytes and the comparison fails — the same trap the Amos runbook
 * records for HMAC schemes.
 */

const PLAID_ENVS = ["sandbox", "production"] as const;
type PlaidEnv = (typeof PLAID_ENVS)[number];

function envName(): PlaidEnv {
  const raw = (process.env.PLAID_ENV ?? "sandbox").trim().toLowerCase();
  return (PLAID_ENVS as readonly string[]).includes(raw) ? (raw as PlaidEnv) : "sandbox";
}

/** Plaid's account taxonomy, narrowed to ours. */
function toKind(a: AccountBase): ProviderAccountKind {
  if (a.type === "credit") return "credit_card";
  if (a.type === "depository") {
    if (a.subtype === "checking") return "checking";
    if (a.subtype === "savings") return "savings";
  }
  return "other";
}

/** Dollars (float) to integer cents, without the usual 0.1 + 0.2 surprise. */
function toCents(amount: number | null | undefined): number {
  return Math.round((amount ?? 0) * 100);
}

function toTransaction(t: PlaidTransaction): ProviderTransaction {
  return {
    providerTransactionId: t.transaction_id,
    providerAccountId: t.account_id,
    // `date` is the POSTED date, which is what a bank statement shows and what
    // reconciliation matches on. `authorized_date` is when the card was swiped
    // and can be days earlier.
    postedAt: new Date(`${t.date}T12:00:00Z`),
    // THE FLIP. See the header.
    amountCents: -toCents(t.amount),
    description: t.name,
    merchantName: t.merchant_name ?? null,
    pending: t.pending ?? false,
    category: t.personal_finance_category
      ? [t.personal_finance_category.primary, t.personal_finance_category.detailed].filter(Boolean)
      : (t.category ?? []),
    checkNumber: t.check_number ?? null,
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? "USD",
  };
}

export class PlaidBankFeedProvider implements BankFeedProvider {
  readonly id = "plaid" as const;
  private readonly client: PlaidApi;

  constructor() {
    const clientId = process.env.PLAID_CLIENT_ID?.trim();
    const secret = process.env.PLAID_SECRET?.trim();
    // Fails closed, like assertCronRequest: a half-configured deployment
    // refuses rather than silently falling back to a provider nobody chose.
    if (!clientId || !secret) {
      throw new Error(
        "BANK_FEED_PROVIDER=plaid requires PLAID_CLIENT_ID and PLAID_SECRET. See .env.example."
      );
    }
    this.client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[envName()],
        baseOptions: {
          headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret },
        },
      })
    );
  }

  async createLinkToken(args: {
    companyId: string;
    userId: string;
    webhookUrl: string | null;
  }): Promise<LinkToken> {
    const res = await this.client.linkTokenCreate({
      user: { client_user_id: args.userId },
      client_name: "Anexa Homes",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      ...(args.webhookUrl ? { webhook: args.webhookUrl } : {}),
      // Two years, so the first sync can rebuild a real history rather than
      // starting the books from whenever the connection happened to be made.
      transactions: { days_requested: HISTORY_DAYS },
    });
    return {
      linkToken: res.data.link_token,
      expiresAt: res.data.expiration ? new Date(res.data.expiration) : null,
    };
  }

  /**
   * Update mode: repairs a connection whose credentials expired (an MFA prompt,
   * a password change) WITHOUT creating a new one. A fresh Link would produce a
   * second item with its own cursor and re-ingest two years of history as if it
   * were new.
   */
  async createUpdateLinkToken(args: {
    accessToken: string;
    webhookUrl: string | null;
  }): Promise<LinkToken> {
    const res = await this.client.linkTokenCreate({
      user: { client_user_id: "reconnect" },
      client_name: "Anexa Homes",
      country_codes: [CountryCode.Us],
      language: "en",
      access_token: args.accessToken,
      ...(args.webhookUrl ? { webhook: args.webhookUrl } : {}),
    });
    return {
      linkToken: res.data.link_token,
      expiresAt: res.data.expiration ? new Date(res.data.expiration) : null,
    };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    const exchange = await this.client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;

    // The institution is a nicety, not a requirement: a connection that works
    // but cannot name its bank is still a working connection.
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const item = await this.client.itemGet({ access_token: accessToken });
      institutionId = item.data.item.institution_id ?? null;
      if (institutionId) {
        const inst = await this.client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = inst.data.institution.name;
      }
    } catch (err) {
      console.error("[plaid] could not resolve institution", err);
    }

    return {
      accessToken,
      providerItemId: exchange.data.item_id,
      institutionId,
      institutionName,
    };
  }

  async listAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const res = await this.client.accountsGet({ access_token: accessToken });
    return res.data.accounts.map((a) => ({
      providerAccountId: a.account_id,
      name: a.name,
      officialName: a.official_name ?? null,
      mask: a.mask ?? null,
      kind: toKind(a),
      // A credit card's "current" balance is what is OWED, reported positive.
      // Negated so that, like every other account here, negative means we are
      // down money.
      currentBalanceCents:
        a.balances.current == null
          ? null
          : a.type === "credit"
            ? -toCents(a.balances.current)
            : toCents(a.balances.current),
      availableBalanceCents:
        a.balances.available == null ? null : toCents(a.balances.available),
      currency: a.balances.iso_currency_code ?? "USD",
    }));
  }

  async syncTransactions(args: {
    accessToken: string;
    cursor: string | null;
  }): Promise<SyncPage> {
    const res = await this.client.transactionsSync({
      access_token: args.accessToken,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    });
    const d = res.data;
    return {
      added: d.added.map(toTransaction),
      modified: d.modified.map(toTransaction),
      removed: d.removed.map((r: RemovedTransaction) => r.transaction_id),
      cursor: d.next_cursor,
      hasMore: d.has_more,
    };
  }

  /**
   * Verify an inbound Plaid webhook.
   *
   * Four checks, each of which alone is insufficient:
   *   1. the JWT is ES256 (never "none", never an HMAC algorithm the attacker
   *      picks — the key is fetched by `kid` and imported as EC, so an
   *      algorithm swap fails at verification);
   *   2. its signature verifies against Plaid's published key for that `kid`;
   *   3. `iat` is within five minutes, so a captured delivery cannot be replayed;
   *   4. `request_body_sha256` equals the SHA-256 of the RAW bytes, compared
   *      with a timing-safe equal.
   */
  async verifyWebhook(args: { rawBody: string; headers: Headers }): Promise<WebhookVerification> {
    const token = args.headers.get("plaid-verification");
    if (!token) return { ok: false, error: "Missing plaid-verification header" };

    let kid: string | undefined;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== "ES256") return { ok: false, error: "Unexpected signing algorithm" };
      kid = header.kid;
    } catch {
      return { ok: false, error: "Malformed verification token" };
    }
    if (!kid) return { ok: false, error: "Verification token has no key id" };

    let claims: { request_body_sha256?: unknown; iat?: unknown };
    try {
      const keyRes = await this.client.webhookVerificationKeyGet({ key_id: kid });
      const jwk = keyRes.data.key as unknown as JWK;
      const key = await importJWK(jwk, "ES256");
      const verified = await jwtVerify(token, key, { algorithms: ["ES256"] });
      claims = verified.payload as typeof claims;
    } catch {
      return { ok: false, error: "Verification failed" };
    }

    const iat = typeof claims.iat === "number" ? claims.iat : 0;
    if (Math.abs(Date.now() / 1000 - iat) > 300) {
      return { ok: false, error: "Verification token is stale" };
    }

    const expected = typeof claims.request_body_sha256 === "string" ? claims.request_body_sha256 : "";
    const actual = createHash("sha256").update(args.rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: "Body does not match its signature" };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(args.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Invalid JSON" };
    }

    const itemId = typeof payload.item_id === "string" ? payload.item_id : null;
    const code = typeof payload.webhook_code === "string" ? payload.webhook_code : "UNKNOWN";

    /**
     * PLAID DOES NOT SEND AN EVENT ID, and delivery is at-least-once.
     *
     * So the dedupe key is derived from the verified body itself. It is taken
     * from the body hash we have already computed and proven authentic, which
     * makes two deliveries of the same event collapse to one key while two
     * genuinely different events cannot collide. Letting the caller invent a key
     * would mean no dedupe at all.
     */
    return { ok: true, eventId: `plaid:${actual}`, providerItemId: itemId, code, payload };
  }

  async removeConnection(accessToken: string): Promise<void> {
    try {
      await this.client.itemRemove({ access_token: accessToken });
    } catch (err) {
      // Best effort: the row is going away on our side regardless, and leaving
      // a dangling item at Plaid is better than refusing to disconnect.
      console.error("[plaid] itemRemove failed", err);
    }
  }
}
