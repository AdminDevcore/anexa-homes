import { describe, expect, it } from "vitest";
import { PRODUCTION_MARGIN_FACTOR } from "@/lib/solar-money";
import {
  arrayProductionKwh,
  derateToLossesPct,
  plausibleYield,
  pvwattsParams,
  readPvwatts,
  yieldCacheKey,
  norm360,
} from "../solar-pvwatts";

const REQ = {
  lat: 33.0048,
  lon: -96.7178,
  tiltDeg: 26.6,
  azimuthDeg: 180,
  lossesPct: 16,
  arrayType: "roof" as const,
};

describe("the request PVWatts is sent", () => {
  /**
   * The whole cache depends on this: `ac_annual` for a 1 kW system IS the
   * plane's yield per kW, so one answer serves an array of any size. Sending
   * the real capacity would make every redraw a fresh request.
   */
  it("always asks about a 1 kW system", () => {
    expect(pvwattsParams(REQ, "k").get("system_capacity")).toBe("1");
  });

  it("sends a roof mount as a roof mount — it runs hotter than an open rack", () => {
    expect(pvwattsParams(REQ, "k").get("array_type")).toBe("1");
    expect(pvwattsParams({ ...REQ, arrayType: "ground" }, "k").get("array_type")).toBe("0");
  });

  it("carries the key and the plane", () => {
    const p = pvwattsParams(REQ, "secret");
    expect(p.get("api_key")).toBe("secret");
    expect(p.get("tilt")).toBe("26.6");
    expect(p.get("azimuth")).toBe("180");
  });

  /**
   * `lossesPct` is ALREADY a percentage by the time it reaches here — `planeFor`
   * converts the company's derate factor once, on the way in. Converting again
   * read 16 as a factor, produced -1500, and clamped to -5: a system that GAINS
   * five percent. Every production figure came back about 22% high, which on a
   * page reads as a good roof rather than as an error, and the only reason it
   * was caught was two live calls disagreeing.
   */
  it("sends the loss percentage it was given, without converting it again", () => {
    expect(pvwattsParams(REQ, "k").get("losses")).toBe("16");
    expect(pvwattsParams({ ...REQ, lossesPct: 14 }, "k").get("losses")).toBe("14");
    expect(pvwattsParams({ ...REQ, lossesPct: 0 }, "k").get("losses")).toBe("0");
  });

  it("clamps a loss figure to the range the API accepts", () => {
    expect(pvwattsParams({ ...REQ, lossesPct: 250 }, "k").get("losses")).toBe("99");
    expect(pvwattsParams({ ...REQ, lossesPct: -80 }, "k").get("losses")).toBe("-5");
  });

  it("clamps a tilt that is not a roof", () => {
    expect(pvwattsParams({ ...REQ, tiltDeg: 140 }, "k").get("tilt")).toBe("90");
    expect(pvwattsParams({ ...REQ, tiltDeg: -20 }, "k").get("tilt")).toBe("0");
  });

  it("normalises a bearing rather than sending a negative one", () => {
    expect(pvwattsParams({ ...REQ, azimuthDeg: -10 }, "k").get("azimuth")).toBe("350");
    expect(pvwattsParams({ ...REQ, azimuthDeg: 360 }, "k").get("azimuth")).toBe("0");
  });

  /** Shade varies array by array; the plane's yield does not. Sending it would
   *  make every cache entry single-use. */
  it("never sends shading", () => {
    const p = pvwattsParams(REQ, "k");
    expect(p.has("shading")).toBe(false);
    expect([...p.keys()].some((k) => /shad/i.test(k))).toBe(false);
  });
});

describe("derate to losses", () => {
  /**
   * Ours is a FACTOR, theirs is a PERCENTAGE LOST. Sending 0.84 where 16 was
   * meant quotes a system losing under one percent — optimistic enough to look
   * plausible, which is the kind of unit error that ships.
   */
  it("turns a factor into the percentage lost", () => {
    expect(derateToLossesPct(0.84)).toBe(16);
    expect(derateToLossesPct(0.86)).toBe(14);
    expect(derateToLossesPct(1)).toBe(0);
  });

  it("clamps to the range the API accepts rather than being rejected", () => {
    expect(derateToLossesPct(-2)).toBe(99);
    expect(derateToLossesPct(2)).toBe(-5);
  });

  it("falls back to the PVWatts default on a broken factor", () => {
    expect(derateToLossesPct(Number.NaN)).toBe(14);
  });
});

