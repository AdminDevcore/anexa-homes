import { prisma } from "@/server/db/client";
import type { StormType } from "@prisma/client";
import { parseCsv, numOrNull } from "./csv";
import { haversineMiles, type LatLng } from "./geo";
import { IMPORT_BUFFER_MI } from "./config";
import type { ImportResult } from "./import-noaa";

// SPC daily storm reports importer. Three per-day CSVs (hail / wind / torn) from
// spc.noaa.gov. Columns: Time, <metric>, Location, County, State, Lat, Lon, Comments.
// Hail "Size" is hundredths of an inch (100 = 1.00"); wind "Speed" is mph;
// tornado "F_Scale" is the F/EF number. Idempotent on a synthetic key.

export type SpcKind = "hail" | "wind" | "torn";
const KIND_TYPE: Record<SpcKind, StormType> = { hail: "hail", wind: "wind", torn: "tornado" };

/** YYMMDD (UTC) for SPC report URLs. */
export function yymmdd(date: Date): string {
  const y = String(date.getUTCFullYear()).slice(2);
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function spcUrl(kind: SpcKind, date: Date, today: boolean): string {
  const base = "https://www.spc.noaa.gov/climo/reports";
  return today ? `${base}/today_${kind}.csv` : `${base}/${yymmdd(date)}_rpts_${kind}.csv`;
}

function eventTime(reportDate: Date, hhmm: string): Date {
  const t = (hhmm || "").replace(/[^0-9]/g, "").padStart(4, "0");
  const hh = Number(t.slice(0, 2)) || 0;
  const mm = Number(t.slice(2, 4)) || 0;
  return new Date(
    Date.UTC(reportDate.getUTCFullYear(), reportDate.getUTCMonth(), reportDate.getUTCDate(), hh, mm),
  );
}

export async function importSpcCsv(
  companyId: string,
  kind: SpcKind,
  text: string,
  reportDate: Date,
  center: LatLng,
  radiusMiles: number,
): Promise<ImportResult> {
  const { rows } = parseCsv(text);
  const type = KIND_TYPE[kind];
  const maxDist = radiusMiles + IMPORT_BUFFER_MI;
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const lat = numOrNull(row.Lat);
    const lng = numOrNull(row.Lon);
    if (lat == null || lng == null) {
      skipped++;
      continue;
    }
    if (haversineMiles(center, { lat, lng }) > maxDist) {
      skipped++;
      continue;
    }
    const time = row.Time || "";
    const externalId = `spc:${kind}:${yymmdd(reportDate)}:${time}:${lat}:${lng}`;
    const sizeRaw = numOrNull(row.Size); // hundredths of an inch
    const hailSizeIn = kind === "hail" && sizeRaw != null ? sizeRaw / 100 : null;
    const windSpeedMph = kind === "wind" ? numOrNull(row.Speed) : null;
    const fScale = kind === "torn" ? numOrNull(row.F_Scale) : null;
    const tornadoScale = fScale != null ? `EF${fScale}` : null;
    const base = {
      type,
      eventAt: eventTime(reportDate, time),
      lat,
      lng,
      hailSizeIn,
      windSpeedMph: windSpeedMph != null ? Math.round(windSpeedMph) : null,
      tornadoScale,
      magnitude: sizeRaw,
      city: (row.Location || "").trim() || null,
      county: (row.County || "").trim() || null,
      state: (row.State || "").trim() || null,
      narrative: (row.Comments || "").trim() || null,
    };
    await prisma.stormEvent.upsert({
      where: { companyId_source_externalId: { companyId, source: "spc_reports", externalId } },
      create: { companyId, source: "spc_reports", externalId, ...base },
      update: base,
    });
    imported++;
  }

  return { source: `spc_${kind}`, parsed: rows.length, imported, skipped };
}

/** Fetch + import all three SPC report kinds for one day. `today` uses the
 *  rolling today_*.csv aliases (the dated files only appear after the day ends). */
export async function importSpcDay(
  companyId: string,
  reportDate: Date,
  center: LatLng,
  radiusMiles: number,
  today = false,
): Promise<ImportResult[]> {
  const kinds: SpcKind[] = ["hail", "wind", "torn"];
  const results: ImportResult[] = [];
  for (const kind of kinds) {
    try {
      const res = await fetch(spcUrl(kind, reportDate, today), {
        headers: { "User-Agent": "AnexaHomesCRM/1.0 (storm-intelligence)" },
        cache: "no-store",
      });
      if (!res.ok) {
        results.push({ source: `spc_${kind}`, parsed: 0, imported: 0, skipped: 0 });
        continue;
      }
      const text = await res.text();
      results.push(await importSpcCsv(companyId, kind, text, reportDate, center, radiusMiles));
    } catch {
      results.push({ source: `spc_${kind}`, parsed: 0, imported: 0, skipped: 0 });
    }
  }
  return results;
}
