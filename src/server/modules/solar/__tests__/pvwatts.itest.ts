import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { cachedPlaneYields, planeFor, resolvePlaneYields } from "@/server/modules/solar/pvwatts";
import { yieldCacheKey, type YieldRequest } from "@/lib/solar-pvwatts";

/**
 * The PVWatts cache, against a real database and a stubbed NREL.
 *
 * The API is stubbed on purpose and not merely for speed: a test that hits the
 * live host fails when the shared key is rate-limited, when the machine is
 * offline, and when the service is fine but slow — none of which say anything
 * about this code. It would also have gone on passing through the domain being
 * retired, which is the failure that actually happened. What IS ours is the caching, the deduplication, the fallback and
 * the refusal to store nonsense, and all of that is exercised here for real.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const PLANE: YieldRequest = {
  lat: 33.0048,
  lon: -96.7178,
  tiltDeg: 26.6,
  azimuthDeg: 180,
  lossesPct: 16,
  arrayType: "roof",
};

/** A real PVWatts v8 response, trimmed to what we read. */
const nrelOk = (annual: number) => ({
  errors: [],
  outputs: {
    ac_annual: annual,
    ac_monthly: [100, 110, 130, 140, 150, 155, 160, 158, 140, 125, 105, 95],
  },
  station_info: { location: "Dallas" },
});

function stubNrel(handler: (url: string) => unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const body = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

beforeEach(async () => {
  await db.solarYieldCache.deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
});

describe("asking NREL once and remembering", () => {
  it("stores what it was told, keyed by the plane", async () => {
    const spy = stubNrel(() => nrelOk(1587.4));
    const got = await resolvePlaneYields([PLANE]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(got.get(yieldCacheKey(PLANE))?.kwhPerKwYear).toBe(1587.4);

    const row = await db.solarYieldCache.findUnique({ where: { key: yieldCacheKey(PLANE) } });
    expect(row?.kwhPerKwYear).toBe(1587.4);
    expect(row?.station).toBe("Dallas");
    // The percentage LOST, not the factor. 0.84 stored here would describe a
    // system losing under one percent of its output.
    expect(row?.lossesPct).toBe(16);
  });

  it("does not ask twice for the same plane", async () => {
    const spy = stubNrel(() => nrelOk(1587.4));
    await resolvePlaneYields([PLANE]);
    await resolvePlaneYields([PLANE]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * A roof with four arrays on one plane is ONE question. Asking it four times
   * is how a rate-limited key runs out on a single save.
   */
  it("asks once for four arrays that share a plane", async () => {
    const spy = stubNrel(() => nrelOk(1587.4));
    await resolvePlaneYields([PLANE, PLANE, { ...PLANE, lat: PLANE.lat + 0.001 }, PLANE]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks once per genuinely different plane", async () => {
    const spy = stubNrel(() => nrelOk(1400));
    await resolvePlaneYields([PLANE, { ...PLANE, azimuthDeg: 270 }]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await db.solarYieldCache.count()).toBe(2);
  });

  it("asks for the 1 kW system the cache is built on", async () => {
    let seen = "";
    stubNrel((url) => {
      seen = url;
      return nrelOk(1587.4);
    });
    await resolvePlaneYields([PLANE]);
    expect(seen).toContain("system_capacity=1");
    expect(seen).toContain("tilt=26.6");
    expect(seen).toContain("azimuth=180");
  });
});

describe("nothing NREL says is taken on faith", () => {
  /** PVWatts answers a bad request with HTTP 200 and a populated `errors`. */
  it("stores nothing when a 200 carries an error", async () => {
    stubNrel(() => ({ errors: ["azimuth is required"], outputs: {} }));
    const got = await resolvePlaneYields([PLANE]);
    expect(got.size).toBe(0);
    expect(await db.solarYieldCache.count()).toBe(0);
  });

  it("stores nothing on a non-200", async () => {
    stubNrel(() => ({ errors: [] }), 429);
    expect((await resolvePlaneYields([PLANE])).size).toBe(0);
    expect(await db.solarYieldCache.count()).toBe(0);
  });

  it("stores nothing when the request throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENOTFOUND"));
    expect((await resolvePlaneYields([PLANE])).size).toBe(0);
    expect(await db.solarYieldCache.count()).toBe(0);
  });

  /**
   * A yield ten times too big would quote a homeowner a system that cannot
   * exist, and on the page it would look merely optimistic.
   */
  it("refuses an implausible yield rather than caching it", async () => {
    stubNrel(() => nrelOk(15870));
    expect((await resolvePlaneYields([PLANE])).size).toBe(0);
    expect(await db.solarYieldCache.count()).toBe(0);
  });

  it("refuses a zero", async () => {
    stubNrel(() => nrelOk(0));
    expect((await resolvePlaneYields([PLANE])).size).toBe(0);
  });
});

describe("the cache-only read a page load uses", () => {
  it("never reaches the network", async () => {
    const spy = stubNrel(() => nrelOk(1587.4));
    const got = await cachedPlaneYields([PLANE]);
    expect(spy).not.toHaveBeenCalled();
    expect(got.size).toBe(0);
  });

  it("returns what a previous save stored", async () => {
    stubNrel(() => nrelOk(1587.4));
    await resolvePlaneYields([PLANE]);
    vi.restoreAllMocks();

    const spy = vi.spyOn(globalThis, "fetch");
    const got = await cachedPlaneYields([PLANE]);
    expect(spy).not.toHaveBeenCalled();
    expect(got.get(yieldCacheKey(PLANE))?.kwhPerKwYear).toBe(1587.4);
  });
});

describe("which arrays even have a plane to price", () => {
  it("has none without a coordinate", () => {
    expect(planeFor({ lat: null, lon: -96.7, tiltDeg: 20, azimuthDeg: 180, derateFactor: 0.84, arrayType: "roof" })).toBeNull();
    expect(planeFor({ lat: 33, lon: null, tiltDeg: 20, azimuthDeg: 180, derateFactor: 0.84, arrayType: "roof" })).toBeNull();
  });

  /** An array nobody has described keeps the market average, exactly as it did
   *  before any of this existed. */
  it("has none for an array with no facing or pitch", () => {
    expect(planeFor({ lat: 33, lon: -96.7, tiltDeg: null, azimuthDeg: 180, derateFactor: 0.84, arrayType: "roof" })).toBeNull();
    expect(planeFor({ lat: 33, lon: -96.7, tiltDeg: 20, azimuthDeg: null, derateFactor: 0.84, arrayType: "roof" })).toBeNull();
  });

  it("turns the company's derate factor into the loss percentage NREL wants", () => {
    const p = planeFor({ lat: 33, lon: -96.7, tiltDeg: 20, azimuthDeg: 180, derateFactor: 0.84, arrayType: "roof" })!;
    expect(p.lossesPct).toBe(16);
  });
});
