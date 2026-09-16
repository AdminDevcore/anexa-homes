import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FixtureAchProvider } from "../fixture";
import { achProvider, configuredAchProviderId, achIsLive, resetAchProviderCache } from "../index";

/**
 * THE FIXTURE PROVIDER, WHICH IS WHAT EVERY TEST RUNS AGAINST.
 *
 * That is exactly why it is tested rather than trusted. A fixture that always
 * succeeds proves only the happy path, and a fixture that waves signatures
 * through means the webhook route is unverified in tests and unverified in
 * production for the same reason.
 *
 * The properties here are the ones that break real payment integrations:
 *
 *   • idempotency, because a network timeout on a send is indistinguishable
 *     from success and a blind retry pays the vendor twice;
 *   • fail-closed verification, so an unset secret never means "accept
 *     everything" on an endpoint that moves money;
 *   • signatures over RAW BYTES, not over a re-serialised object;
 *   • a signed TIMESTAMP that is actually checked, so a captured delivery
 *     cannot be replayed forever.
 */

const SECRET = "test-webhook-secret";
let savedSecret: string | undefined;
let savedProvider: string | undefined;

beforeEach(() => {
  savedSecret = process.env.ACH_WEBHOOK_SECRET;
  savedProvider = process.env.ACH_PROVIDER;
  process.env.ACH_WEBHOOK_SECRET = SECRET;
  resetAchProviderCache();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.ACH_WEBHOOK_SECRET;
  else process.env.ACH_WEBHOOK_SECRET = savedSecret;
  if (savedProvider === undefined) delete process.env.ACH_PROVIDER;
  else process.env.ACH_PROVIDER = savedProvider;
  resetAchProviderCache();
});

const aRequest = (over: Partial<Parameters<FixtureAchProvider["send"]>[0]> = {}) => ({
  idempotencyKey: `pay_${Math.random().toString(36).slice(2, 10)}`,
  amountCents: 125_000,
  routingNumber: "021000021",
  accountNumber: "123456789",
  accountType: "checking" as const,
  payeeName: "Ace Supply",
  ...over,
});

