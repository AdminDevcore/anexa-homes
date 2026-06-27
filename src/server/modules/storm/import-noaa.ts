import { prisma } from "@/server/db/client";
import type { StormType } from "@prisma/client";
import { parseCsv, numOrNull, type CsvRow } from "./csv";
import { haversineMiles, type LatLng } from "./geo";
import { IMPORT_BUFFER_MI } from "./config";

// NOAA Storm Events "details" CSV importer. Keeps only hail / wind / tornado
// events within (radius + buffer) of the search center; idempotent on EVENT_ID.
// NOAA wind MAGNITUDE is in knots → convert to mph. Hail MAGNITUDE is inches.

const KNOTS_TO_MPH = 1.15078;

export type ImportResult = {
  source: string;
  parsed: number;
  imported: number;
  skipped: number;
};

function classify(eventType: string): StormType | null {
  const t = eventType.toLowerCase();
  if (t.includes("hail")) return "hail";
  if (t.includes("tornado")) return "tornado";
  if (t.includes("wind")) return "wind"; // Thunderstorm/High/Strong Wind
  return null;
}

/** Build the event date from NOAA's numeric BEGIN_* columns, falling back to the
 *  human BEGIN_DATE_TIME ("28-APR-21 18:30:00") string. */
function parseNoaaDate(row: CsvRow): Date | null {
  const ym = row.BEGIN_YEARMONTH;
  if (ym && ym.length >= 6) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(4, 6));
    const day = Number(row.BEGIN_DAY || "1") || 1;
    const tRaw = (row.BEGIN_TIME || "0").padStart(4, "0");
    const hh = Number(tRaw.slice(0, 2)) || 0;
    const mm = Number(tRaw.slice(2, 4)) || 0;
    if (year && month) return new Date(Date.UTC(year, month - 1, day, hh, mm));
  }
  const dt = row.BEGIN_DATE_TIME;
  if (dt) {
    const d = new Date(dt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export async function importNoaaCsv(
  companyId: string,
  text: string,
  center: LatLng,
  radiusMiles: number,
): Promise<ImportResult> {
  const { rows } = parseCsv(text);
  const maxDist = radiusMiles + IMPORT_BUFFER_MI;
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const type = classify(row.EVENT_TYPE || "");
    const lat = numOrNull(row.BEGIN_LAT);
    const lng = numOrNull(row.BEGIN_LON);
    const eventAt = parseNoaaDate(row);
    const externalId = (row.EVENT_ID || "").trim() || null;
    if (!type || lat == null || lng == null || !eventAt || !externalId) {
      skipped++;
      continue;
    }
    if (haversineMiles(center, { lat, lng }) > maxDist) {
      skipped++;
      continue;
    }
    const mag = numOrNull(row.MAGNITUDE);
    const hailSizeIn = type === "hail" ? mag : null;
    const windSpeedMph = type === "wind" && mag != null ? Math.round(mag * KNOTS_TO_MPH) : null;
    const tornadoScale = type === "tornado" ? (row.TOR_F_SCALE || "").trim() || null : null;
    const base = {
      type,
      eventAt,
      lat,
      lng,
      hailSizeIn,
      windSpeedMph,
      tornadoScale,
      magnitude: mag,
      city: (row.BEGIN_LOCATION || "").trim() || null,
      county: (row.CZ_NAME || "").trim() || null,
      state: (row.STATE || "").trim() || null,
      narrative: (row.EVENT_NARRATIVE || "").trim() || null,
    };
    await prisma.stormEvent.upsert({
      where: {
        companyId_source_externalId: { companyId, source: "noaa_storm_events", externalId },
      },
      create: { companyId, source: "noaa_storm_events", externalId, ...base },
      update: base,
    });
    imported++;
  }

  return { source: "noaa_storm_events", parsed: rows.length, imported, skipped };
}
