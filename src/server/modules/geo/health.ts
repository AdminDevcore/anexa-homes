import { placesAutocomplete, placesConfigured } from "./places";
import { googleGeocodeSuggest } from "./geocode-suggest";
import { nominatimSuggest } from "./suggest";

/**
 * "Is the address field actually working right now?"
 *
 * On 2026-08-24 the answer had been no for sixteen days and nothing in the
 * product could say so. Places API (New) was never enabled on the Google Cloud
 * project, so every autocomplete call returned 403; the only trace was a
 * `console.warn` in a Vercel log nobody reads, and the visible symptom was a
 * dropdown politely reporting "No matching address" — a sentence that blames
 * the customer's house.
 *
 * This module exists so that state can never again be invisible. It asks each
 * provider a question it must be able to answer, and reports which ones did.
 *
 * The canary is a fixed, famous, permanently-existing address rather than
 * anything from the database: a probe that fails must mean the PROVIDER is
 * broken, never that the test address moved or a lead got deleted.
 */

const CANARY = "1600 Amphitheatre Parkway, Mountain View, CA";

export type GeoProviderKey = "places" | "geocoding" | "nominatim";

export type ProviderStatus = {
  key: GeoProviderKey;
  label: string;
  /** Did it answer the canary? */
  ok: boolean;
  /** Present and non-empty only when `ok` is false. */
  detail: string;
  /** True when this tier can be fixed from the Google Cloud console. */
  actionable: boolean;
};

export type GeoHealth = {
  /** Can a rep type an address and get a usable house back from ANY tier? */
  ok: boolean;
  /** True when a tier is down but a lower one is covering for it. */
  degraded: boolean;
  checkedAt: string;
  providers: ProviderStatus[];
  /** One line fit for an email subject or a log. */
  summary: string;
};

const PLACES_HINT =
  "Enable Places API (New) at https://console.cloud.google.com/apis/library/places.googleapis.com — the address dropdown falls back to a weaker geocoder until you do.";
const GEOCODING_HINT =
  "Enable Geocoding API at https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com — without it no lead can get a rooftop coordinate.";

async function checkPlaces(): Promise<ProviderStatus> {
  const base = { key: "places" as const, label: "Google Places (New)", actionable: true };
  if (!placesConfigured()) {
    return { ...base, ok: false, detail: "GOOGLE_MAPS_API_KEY is not set." };
  }
  // A throwaway session token: this lookup is never picked, so it never closes
  // a billable session and never shares one with a rep's.
  const res = await placesAutocomplete(CANARY, `health-${Date.now()}`).catch((err: Error) => ({
    predictions: [],
    failure: `request failed — ${err?.message ?? "unknown"}`,
  }));
  if (res.failure) return { ...base, ok: false, detail: `${res.failure} ${PLACES_HINT}` };
  if (res.predictions.length === 0) {
    return { ...base, ok: false, detail: "answered, but had no suggestion for a known address." };
  }
  return { ...base, ok: true, detail: "" };
}

async function checkGeocoding(): Promise<ProviderStatus> {
  const base = { key: "geocoding" as const, label: "Google Geocoding", actionable: true };
  if (!placesConfigured()) {
    return { ...base, ok: false, detail: "GOOGLE_MAPS_API_KEY is not set." };
  }
  const res = await googleGeocodeSuggest(CANARY).catch((err: Error) => ({
    candidates: [],
    failure: `request failed — ${err?.message ?? "unknown"}`,
  }));
  if (res.failure) return { ...base, ok: false, detail: `${res.failure} ${GEOCODING_HINT}` };
  if (res.candidates.length === 0) {
    return { ...base, ok: false, detail: "answered, but could not resolve a known address." };
  }
  return { ...base, ok: true, detail: "" };
}

async function checkNominatim(): Promise<ProviderStatus> {
  const base = {
    key: "nominatim" as const,
    label: "OpenStreetMap Nominatim",
    // Nothing to switch on: it is free, keyless and outside our control, which
    // is also why it is last and why it must never be the only tier standing.
    actionable: false,
  };
  const hits = await nominatimSuggest(CANARY).catch(() => []);
  return hits.length > 0
    ? { ...base, ok: true, detail: "" }
    : { ...base, ok: false, detail: "no answer for a known address (rate-limited or down)." };
}

/**
 * Probe every tier. Never throws: a health check that can fail is one more
 * thing to monitor.
 *
 * `ok` asks the only question that matters to a rep standing on a doorstep —
 * can this app turn a typed address into a house? — so it is true whenever ANY
 * tier answered. `degraded` is the question that matters to whoever owns the
 * Google Cloud project, and is what the watchdog alerts on.
 */
export async function checkGeoProviders(): Promise<GeoHealth> {
  const providers = await Promise.all([checkPlaces(), checkGeocoding(), checkNominatim()]);
  const down = providers.filter((p) => !p.ok);
  const ok = providers.some((p) => p.ok);

  return {
    ok,
    degraded: down.length > 0,
    checkedAt: new Date().toISOString(),
    providers,
    summary: !ok
      ? "Address lookup is DOWN — every provider failed."
      : down.length === 0
        ? "Address lookup is healthy."
        : `Address lookup is degraded — ${down.map((p) => p.label).join(", ")} not answering.`,
  };
}