describe("sending", () => {
  /**
   * THE ONE THAT MATTERS MOST. A timeout looks exactly like a success from
   * here, so the retry must be the same request rather than a second payment.
   */
  it("returns the same transfer for a repeated idempotency key", async () => {
    const p = new FixtureAchProvider();
    const req = aRequest();

    const first = await p.send(req);
    const second = await p.send(req);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.providerTransferId).toBe(first.providerTransferId);
  });

  it("gives different transfers different ids", async () => {
    const p = new FixtureAchProvider();
    const a = await p.send(aRequest());
    const b = await p.send(aRequest());
    if (!a.ok || !b.ok) throw new Error("expected both to send");
    expect(a.providerTransferId).not.toBe(b.providerTransferId);
  });

  /** A provider that only ever succeeds tests only the happy path. */
  it("rejects a known-bad account, and says not to retry", async () => {
    const p = new FixtureAchProvider();
    const res = await p.send(aRequest({ accountNumber: "000000000" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryable).toBe(false);
  });

  it("refuses a non-positive or fractional amount", async () => {
    const p = new FixtureAchProvider();
    expect((await p.send(aRequest({ amountCents: 0 }))).ok).toBe(false);
    expect((await p.send(aRequest({ amountCents: -1 }))).ok).toBe(false);
    expect((await p.send(aRequest({ amountCents: 10.5 }))).ok).toBe(false);
  });

  it("refuses a request with no idempotency key", async () => {
    const p = new FixtureAchProvider();
    expect((await p.send(aRequest({ idempotencyKey: "" }))).ok).toBe(false);
  });

  it("knows nothing about a transfer it never sent", async () => {
    const p = new FixtureAchProvider();
    expect(await p.getStatus("fix_nope")).toBeNull();
  });

  it("reports a transfer it did send, and follows it forward", async () => {
    const p = new FixtureAchProvider();
    const res = await p.send(aRequest());
    if (!res.ok) throw new Error("expected send");

    expect(await p.getStatus(res.providerTransferId)).toBe("pending");
    p.advance(res.providerTransferId, "settled");
    expect(await p.getStatus(res.providerTransferId)).toBe("settled");
  });
});

describe("verifying a webhook", () => {
  const body = () =>
    JSON.stringify({ eventId: `evt_${Math.random()}`, kind: "transfer.settled", status: "settled" });

  /** An unset secret must never mean "accept everything" on an endpoint that
   * moves money. */
  it("fails closed when no secret is configured", () => {
    delete process.env.ACH_WEBHOOK_SECRET;
    const p = new FixtureAchProvider();
    const raw = body();
    const res = p.verifyWebhook(raw, { "x-ach-signature": FixtureAchProvider.sign(raw, SECRET) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ACH_WEBHOOK_SECRET");
  });

  it("accepts a correctly signed delivery and reads the event", () => {
    const p = new FixtureAchProvider();
    const raw = JSON.stringify({
      eventId: "evt_1", kind: "transfer.returned", transferId: "fix_abc",
      status: "returned", returnCode: "R01", returnReason: "Insufficient funds",
    });
    const res = p.verifyWebhook(raw, { "x-ach-signature": FixtureAchProvider.sign(raw, SECRET) });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toMatchObject({
      eventId: "evt_1",
      kind: "transfer.returned",
      providerTransferId: "fix_abc",
      status: "returned",
      returnCode: "R01",
    });
  });

  it("refuses a missing or malformed signature header", () => {
    const p = new FixtureAchProvider();
    const raw = body();
    expect(p.verifyWebhook(raw, {}).ok).toBe(false);
    expect(p.verifyWebhook(raw, { "x-ach-signature": "nonsense" }).ok).toBe(false);
    expect(p.verifyWebhook(raw, { "x-ach-signature": "t=abc,v1=def" }).ok).toBe(false);
  });

  it("refuses a signature computed with the wrong secret", () => {
    const p = new FixtureAchProvider();
    const raw = body();
    const res = p.verifyWebhook(raw, { "x-ach-signature": FixtureAchProvider.sign(raw, "not-it") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Bad signature");
  });

  /**
   * THE RAW-BYTES PROPERTY. Identical content, different bytes — re-serialising
   * changes whitespace, key order and unicode escapes, and the signature is
   * over what the provider actually sent.
   */
  it("verifies the bytes it was given, not the object they parse to", () => {
    const p = new FixtureAchProvider();
    const payload = { eventId: "evt_2", kind: "transfer.settled", status: "settled" };
    const raw = JSON.stringify(payload);
    const signature = FixtureAchProvider.sign(raw, SECRET);

    // Same object. Different bytes.
    const reserialised = JSON.stringify(payload, null, 2);
    expect(reserialised).not.toBe(raw);

    expect(p.verifyWebhook(reserialised, { "x-ach-signature": signature }).ok).toBe(false);
    expect(p.verifyWebhook(raw, { "x-ach-signature": signature }).ok).toBe(true);
  });

  /**
   * A signature alone stays valid forever. The timestamp is signed WITH the
   * body specifically so a captured delivery cannot be replayed later — which
   * only works if it is checked.
   */
  it("refuses a correctly signed but STALE delivery", () => {
    const p = new FixtureAchProvider();
    const raw = body();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const res = p.verifyWebhook(raw, {
      "x-ach-signature": FixtureAchProvider.sign(raw, SECRET, tenMinutesAgo),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("too old");
  });

  it("accepts a delivery inside the tolerance", () => {
    const p = new FixtureAchProvider();
    const raw = body();
    const oneMinuteAgo = Date.now() - 60 * 1000;
    expect(
      p.verifyWebhook(raw, { "x-ach-signature": FixtureAchProvider.sign(raw, SECRET, oneMinuteAgo) }).ok
    ).toBe(true);
  });

  it("refuses a signed body that is not a JSON object, or has no event id", () => {
    const p = new FixtureAchProvider();
    for (const raw of ["not json", '"a string"', "{}", '{"kind":"x"}']) {
      const res = p.verifyWebhook(raw, { "x-ach-signature": FixtureAchProvider.sign(raw, SECRET) });
      expect(res.ok, `should refuse ${raw}`).toBe(false);
    }
  });
});

describe("choosing a provider", () => {
  it("defaults to the fixture, which moves no money", async () => {
    delete process.env.ACH_PROVIDER;
    resetAchProviderCache();
    expect(configuredAchProviderId()).toBe("fixture");
    expect(achIsLive()).toBe(false);
    expect((await achProvider()).id).toBe("fixture");
  });

  /**
   * Falling back to the fixture here would be the worst possible failure: the
   * deployment would believe it was paying vendors while moving nothing.
   */
  it("refuses loudly when configured for a provider that has no adapter", async () => {
    process.env.ACH_PROVIDER = "dwolla";
    resetAchProviderCache();
    expect(achIsLive()).toBe(true);
    await expect(achProvider()).rejects.toThrow(/no adapter/);
  });

  it("treats an unrecognised value as the fixture", () => {
    process.env.ACH_PROVIDER = "something-else";
    expect(configuredAchProviderId()).toBe("fixture");
  });

  it("gives the same instance back while the configuration is unchanged", async () => {
    delete process.env.ACH_PROVIDER;
    resetAchProviderCache();
    expect(await achProvider()).toBe(await achProvider());
  });
});