describe("the cache key", () => {
  it("puts two houses on the same street in one entry", () => {
    const a = yieldCacheKey(REQ);
    const b = yieldCacheKey({ ...REQ, lat: REQ.lat + 0.002, lon: REQ.lon - 0.003 });
    expect(a).toBe(b);
  });

  it("separates two different planes at the same house", () => {
    expect(yieldCacheKey(REQ)).not.toBe(yieldCacheKey({ ...REQ, azimuthDeg: 0 }));
    expect(yieldCacheKey(REQ)).not.toBe(yieldCacheKey({ ...REQ, tiltDeg: 10 }));
  });

  it("separates a roof mount from a ground mount", () => {
    expect(yieldCacheKey(REQ)).not.toBe(yieldCacheKey({ ...REQ, arrayType: "ground" }));
  });

  it("separates two companies with different loss assumptions", () => {
    expect(yieldCacheKey(REQ)).not.toBe(yieldCacheKey({ ...REQ, lossesPct: 20 }));
  });

  it("treats a negative bearing and its positive twin as one plane", () => {
    expect(yieldCacheKey({ ...REQ, azimuthDeg: -90 })).toBe(
      yieldCacheKey({ ...REQ, azimuthDeg: 270 })
    );
  });

  it("normalises 360 to 0", () => {
    expect(norm360(360)).toBe(0);
    expect(norm360(720)).toBe(0);
  });
});

describe("reading the answer", () => {
  const ok = {
    errors: [],
    outputs: {
      ac_annual: 1587.4,
      ac_monthly: [100, 110, 130, 140, 150, 155, 160, 158, 140, 125, 105, 95],
    },
    station_info: { location: "Dallas" },
  };

  it("reads the annual yield and the shape of the year", () => {
    const r = readPvwatts(ok)!;
    expect(r.kwhPerKwYear).toBe(1587.4);
    expect(r.monthly).toHaveLength(12);
    expect(r.station).toBe("Dallas");
  });

  /**
   * PVWatts answers a BAD request with HTTP 200 and a populated `errors` array,
   * so a caller that trusts the status reports success on a response carrying
   * no outputs at all.
   */
  it("refuses a 200 that is actually an error", () => {
    expect(readPvwatts({ errors: ["azimuth is required"], outputs: {} })).toBeNull();
  });

  it("refuses a response with no outputs, a zero, or a non-number", () => {
    expect(readPvwatts({ errors: [] })).toBeNull();
    expect(readPvwatts({ errors: [], outputs: { ac_annual: 0 } })).toBeNull();
    expect(readPvwatts({ errors: [], outputs: { ac_annual: "1500" } })).toBeNull();
    expect(readPvwatts({ errors: [], outputs: { ac_annual: Number.NaN } })).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(readPvwatts(null)).toBeNull();
    expect(readPvwatts("nope")).toBeNull();
  });

  it("keeps the annual figure even when the monthly shape is missing", () => {
    const r = readPvwatts({ errors: [], outputs: { ac_annual: 1500 } })!;
    expect(r.kwhPerKwYear).toBe(1500);
    expect(r.monthly).toEqual([]);
  });

  it("drops a monthly array that is not twelve real numbers", () => {
    const r = readPvwatts({ errors: [], outputs: { ac_annual: 1500, ac_monthly: [1, 2, 3] } })!;
    expect(r.monthly).toEqual([]);
  });
});

describe("the sanity rail", () => {
  /** The best plane in the sunniest state lands near 2,000; a north wall in
   *  Seattle a few hundred. Outside that is a units mistake, not a yield. */
  it("accepts a real specific yield", () => {
    expect(plausibleYield(1587)).toBe(true);
    expect(plausibleYield(420)).toBe(true);
  });

  it("rejects a figure that is off by a factor of ten either way", () => {
    expect(plausibleYield(15870)).toBe(false);
    expect(plausibleYield(15)).toBe(false);
    expect(plausibleYield(0)).toBe(false);
    expect(plausibleYield(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("what one array makes", () => {
  it("is its size times its plane's yield", () => {
    expect(arrayProductionKwh({ kwDc: 10, kwhPerKwYear: 1500, shadePct: null })).toBe(
      15000 * PRODUCTION_MARGIN_FACTOR
    );
  });

  it("takes the shade off afterwards, exactly as the request left it out", () => {
    expect(arrayProductionKwh({ kwDc: 10, kwhPerKwYear: 1500, shadePct: 50 })).toBe(
      7500 * PRODUCTION_MARGIN_FACTOR
    );
    expect(arrayProductionKwh({ kwDc: 10, kwhPerKwYear: 1500, shadePct: 100 })).toBe(0);
  });

  it("is zero, not NaN, on an array with nothing on it", () => {
    expect(arrayProductionKwh({ kwDc: 0, kwhPerKwYear: 1500, shadePct: null })).toBe(0);
    expect(arrayProductionKwh({ kwDc: 10, kwhPerKwYear: 0, shadePct: null })).toBe(0);
  });

  it("clamps a shade that arrived out of range", () => {
    expect(arrayProductionKwh({ kwDc: 10, kwhPerKwYear: 1500, shadePct: 250 })).toBe(0);
    expect(arrayProductionKwh({ kwDc: 10, kwhPerKwYear: 1500, shadePct: -50 })).toBe(
      15000 * PRODUCTION_MARGIN_FACTOR
    );
  });
});
