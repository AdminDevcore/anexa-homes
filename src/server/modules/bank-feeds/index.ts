import type { BankFeedProvider, BankFeedProviderId } from "./types";
import { FixtureBankFeedProvider } from "./providers/fixture";

/**
 * THE PROVIDER SELECTOR.
 *
 * `BANK_FEED_PROVIDER` picks the implementation. It defaults to the fixture, so
 * a deployment that has not been given bank credentials runs with a working
 * feed that touches nothing real, rather than crashing on boot or — worse —
 * half-working.
 *
 * Plaid is imported LAZILY. The SDK reads credentials in its constructor and
 * throws without them, so a static import would make every test and every local
 * `next dev` depend on Plaid configuration merely because this module was in
 * the import graph.
 */

let cached: BankFeedProvider | null = null;
let cachedFor: string | null = null;

export function configuredProviderId(): BankFeedProviderId {
  const raw = (process.env.BANK_FEED_PROVIDER ?? "fixture").trim().toLowerCase();
  return raw === "plaid" ? "plaid" : "fixture";
}

/**
 * The provider for this process.
 *
 * Cached per configured id rather than unconditionally: a test that flips the
 * env var between cases gets the provider it asked for instead of whichever one
 * happened to be constructed first.
 */
export async function bankFeedProvider(): Promise<BankFeedProvider> {
  const id = configuredProviderId();
  if (cached && cachedFor === id) return cached;

  if (id === "plaid") {
    const { PlaidBankFeedProvider } = await import("./providers/plaid");
    cached = new PlaidBankFeedProvider();
  } else {
    cached = new FixtureBankFeedProvider();
  }
  cachedFor = id;
  return cached;
}

/** Drops the cached provider. For tests that change the environment. */
export function resetBankFeedProvider(): void {
  cached = null;
  cachedFor = null;
}

export type { BankFeedProvider } from "./types";
