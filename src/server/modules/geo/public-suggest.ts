"use server";

import { headers } from "next/headers";
import { forClient, suggestAddresses, type SuggestResult } from "./suggest";
import { placeDetails } from "./places";
import type { PlaceScope, ResolvedAddress } from "./places";
import { createThrottle } from "./throttle";

/**
 * The address dropdown for the public website form.
 *
 * Everything inside /portal goes through `/api/geocode/*`, which is gated on a
 * session. The marketing form has no session by definition, so it gets server
 * actions instead — same suggestion logic, plus the throttle, because this is
 * the one address field a stranger can reach and Places is metered.
 *
 * Limits are generous enough that a real visitor filling in one address never
 * notices, and tight enough that a held-down key stops costing money quickly.
 * A 350 ms debounce means a fast typist spends roughly 3 requests on an address.
 */

const SUGGEST_LIMIT = 30;
const DETAILS_LIMIT = 10;
const WINDOW_MS = 60_000;

const suggestThrottle = createThrottle({ limit: SUGGEST_LIMIT, windowMs: WINDOW_MS });
const detailsThrottle = createThrottle({ limit: DETAILS_LIMIT, windowMs: WINDOW_MS });

/**
 * Best guess at the caller, for throttling only.
 *
 * `x-forwarded-for` is client-controllable in general; behind Vercel the
 * left-most entry is the real peer because the platform rewrites the header.
 * Nothing security-relevant hangs off this — worst case a spoofer gets their
 * own bucket, which is the same thing a new IP would get anyway.
 */
async function callerKey(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Suggest addresses for the public form. Returns an empty list when throttled —
 *  a visitor who trips this is typing faster than a human, and a silent empty
 *  dropdown is better than an error on a lead-capture form. */
export async function publicSuggestAddresses(
  q: string,
  sessionToken: string,
  scope: PlaceScope = "address"
): Promise<SuggestResult> {
  if (!suggestThrottle.allow(await callerKey()))
    return { results: [], source: "none", degraded: null };
  return forClient(await suggestAddresses(q, sessionToken, {}, scope));
}

/** Resolve a picked prediction for the public form. */
export async function publicResolvePlace(
  placeId: string,
  sessionToken: string
): Promise<ResolvedAddress | null> {
  if (!placeId.trim()) return null;
  if (!detailsThrottle.allow(await callerKey())) return null;
  return placeDetails(placeId, sessionToken);
}
