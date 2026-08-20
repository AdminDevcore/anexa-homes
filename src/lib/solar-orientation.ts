/**
 * What the direction and the slope of a roof do to a system's output.
 *
 * Until this module existed, production was `kW × kwhPerKwYear × derate` — one
 * company-wide yield figure that gave a north-facing 10:12 roof exactly the
 * same annual kWh as a south-facing 4:12 one. That number is fine as a market
 * average and useless as a quote for a particular house, which is the whole
 * problem: a homeowner on the wrong side of the ridge was being promised a
 * south-facing system's output.
 *
 * What this returns is a RATIO, never an absolute. `kwhPerKwYear` stays the
 * anchor — it is the yield of a well-oriented array in the company's market —
 * and `orientationFactor` scales it for the plane the panels actually sit on.
 * Keeping it relative is what makes it safe: the clear-sky model below is good
 * at "how much worse is west than south" and not good enough to be trusted for
 * "how many kWh", so it is only ever asked the first question.
 *
 * Accuracy: clear-sky beam and an isotropic sky, no TMY weather file, no
 * horizon, no shading. Against PVWatts (which does use TMY) it lands within a
 * few points for ordinary residential planes, and is PESSIMISTIC toward east,
 * west and north because a clear-sky year over-weights direct beam. For a
 * bankable figure the honest upgrade is PVWatts v8 keyed on the deal's
 * own coordinates; `orientationFactor` is the seam that swaps out.
 *
 * Angle conventions, which are the thing most likely to be got wrong:
 *   - AZIMUTH is the compass direction the panels FACE, degrees clockwise from
 *     true north. 0 = north, 90 = east, 180 = south, 270 = west. This is the
 *     PVWatts convention.
 *   - TILT is degrees off horizontal. 0 = flat, 90 = vertical wall.
 *   - Vectors are ENU (east, north, up), which is why there is no sign
 *     convention to remember in the dot products below.
 */

const DEG = Math.PI / 180;

/** Ground reflectance. 0.2 is the standard assumption for grass and shingle. */
const ALBEDO = 0.2;

/**
 * ASHRAE's clear-sky diffuse coefficient, as a share of beam.
 *
 * Really varies 0.06–0.14 across the year. Held constant because it moves the
 * RATIO this module returns by well under a point, and a fake monthly table
 * would imply a precision the rest of the model does not have.
 */
const DIFFUSE_SHARE = 0.1;

/**
 * The sampling grid: every 5th day of the year, every 30 minutes of the day.
 *
 * Fine enough that halving either step changes a factor by <0.2%, coarse
 * enough that scanning 60 tilts for the optimum stays instant in a browser.
 */
const DAY_STEP = 5;
const MINUTES_STEP = 30;

type Vec = { e: number; n: number; u: number };

/** Solar declination for a day of the year, degrees. Cooper's equation. */
function declinationDeg(dayOfYear: number): number {
  return 23.45 * Math.sin(DEG * ((360 * (284 + dayOfYear)) / 365));
}

/**
 * Where the sun is, as an ENU unit vector. `u <= 0` means it is down.
 *
 * `hourAngle` is degrees from solar noon, negative in the morning — solar time,
 * not clock time. Longitude and the equation of time are deliberately absent:
 * they shift the whole day east or west, and a full year of it is symmetric,
 * so they cancel out of an annual total.
 */
function sunVector(latDeg: number, dayOfYear: number, hourAngleDeg: number): Vec {
  const lat = latDeg * DEG;
  const dec = declinationDeg(dayOfYear) * DEG;
  const ha = hourAngleDeg * DEG;

  const sinAlt =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const cosAlt = Math.cos(alt);
  if (cosAlt < 1e-6) return { e: 0, n: 0, u: sinAlt };

  // Azimuth clockwise from north, via atan2 so the east/west half is right
  // without a separate "afternoon" branch — the classic acos formulation needs
  // one, and forgetting it mirrors every afternoon hour onto the morning.
  const sinAz = (-Math.cos(dec) * Math.sin(ha)) / cosAlt;
  const cosAz = (Math.sin(dec) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * cosAlt);
  const az = Math.atan2(sinAz, cosAz);

  return { e: cosAlt * Math.sin(az), n: cosAlt * Math.cos(az), u: sinAlt };
}

/** A plane's outward normal as an ENU unit vector. */
function surfaceNormal(tiltDeg: number, azimuthDeg: number): Vec {
  const t = tiltDeg * DEG;
  const a = azimuthDeg * DEG;
  return { e: Math.sin(t) * Math.sin(a), n: Math.sin(t) * Math.cos(a), u: Math.cos(t) };
}

const dot = (a: Vec, b: Vec) => a.e * b.e + a.n * b.n + a.u * b.u;

/**
 * Clear-sky direct normal irradiance, W/m².
 *
 * Extraterrestrial beam attenuated through the air mass the sun is shining
 * through. Kasten–Young for the air mass rather than 1/cos(z), because 1/cos(z)
 * goes to infinity at sunrise and hands low winter sun an unearned share of the
 * year.
 */
function clearSkyDni(dayOfYear: number, sinAlt: number): number {
  if (sinAlt <= 0) return 0;
  const altDeg = Math.asin(Math.min(1, sinAlt)) / DEG;
  const airMass = 1 / (sinAlt + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));
  const extraterrestrial = 1367 * (1 + 0.033 * Math.cos(DEG * ((360 * dayOfYear) / 365)));
  return extraterrestrial * Math.pow(0.7, Math.pow(airMass, 0.678));
}

