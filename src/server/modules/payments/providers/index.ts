import type { AchProvider, AchProviderId } from "./types";
import { FixtureAchProvider } from "./fixture";

/**
 * THE ACH PROVIDER SELECTOR.
 *
 * Mirrors `bank-feeds/index.ts` exactly, for the same reasons. `ACH_PROVIDER`
 * picks the implementation and DEFAULTS TO THE FIXTURE, so a deployment given
 * no payment credentials runs a complete payments module that moves no money —
 * rather than crashing on boot, or half-working in a way nobody notices until a
 * vendor is not paid.
 *
 * A real provider will be imported LAZILY when one is written, because payment
 * SDKs read credentials in their constructor and throw without them: a static
 * import would make every test and every local `next dev` depend on payment
 * configuration merely because this module is in the import graph.
 *
 * Which provider to choose is `docs/ach-provider-comparison.md`. Nothing is
 * blocked on that decision, which is the point of this file.
 */

let cached: AchProvider | null = null;
let cachedFor: string | null = null;

export function configuredAchProviderId(): AchProviderId {
  const raw = (process.env.ACH_PROVIDER ?? "fixture").trim().toLowerCase();
  if (raw === "plaid") return "plaid";
  if (raw === "dwolla") return "dwolla";
  return "fixture";
}

/** True when this deployment can actually move money. */
export function achIsLive(): boolean {
  return configuredAchProviderId() !== "fixture";
}

/**
 * The provider for this process.
 *
 * Cached per configured id rather than unconditionally, so a test that flips
 * the env var between cases gets the provider it asked for instead of whichever
 * one happened to be constructed first.
 */
export async function achProvider(): Promise<AchProvider> {
  const id = configuredAchProviderId();
  if (cached && cachedFor === id) return cached;

  if (id !== "fixture") {
    // No adapter has been written yet. Falling back silently to the fixture
    // here would be the worst possible failure: the deployment would believe it
    // was paying vendors while moving nothing at all. So it refuses.
    throw new Error(
      `ACH_PROVIDER is "${id}" but no adapter for it has been written. ` +
        `See docs/ach-provider-comparison.md. Unset ACH_PROVIDER to use the fixture.`
    );
  }

  cached = new FixtureAchProvider();
  cachedFor = id;
  return cached;
}

/** Test seam: drop the memoised provider so the next call re-reads the env. */
export function resetAchProviderCache(): void {
  cached = null;
  cachedFor = null;
}

export type { AchProvider, AchProviderId } from "./types";
