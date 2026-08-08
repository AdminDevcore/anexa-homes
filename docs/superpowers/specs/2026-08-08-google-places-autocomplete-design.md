# Google Places address autocomplete, everywhere

## The problem

Typing `Shoreline Street` into the New Appointment form offers four streets and
no houses:

```
Shoreline Street, Plano, Collin County, Texas, 75075, United States
Shoreline Street, Moreno Valley, Riverside County, California, 92551, …
```

There is no `404 Shoreline St` to pick, so the rep types the house number, the
city, the state and the ZIP by hand on every single lead.

This is not a tuning problem. The suggestions come from OpenStreetMap Nominatim,
and OSM has no building for that street — only the TIGER-imported road
centreline. Nominatim cannot offer a house number it does not have. It is the
same data gap that put a deal's aerial view three houses off its own address
(see `src/server/modules/geo/resolve.ts`), reached from a different direction:
there Nominatim *invented* a house number by interpolating along the centreline;
here it declines to invent one and offers the street instead.

Google Places has the buildings. `404 Shoreline St` is a real prediction.

## Scope

Every address field in the app, not just the one that already has a search box.

| Surface | File | Today |
| --- | --- | --- |
| New Appointment / new lead | `components/portal/lead-form.tsx` | Nominatim autocomplete |
| Field Map search | `components/portal/field-map/dialogs.tsx` | Nominatim autocomplete |
| Edit Job dialog | `components/portal/edit-job-dialog.tsx` | plain text |
| Onboarding wizard (home + account address) | `components/portal/onboarding-wizard.tsx` | plain text |
| Bookkeeping vendor | `components/portal/bookkeeping-client.tsx` | plain text |
| Company identity | `components/portal/company-identity-form.tsx` | plain text |
| Storm coverage centre | `components/portal/storm-coverage-settings.tsx` | plain text |
| Storm address checker | `components/portal/storm/address-checker.tsx` | plain text |
| Public website contact form | `components/marketing/contact-form.tsx` | plain text |

## Architecture

### 1. `src/server/modules/geo/places.ts`

Sits beside `google.ts` and follows its conventions: pure parsers split from the
fetch so the failure modes are testable, `null` rather than throws, key read from
the environment and never returned to the caller.

Places API (New) is two calls:

- **Autocomplete** — `POST places.googleapis.com/v1/places:autocomplete`, body
  `{ input, sessionToken, includedRegionCodes: ["us"], includedPrimaryTypes: ["address"] }`.
  `includedPrimaryTypes: ["address"]` is the load-bearing part: it restricts
  results to house-number-level places, which is the whole point of the change.
  Returns predictions carrying a `placeId` and a bold/muted text split — **no
  coordinates and no postcode**.
- **Details** — `GET places.googleapis.com/v1/places/{placeId}` with field mask
  `id,formattedAddress,addressComponents,location`. This is where the ZIP and the
  rooftop coordinate come from.

Two calls, not one, is inherent to the API and drives the client design below.

Auth is the `X-Goog-Api-Key` header on a server-side fetch, so the existing
IP-restricted `GOOGLE_MAPS_API_KEY` keeps working unchanged and no key reaches
the browser.

Google returns `administrative_area_level_1.shortText` as `"TX"` already, so the
51-entry `STATE_ABBR` lookup in the current route becomes dead code on the Places
path. It stays for the Nominatim fallback, which still spells states out.

### 2. Routes

- `GET /api/geocode/autocomplete?q=&session=` — existing route, session-gated,
  rewritten. Places first; on a null result (no key, API not enabled, quota,
  zero matches) it falls through to today's Nominatim code. Returns `source` so a
  silent downgrade is visible rather than mysterious.
- `GET /api/geocode/place?placeId=&session=` — new, session-gated. Resolves a
  prediction to `{ address, city, state, zip, lat, lng, precision }`.

The response type has to cover both geocoders, which disagree about when the
coordinates are known:

```ts
type AddressSuggestion = {
  label: string;       // full line, for the fallback and for a11y
  primary: string;     // "404 Shoreline St"
  secondary: string;   // "Plano, TX 75075, USA"
  placeId: string | null;    // Google: resolve before use
  parts: ResolvedAddress | null;  // Nominatim: already known
};
```

A suggestion carries either a `placeId` or its `parts`. The client resolves the
former and uses the latter directly, so the extra network round-trip happens only
on the Google path and only on pick.

The public website form cannot use a session-gated route. It gets a server action
alongside `submitWebsiteLead`, guarded by an in-memory per-IP limiter. That
limiter is per serverless instance and therefore approximate — it is a cost
guard against a bored visitor holding down a key, not a defence against a
determined attacker. A daily quota cap in Google Cloud Console is the real
backstop.

### 3. `AddressAutocomplete`

One component, used by all nine surfaces.

- **Session tokens.** A UUID generated per typing session and regenerated after
  each pick. This is Google's billing contract: keystrokes inside one token bill
  as a single autocomplete session instead of individually. Getting this wrong is
  the difference between one billable unit per address and one per keystroke.
- **Two-line results** — bold `404 Shoreline St` over muted `Plano, TX 75075`,
  instead of today's single wrapped line.
- **Arrow-key navigation.** Today only Enter-picks-first is wired.
- **`mode`** — `"parts"` fills Address / City / State / ZIP from the pick;
  `"single"` writes the formatted address into one field, for the surfaces that
  have no city/state/zip beside them (account address, company address, storm
  centre, storm checker).
- Typing is never blocked and picking is never required. Every one of these
  fields accepts free text today and still will.

### 4. Rooftop coordinates on lead create

Place Details already returns the rooftop `location` on the pick. Threading it
into the created lead means a new lead plots at rooftop precision the moment it
is saved, instead of waiting for the nightly cron to interpolate one from OSM.
`Lead.lat` / `Lead.lng` already exist; no migration.

This retires, for every lead created through the form, the exact failure
documented at the top of `resolve.ts`.

## Testing

- Unit tests on `parseAutocomplete` and `parsePlaceDetails` — pure, same shape as
  the existing `parseGoogleGeocode` tests. Cover the error envelopes: Places
  answers `403 PERMISSION_DENIED` when the API is not enabled, which is this
  API's version of the `status: "OK"` trap that `google.ts` already documents.
- Unit test on the route's fallback routing with injected dependencies, matching
  `resolve.test.ts`.
- A Playwright spec on New Appointment with the Places response intercepted:
  type `404 Shoreline`, assert a house-numbered suggestion appears, pick it,
  assert City / State / ZIP populate. Intercepted rather than live so the suite
  neither bills nor flakes on Google.

## Operational notes

1. **"Places API (New)" must be enabled** on `GOOGLE_MAPS_API_KEY`. It is
   currently scoped to Geocoding, Maps Static and Map Tiles. Without this the
   code ships and silently serves Nominatim — which is the designed behaviour,
   and also indistinguishable from "the feature didn't work" unless you check
   `source` in the response.
2. **Places is metered; Nominatim was free.** Session tokens keep the bill per
   completed address rather than per keystroke, and `includedPrimaryTypes`
   trims wasted calls. Set a daily quota cap on Places API (New) before the
   public website form goes live — that is the one surface strangers can reach.
