import { prisma } from "@/server/db/client";
import { parseCsv, numOrNull } from "@/server/modules/storm/csv";

// Free homeowner data from public county appraisal rolls (Texas CADs etc.).
// The admin uploads a county roll CSV and maps its columns; we match each row to
// the houses on the map by NORMALIZED street address and fill the owner name +
// appraised value. No per-lookup cost. (Phone/email are NOT in county data.)

// Standardize street suffixes + directionals so a CAD "404 SHORELINE ST" matches
// a geocoded "404 Shoreline Street, Plano, TX".
const NORM: Record<string, string> = {
  STREET: "ST", DRIVE: "DR", AVENUE: "AVE", ROAD: "RD", LANE: "LN", COURT: "CT",
  BOULEVARD: "BLVD", CIRCLE: "CIR", PLACE: "PL", TRAIL: "TRL", PARKWAY: "PKWY",
  TERRACE: "TER", HIGHWAY: "HWY", SQUARE: "SQ", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
};

/** Normalize a street line (house number + street) for address matching. Drops
 *  city/state/zip after the first comma, unit designators, and punctuation. */
export function normalizeStreet(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.toUpperCase().split(",")[0];
  s = s.replace(/\b(APT|UNIT|STE|SUITE|#)\b.*$/i, " ");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  const toks = s.split(/\s+/).filter(Boolean).map((t) => NORM[t] ?? t);
  return toks.join(" ").trim();
}

export type OwnerRowMapping = {
  owner: string; // column: owner name
  address: string; // column: situs / property street address
  value?: string; // column: appraised/market value (dollars)
};

export type OwnerImportResult = {
  parsed: number; // rows in the file
  recognized: number; // distinct addresses parsed
  matched: number; // houses on the map matched
  filledNames: number;
  filledValues: number;
};

/** Import a county appraisal roll: match rows to the company's houses by street
 *  address and fill blank owner name + property value. Never overwrites a name a
 *  rep already captured. Bounded DB writes (only matched houses). */
export async function importOwnerRecords(
  companyId: string,
  csvText: string,
  mapping: OwnerRowMapping,
): Promise<OwnerImportResult> {
  const { rows } = parseCsv(csvText);
  const byKey = new Map<string, { owner: string; valueCents: number | null }>();
  for (const r of rows) {
    const key = normalizeStreet(r[mapping.address]);
    if (!key) continue;
    const owner = (r[mapping.owner] ?? "").trim();
    const dollars = mapping.value ? numOrNull(r[mapping.value]) : null;
    byKey.set(key, { owner, valueCents: dollars != null && dollars > 0 ? Math.round(dollars * 100) : null });
  }

  const knocks = await prisma.knock.findMany({
    where: { companyId, address: { not: null } },
    select: { id: true, address: true, contactName: true, propertyValue: true },
  });

  let matched = 0, filledNames = 0, filledValues = 0;
  const updates: Promise<unknown>[] = [];
  for (const k of knocks) {
    const rec = byKey.get(normalizeStreet(k.address));
    if (!rec) continue;
    matched++;
    const data: Record<string, unknown> = {};
    if (!k.contactName && rec.owner) { data.contactName = rec.owner; filledNames++; }
    if (k.propertyValue == null && rec.valueCents != null) {
      data.propertyValue = rec.valueCents;
      data.propertyValueSource = "County appraisal";
      data.propertyValueAt = new Date();
      filledValues++;
    }
    if (Object.keys(data).length) updates.push(prisma.knock.update({ where: { id: k.id }, data }));
  }
  for (let i = 0; i < updates.length; i += 100) {
    await prisma.$transaction(updates.slice(i, i + 100) as never);
  }

  return { parsed: rows.length, recognized: byKey.size, matched, filledNames, filledValues };
}
