import crypto from "node:crypto";
import type {
  AchProvider,
  AchProviderId,
  TransferRequest,
  TransferResult,
  TransferStatus,
  WebhookVerification,
} from "./types";

/**
 * THE FIXTURE PROVIDER — moves no money, and every test runs against it.
 *
 * This is the default, so a deployment with no ACH credentials runs a complete,
 * working payments module that touches nothing real, rather than crashing on
 * boot or — far worse — half-working.
 *
 * It is not a stub that returns success. It reproduces the behaviour that
 * actually breaks integrations:
 *
 *   • IDEMPOTENCY. The same key returns the same transfer id without sending
 *     again, so the retry-after-timeout path can be tested rather than hoped
 *     about.
 *   • FAILURE AND RETURN. Specific account numbers fail at send, or settle and
 *     then bounce, because a provider that only ever succeeds tests only the
 *     happy path — and the return path is where the books get this wrong.
 *   • SIGNED WEBHOOKS. Signature verification is real HMAC over the raw body
 *     with a timing-safe compare, so the webhook route is exercised properly
 *     instead of being waved through in tests and unverified in production.
 */

/** Account numbers that make the fixture behave badly, on purpose. */
const ACCOUNT_REJECTED = "000000000";
const ACCOUNT_RETURNS = "111111111";

/**
 * How stale a signed delivery may be, in seconds.
 *
 * The timestamp is signed WITH the body precisely so a captured delivery cannot
 * be replayed later, which only works if the timestamp is actually checked.
 * Verifying the digest alone would accept a valid-forever recording.
 * 300s matches `docs/runbooks/amos-inbound-callbacks.md`.
 */
const SIGNATURE_TOLERANCE_SECONDS = 300;

type Sent = { id: string; status: TransferStatus; accountNumber: string };

export class FixtureAchProvider implements AchProvider {
  readonly id: AchProviderId = "fixture";

  /** Keyed by idempotency key, which is what makes a retry the same request. */
  private readonly byKey = new Map<string, Sent>();
  private readonly byId = new Map<string, Sent>();

  async send(req: TransferRequest): Promise<TransferResult> {
    if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
      return { ok: false, error: "A payment must be a positive whole number of cents.", retryable: false };
    }
    if (!req.idempotencyKey) {
      return { ok: false, error: "A payment must carry an idempotency key.", retryable: false };
    }

    // A repeat of a request we already accepted is the SAME request. This is
    // the whole point of the key: a timeout is indistinguishable from success,
    // and a retry must not pay the vendor a second time.
    const seen = this.byKey.get(req.idempotencyKey);
    if (seen) return { ok: true, providerTransferId: seen.id, status: seen.status };

    if (req.accountNumber === ACCOUNT_REJECTED) {
      return { ok: false, error: "The receiving bank rejected this account.", retryable: false };
    }

    const record: Sent = {
      id: `fix_${crypto.createHash("sha256").update(req.idempotencyKey).digest("hex").slice(0, 24)}`,
      status: "pending",
      accountNumber: req.accountNumber,
    };
    this.byKey.set(req.idempotencyKey, record);
    this.byId.set(record.id, record);
    return { ok: true, providerTransferId: record.id, status: record.status };
  }

  async getStatus(providerTransferId: string): Promise<TransferStatus | null> {
    return this.byId.get(providerTransferId)?.status ?? null;
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerification {
    const secret = process.env.ACH_WEBHOOK_SECRET;
    if (!secret) {
      // FAILS CLOSED. An unset secret must never mean "accept everything" —
      // that turns a missing environment variable into an open endpoint that
      // can move money.
      return { ok: false, error: "ACH_WEBHOOK_SECRET is not set; refusing to trust a webhook." };
    }

    const provided = headers["x-ach-signature"] ?? headers["X-Ach-Signature"];
    if (!provided) return { ok: false, error: "Missing signature." };

    // `t=<unix>,v1=<hex>` — the scheme the house runbook specifies, so the
    // tests exercise the real thing rather than a weaker stand-in.
    const parts = new Map(
      provided.split(",").map((p) => {
        const i = p.indexOf("=");
        return i === -1 ? ["", ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      })
    );
    const t = parts.get("t");
    const v1 = parts.get("v1");
    if (!t || !v1) return { ok: false, error: "Malformed signature header." };

    const signedAt = Number(t);
    if (!Number.isFinite(signedAt)) return { ok: false, error: "Malformed signature timestamp." };

    // CHECKED AS WELL AS the digest. A signature stays valid forever; the
    // timestamp is what makes a captured delivery un-replayable.
    const ageSeconds = Math.abs(Date.now() / 1000 - signedAt);
    if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      return { ok: false, error: "This delivery is too old to trust." };
    }

    // Over the timestamp and the RAW body. Re-serialising the parsed object
    // changes bytes and would fail a signature the provider computed correctly.
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${signedAt}.${rawBody}`, "utf8")
      .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    // Length is checked first: timingSafeEqual throws on a mismatch, and that
    // exception would leak through control flow what the comparison hides.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "Bad signature." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: "Body is not JSON." };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "Body is not an object." };
    }

    const body = parsed as Record<string, unknown>;
    const eventId = typeof body.eventId === "string" ? body.eventId : null;
    const kind = typeof body.kind === "string" ? body.kind : null;
    if (!eventId || !kind) return { ok: false, error: "Event is missing an id or a kind." };

    const transferId = typeof body.transferId === "string" ? body.transferId : null;
    const status = isStatus(body.status) ? body.status : null;

    // Keep the in-memory view consistent, so getStatus after a webhook agrees.
    if (transferId && status) {
      const rec = this.byId.get(transferId);
      if (rec) rec.status = status;
    }

    return {
      ok: true,
      event: {
        eventId,
        kind,
        providerTransferId: transferId,
        status,
        returnCode: typeof body.returnCode === "string" ? body.returnCode : null,
        returnReason: typeof body.returnReason === "string" ? body.returnReason : null,
        payload: body,
      },
    };
  }

  // ── Test affordances ──────────────────────────────────────────────────────
  // Not part of AchProvider: nothing in the application may call these.

  /**
   * Sign a body the way the fixture expects, so tests exercise real
   * verification instead of bypassing it.
   *
   * `atMs` is a parameter so a test can produce a genuinely stale delivery and
   * prove the tolerance rejects it — which is the half of the scheme a digest
   * check alone would silently skip.
   */
  static sign(rawBody: string, secret: string, atMs: number = Date.now()): string {
    const t = Math.floor(atMs / 1000);
    const v1 = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
    return `t=${t},v1=${v1}`;
  }

  /** Drive a transfer forward, as the provider would. */
  advance(providerTransferId: string, status: TransferStatus): void {
    const rec = this.byId.get(providerTransferId);
    if (rec) rec.status = status;
  }

  /** True when this account is the one configured to bounce after settling. */
  static returnsAfterSettling(accountNumber: string): boolean {
    return accountNumber === ACCOUNT_RETURNS;
  }

  reset(): void {
    this.byKey.clear();
    this.byId.clear();
  }
}

function isStatus(v: unknown): v is TransferStatus {
  return v === "pending" || v === "sent" || v === "settled" || v === "returned" || v === "failed";
}
