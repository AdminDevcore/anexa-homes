import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import {
  cachedRoofPlanes,
  resolveRoofPlanes,
  roofCacheKey,
} from "@/server/modules/solar/roof-planes";

/**
 * The roof cache, against a real database and a stubbed Google.
 *
 * Stubbed on purpose and not merely for speed: a test that hits the live Solar
 * API fails when the key is unset, when the machine is offline and when the
 * quota is spent — none of which say anything about this code. What IS ours is
 * the caching, the negative caching, the refusal to remember a timeout, and the
 * refusal to ask twice for one building. All of that runs for real here.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.GOOGLE_MAPS_API_KEY = "test-key";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

// 404 Shoreline Street, Plano — the roof this was built to read.
const LAT = 33.0198;
const LNG = -96.6989;

/** A Solar API response, trimmed to what we read. */
const buildingOk = () => ({
  imageryQuality: "HIGH",
  imageryDate: { year: 2025, month: 3, day: 14 },
  solarPotential: {
    roofSegmentStats: [
      {
        pitchDegrees: 22.6,
        azimuthDegrees: 187.4,
        stats: { areaMeters2: 61.2 },
        center: { latitude: LAT - 0.00005, longitude: LNG },
      },
      {
        pitchDegrees: 22.6,
        azimuthDegrees: 7.4,
        stats: { areaMeters2: 58.9 },
        center: { latitude: LAT + 0.00005, longitude: LNG },
      },
    ],
    solarPanels: [
      { center: { latitude: LAT - 0.00005, longitude: LNG }, segmentIndex: 0 },
      { center: { latitude: LAT + 0.00005, longitude: LNG }, segmentIndex: 1 },
    ],
  },
});

function stubGoogle(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(status === 200 ? JSON.stringify(body) : "", {
        status,
        headers: { "content-type": "application/json" },
      })
  );
}

beforeEach(async () => {
  await db.solarRoofCache.deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
});

describe("asking Google once and remembering", () => {
  it("stores the planes and the panels against the building", async () => {
    const spy = stubGoogle(buildingOk());
    const roof = await resolveRoofPlanes(LAT, LNG);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(roof?.segments).toHaveLength(2);
    expect(roof?.imageryDate).toBe("March 2025");

    const row = await db.solarRoofCache.findUnique({ where: { key: roofCacheKey(LAT, LNG) } });
    expect(row?.found).toBe(true);
    expect(row?.imageryQuality).toBe("HIGH");
    expect((row?.segments as unknown[]).length).toBe(2);
    expect((row?.panels as unknown[]).length).toBe(2);
  });

  it("does not ask twice for the same building", async () => {
    const spy = stubGoogle(buildingOk());
    await resolveRoofPlanes(LAT, LNG);
    await resolveRoofPlanes(LAT, LNG);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * Six decimals is about 11 cm, so the key is a house. Rounding coarser would
   * hand one deal the roof next door, which is the one error this lookup exists
   * to make impossible.
   */
  it("keeps the house next door separate", async () => {
    const spy = stubGoogle(buildingOk());
    await resolveRoofPlanes(LAT, LNG);
    await resolveRoofPlanes(LAT + 0.0003, LNG);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await db.solarRoofCache.count()).toBe(2);
  });

  it("asks the Solar API for the deal's own coordinate", async () => {
    let seen = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      seen = String(input);
      return new Response(JSON.stringify(buildingOk()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await resolveRoofPlanes(LAT, LNG);
    expect(seen).toContain("solar.googleapis.com");
    expect(seen).toContain("buildingInsights:findClosest");
    expect(seen).toContain(`location.latitude=${LAT}`);
    expect(seen).toContain(`location.longitude=${LNG}`);
  });
});

describe("what happens when there is no roof to read", () => {
  /**
   * A 404 is Google saying it has no model for this address, which is the truth
   * about that address for months. Remembering it is the difference between one
   * request and one per page load.
   */
  it("remembers a no, and stops asking", async () => {
    const spy = stubGoogle(null, 404);
    expect(await resolveRoofPlanes(LAT, LNG)).toBeNull();
    expect(await resolveRoofPlanes(LAT, LNG)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);

    const row = await db.solarRoofCache.findUnique({ where: { key: roofCacheKey(LAT, LNG) } });
    expect(row?.found).toBe(false);
  });

  /**
   * A timeout is NOT an answer. Caching one would retire the feature for that
   * address for a month over a moment of bad network.
   */
  it("never remembers a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await resolveRoofPlanes(LAT, LNG)).toBeNull();
    expect(await db.solarRoofCache.count()).toBe(0);
  });

  it("does not remember a 500 either", async () => {
    stubGoogle(null, 500);
    expect(await resolveRoofPlanes(LAT, LNG)).toBeNull();
    expect(await db.solarRoofCache.count()).toBe(0);
  });

  /**
   * The state a company sits in until somebody enables the Solar API on the
   * Cloud project. It has to behave exactly like no roof, not like an error a
   * rep has to read.
   */
  it("treats a refused key as no roof, and does not cache it", async () => {
    stubGoogle(null, 403);
    expect(await resolveRoofPlanes(LAT, LNG)).toBeNull();
    expect(await db.solarRoofCache.count()).toBe(0);
  });

  it("asks nothing at all for a deal with no coordinate", async () => {
    const spy = stubGoogle(buildingOk());
    expect(await resolveRoofPlanes(null, null)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the page load never waits on Google", () => {
  it("returns nothing on a cache miss, and does not fetch", async () => {
    const spy = stubGoogle(buildingOk());
    expect(await cachedRoofPlanes(LAT, LNG)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the roof once it has been looked up", async () => {
    stubGoogle(buildingOk());
    await resolveRoofPlanes(LAT, LNG);
    vi.restoreAllMocks();
    const spy = stubGoogle(buildingOk());
    expect((await cachedRoofPlanes(LAT, LNG))?.segments).toHaveLength(2);
    expect(spy).not.toHaveBeenCalled();
  });

  /** A remembered "no roof here" is not a roof. */
  it("returns nothing for a building Google has no model for", async () => {
    stubGoogle(null, 404);
    await resolveRoofPlanes(LAT, LNG);
    expect(await cachedRoofPlanes(LAT, LNG)).toBeNull();
  });

  it("re-asks once a stored answer has gone stale", async () => {
    const spy = stubGoogle(buildingOk());
    await resolveRoofPlanes(LAT, LNG);
    await db.solarRoofCache.update({
      where: { key: roofCacheKey(LAT, LNG) },
      // Older than the 180-day life of a stored roof.
      data: { fetchedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
    });
    // Stale is not a hit: the page load gets nothing rather than a roof from
    // before the house was re-shingled.
    expect(await cachedRoofPlanes(LAT, LNG)).toBeNull();

    spy.mockClear();
    expect(await resolveRoofPlanes(LAT, LNG)).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    // And the row is refreshed rather than duplicated.
    expect(await db.solarRoofCache.count()).toBe(1);
  });
});
