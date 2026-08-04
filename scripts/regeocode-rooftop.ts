/**
 * One-off: re-geocode existing deals to rooftop precision.
 *
 * Every lead geocoded before this ran got its coordinates from OpenStreetMap
 * Nominatim, which for TIGER-imported streets (no building in OSM, only the road
 * with `tiger:reviewed=no`) INTERPOLATES the house number along the centreline.
 * On 536 Greenway Drive, Saginaw that landed 63 m — three houses — from the real
 * roof, and the deal's aerial view framed the neighbour's.
 *
 * Only writes when Google returns ROOFTOP. A hand-dragged pin sits on the right
 * roof already, so overwriting it with an interpolated guess would be a
 * downgrade; ROOFTOP is the one answer that beats a human.
 *
 *   npx tsx scripts/regeocode-rooftop.ts            # report only, writes nothing
 *   npx tsx scripts/regeocode-rooftop.ts --apply    # write the upgrades
 *   npx tsx scripts/regeocode-rooftop.ts --apply --min-shift=0   # rewrite all rooftop hits
 *
 * DATABASE_URL and GOOGLE_MAPS_API_KEY must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";
import { googleGeocode, googleGeocodeConfigured } from "../src/server/modules/geo/google";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const minShiftArg = process.argv.find((a) => a.startsWith("--min-shift="));
/**
 * Metres of disagreement before a rewrite is worth it. Below this the stored
 * point is already on the right roof and rewriting only churns `geocodedAt`.
 */
const MIN_SHIFT_M = minShiftArg ? Number(minShiftArg.split("=")[1]) : 15;

/** Metres between two coordinates — equirectangular is plenty at house scale. */
function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const mLat = (b.lat - a.lat) * 111_320;
  const mLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(mLat, mLng);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!googleGeocodeConfigured()) {
    console.error("GOOGLE_MAPS_API_KEY is not set — nothing to upgrade to. Aborting.");
    process.exit(1);
  }

  const leads = await prisma.lead.findMany({
    where: { address: { not: null } },
    select: { id: true, address: true, city: true, state: true, zip: true, lat: true, lng: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${leads.length} deals with an address. ${apply ? "APPLYING" : "dry run"}, min shift ${MIN_SHIFT_M} m.\n`);

  let rooftop = 0;
  let moved = 0;
  let unmatched = 0;
  let coarse = 0;

  for (const lead of leads) {
    const point = await googleGeocode(lead);
    await sleep(60); // stay well under Google's per-second ceiling

    if (!point) {
      unmatched++;
      console.log(`  ?  ${lead.address} — no Google match`);
      continue;
    }
    if (point.precision !== "ROOFTOP") {
      coarse++;
      continue;
    }
    rooftop++;

    const had = lead.lat != null && lead.lng != null;
    const shift = had ? metresBetween({ lat: lead.lat!, lng: lead.lng! }, point) : Infinity;
    if (had && shift < MIN_SHIFT_M) continue;

    moved++;
    console.log(
      `  →  ${lead.address}, ${lead.city ?? ""} — ${had ? `${shift.toFixed(0)} m off` : "no pin"}` +
        ` → ${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`
    );
    if (apply) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { lat: point.lat, lng: point.lng, geocodedAt: new Date() },
      });
    }
  }

  console.log(
    `\n${rooftop} rooftop matches, ${moved} ${apply ? "corrected" : "would be corrected"},` +
      ` ${coarse} only interpolated (left alone), ${unmatched} unmatched.`
  );
  if (!apply && moved > 0) console.log("Re-run with --apply to write these.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
