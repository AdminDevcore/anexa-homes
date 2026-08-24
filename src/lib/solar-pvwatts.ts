/**
 * What a plane of panels actually makes, according to PVWatts.
 *
 * `solar-orientation.ts` answers "how much worse is west than south" from a
 * clear-sky model, and says in its own header that it is not good enough to be
 * asked "how many kWh" — that number came from `kwhPerKwYear`, one figure typed
 * into company settings as a market average. Every proposal's production,
 * offset, savings and twenty-five-year comparison is that one typed number
 * scaled by a ratio.
 *
 * PVWatts v8 answers the second question properly: a real hourly simulation
 * against the NSRDB weather record for the site's own grid cell, which is what
 * the industry treats as the reference for a non-bankable estimate.
 *
 * THE CALL IS ALWAYS FOR A 1 kW SYSTEM. `ac_annual` on a 1 kW system IS the
 * plane's specific yield in kWh per kW-year, so one answer serves an array of
 * any size — which is what makes caching it worthwhile and keeps a redraw from
 * costing a request.
 *
 * SHADING IS DELIBERATELY NOT SENT. It varies array by array while the yield
 * varies only by place and plane, so folding it into the request would make
 * every cache entry single-use. It is applied to the returned figure instead,
 * which is arithmetically the same thing.
 *
 * Pure and network-free on purpose, like every other `solar-*` lib: the request
 * shape, the response reading and the cache key are the parts worth testing,
 * and a module that fetches cannot be tested without pretending to be the API.
 */

import { withProductionMargin } from "./solar-money";

/** Fixed roof mount runs hotter than an open rack, and PVWatts knows it. */
export type ArrayType = "roof" | "ground";

export type YieldRequest = {
  lat: number;
  lon: number;
  /** Degrees off horizontal. 0 is flat. */
  tiltDeg: number;
  /** Degrees clockwise from true north — PVWatts' own convention, like ours. */
  azimuthDeg: number;
  /** System losses as a PERCENT, not a factor. 14 is the PVWatts default. */
  lossesPct: number;
  arrayType: ArrayType;
};

/**
 * A cache key for one plane at one place.
 *
 * Coordinates are rounded to a tenth of a degree — about 11 km, and NSRDB's own
 * cells are ~4 km, so two houses that round together are being served the same
 * weather record anyway. It also matches the rounding `solar-orientation`
 * already uses, so the two models agree about what counts as "the same site".
 *
 * Tilt to the half degree and azimuth to the degree: finer than a roof is
 * built, and far finer than the model's own error.
 */
export function yieldCacheKey(r: YieldRequest): string {
  const lat = Math.round(r.lat * 10) / 10;
  const lon = Math.round(r.lon * 10) / 10;
  const tilt = Math.round(Math.max(0, Math.min(90, r.tiltDeg)) * 2) / 2;
  const az = norm360(r.azimuthDeg);
  const losses = Math.round(r.lossesPct);
  return `${lat}|${lon}|${tilt}|${az}|${losses}|${r.arrayType}`;
}

/** 0..359, so a bearing of -10 and one of 350 are one cache entry. */
export function norm360(deg: number): number {
  return Math.round(((deg % 360) + 360) % 360) % 360;
}

/**
 * A company's derate factor as PVWatts' loss percentage.
 *
 * Ours is a FACTOR (0.84 means 84% survives); PVWatts wants the percentage
 * lost. Sending 0.84 where 16 was meant would quote a system losing under one
 * percent of its output — a number that would look merely optimistic rather
 * than obviously wrong, which is the kind that ships.
 *
 * Clamped to the range the API accepts. It rejects anything outside -5..99 with
 * an error, and an error means no production figure at all.
 */
export function derateToLossesPct(derateFactor: number): number {
  if (!Number.isFinite(derateFactor)) return 14;
  const pct = (1 - derateFactor) * 100;
  return Math.max(-5, Math.min(99, Math.round(pct * 10) / 10));
}