/**
 * Annual plane-of-array irradiation for one tilt/azimuth, in arbitrary but
 * CONSISTENT units — only ever used as the numerator and denominator of a
 * ratio, so the unit never escapes this module.
 */
function annualPoa(latDeg: number, tiltDeg: number, azimuthDeg: number): number {
  const normal = surfaceNormal(tiltDeg, azimuthDeg);
  const skyView = (1 + Math.cos(tiltDeg * DEG)) / 2;
  const groundView = (1 - Math.cos(tiltDeg * DEG)) / 2;
  let total = 0;

  for (let day = 1; day <= 365; day += DAY_STEP) {
    for (let minutes = 0; minutes < 1440; minutes += MINUTES_STEP) {
      // 15° of hour angle per hour, zero at solar noon.
      const hourAngle = (minutes / 60 - 12) * 15;
      const sun = sunVector(latDeg, day, hourAngle);
      if (sun.u <= 0) continue;

      const dni = clearSkyDni(day, sun.u);
      const dhi = DIFFUSE_SHARE * dni * sun.u;
      const ghi = dni * sun.u + dhi;

      // Backside of the plane earns nothing; max(0) rather than abs().
      const beam = dni * Math.max(0, dot(sun, normal));
      total += beam + dhi * skyView + ghi * ALBEDO * groundView;
    }
  }
  return total;
}

/** Latitude rounded for caching. A tenth of a degree is ~11 km; factors do not
 *  move measurably over that, and it keeps a page of arrays to one computation. */
const latKey = (lat: number) => Math.round(lat * 10) / 10;

const optimalCache = new Map<number, { tiltDeg: number; poa: number }>();

/**
 * The best tilt a due-south plane could have here, and its annual POA.
 *
 * Found by scanning rather than by the usual `tilt ≈ latitude × 0.87 + 3.1`
 * rule of thumb, so the optimum is self-consistent with the same model the
 * numerator uses. A factor of exactly 1.0 then means "as good as this site
 * gets", which is the claim the number is making.
 */
export function optimalSouthFacing(lat: number): { tiltDeg: number; poa: number } {
  const key = latKey(lat);
  const cached = optimalCache.get(key);
  if (cached) return cached;

  let best = { tiltDeg: 0, poa: -1 };
  for (let tilt = 0; tilt <= 60; tilt += 1) {
    // Southern hemisphere plants face north; the optimum has to be free to go
    // there rather than being pinned to 180.
    const poa = annualPoa(key, tilt, key >= 0 ? 180 : 0);
    if (poa > best.poa) best = { tiltDeg: tilt, poa };
  }
  optimalCache.set(key, best);
  return best;
}

/** Convenience for the UI's "what should this roof be?" hint. */
export function optimalTiltDeg(lat: number): number {
  return optimalSouthFacing(lat).tiltDeg;
}

const factorCache = new Map<string, number>();

/**
 * How this plane compares with the best one available at this latitude, 0..1.
 *
 * Returns 1 when the orientation is unknown, which is the whole no-regression
 * story: an array nobody has told us about is priced exactly as it was before
 * this module existed, and the UI asks for the orientation rather than the
 * maths quietly inventing one.
 */
export function orientationFactor(args: {
  lat: number | null | undefined;
  tiltDeg: number | null | undefined;
  azimuthDeg: number | null | undefined;
}): number {
  const { lat, tiltDeg, azimuthDeg } = args;
  if (lat == null || !Number.isFinite(lat)) return 1;
  if (tiltDeg == null || !Number.isFinite(tiltDeg)) return 1;
  if (azimuthDeg == null || !Number.isFinite(azimuthDeg)) return 1;

  const tilt = Math.max(0, Math.min(90, tiltDeg));
  // Normalised into 0..360 so 350 and -10 are one cache entry and one answer.
  const az = ((azimuthDeg % 360) + 360) % 360;
  const key = `${latKey(lat)}|${Math.round(tilt * 2) / 2}|${Math.round(az)}`;
  const cached = factorCache.get(key);
  if (cached !== undefined) return cached;

  const best = optimalSouthFacing(lat);
  const factor = best.poa > 0 ? annualPoa(latKey(lat), tilt, az) / best.poa : 1;
  // A plane can beat the "optimal" scan by a hair when its tilt falls between
  // two whole degrees. Clamping keeps "% of optimal" an honest label.
  const clamped = Math.max(0, Math.min(1, factor));
  factorCache.set(key, clamped);
  return clamped;
}

// ---------------------------------------------------------------------------
// Roof pitch
// ---------------------------------------------------------------------------

/** The pitches a residential roof is actually framed at, steepest last. */
export const COMMON_PITCHES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12] as const;

/** "4/12" → 18.4°. Rise over a 12-inch run is how a roofer states a slope. */
export function pitchToTiltDeg(rise: number): number {
  return Math.round(((Math.atan(rise / 12) / DEG) * 10)) / 10;
}

/** 18.4° → "4/12", to the nearest whole rise. The inverse, for display. */
export function tiltDegToPitch(tiltDeg: number): number {
  return Math.round(Math.tan(tiltDeg * DEG) * 12);
}

/** 180 → "S", 225 → "SW". Eight points is as fine as a rep needs to read. */
export function compassLabel(azimuthDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const az = ((azimuthDeg % 360) + 360) % 360;
  return points[Math.round(az / 45) % 8];
}