/** The query PVWatts v8 expects. Always a 1 kW system — see the header. */
export function pvwattsParams(r: YieldRequest, apiKey: string): URLSearchParams {
  return new URLSearchParams({
    api_key: apiKey,
    lat: String(r.lat),
    lon: String(r.lon),
    system_capacity: "1",
    azimuth: String(norm360(r.azimuthDeg)),
    tilt: String(Math.max(0, Math.min(90, r.tiltDeg))),
    // 1 = fixed roof mount, 0 = fixed open rack.
    array_type: r.arrayType === "roof" ? "1" : "0",
    module_type: "0",
    // ALREADY a percentage. `planeFor` converts the company's derate factor
    // once, on the way in; converting again here read 16 as a factor, produced
    // -1500, and clamped to -5 — a system that GAINS five percent. Every
    // production figure came back about 22% high, and it looked like a
    // plausible number for a good roof rather than an obvious error.
    losses: String(Math.max(-5, Math.min(99, Math.round(r.lossesPct)))),
    timeframe: "monthly",
  });
}

export type YieldResult = {
  /** kWh per kW-DC per year on this plane at this place. */
  kwhPerKwYear: number;
  /** Twelve monthly figures, same units. The shape of the customer's year. */
  monthly: number[];
  /** Which NSRDB station answered, for the record. */
  station: string | null;
};

/**
 * Read PVWatts' answer, or null if it did not give one.
 *
 * Null rather than a thrown error or a zero: the caller falls back to the old
 * market-average model and says so. A production figure of zero would render as
 * a system that makes nothing, which is worse than an estimate.
 *
 * `errors` is checked even on a 200 — PVWatts answers a bad request with HTTP
 * 200 and a populated `errors` array, so status alone reports success on a
 * response carrying no outputs at all.
 */
export function readPvwatts(body: unknown): YieldResult | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const errors = b.errors;
  if (Array.isArray(errors) && errors.length > 0) return null;

  const outputs = b.outputs as Record<string, unknown> | undefined;
  if (!outputs) return null;

  const annual = outputs.ac_annual;
  if (typeof annual !== "number" || !Number.isFinite(annual) || annual <= 0) return null;

  const monthlyRaw = outputs.ac_monthly;
  const monthly =
    Array.isArray(monthlyRaw) && monthlyRaw.length === 12 && monthlyRaw.every((m) => typeof m === "number" && Number.isFinite(m))
      ? (monthlyRaw as number[]).map((m) => Math.round(m))
      : [];

  const info = b.station_info as Record<string, unknown> | undefined;
  const station = typeof info?.location === "string" ? info.location : null;

  return { kwhPerKwYear: Math.round(annual * 10) / 10, monthly, station };
}

/**
 * A sanity rail on anything claiming to be a specific yield.
 *
 * The best plane in the sunniest part of the country lands near 2,000; a north
 * wall in Seattle is a few hundred. A figure outside that is not a yield — it
 * is a units mistake, a system capacity that was not 1 kW, or a response shape
 * that changed under us. Rejecting it falls back to the old model rather than
 * quoting a homeowner a system that makes ten times what it can.
 */
export const YIELD_MIN = 100;
export const YIELD_MAX = 2600;

export function plausibleYield(kwhPerKwYear: number): boolean {
  return (
    Number.isFinite(kwhPerKwYear) && kwhPerKwYear >= YIELD_MIN && kwhPerKwYear <= YIELD_MAX
  );
}

/**
 * What one array makes in year one: its size, its plane's yield, its shade.
 *
 * The single multiplication, in one place, so the designer's preview and the
 * server's saved figure cannot drift — the same reason `solar-arrays` exists.
 */
export function arrayProductionKwh(args: {
  kwDc: number;
  kwhPerKwYear: number;
  /** 0..100. What the surroundings take away — never sent to PVWatts. */
  shadePct: number | null | undefined;
}): number {
  if (!(args.kwDc > 0) || !(args.kwhPerKwYear > 0)) return 0;
  const shade = Math.max(0, Math.min(100, args.shadePct ?? 0));
  // Quoted under the model like every other production figure — see
  // `PRODUCTION_MARGIN_PCT`. This is a leaf: nothing that calls it may apply
  // the margin again.
  return withProductionMargin(args.kwDc * args.kwhPerKwYear * (1 - shade / 100));
}
