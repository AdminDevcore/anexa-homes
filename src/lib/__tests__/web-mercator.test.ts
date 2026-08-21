import { describe, it, expect } from "vitest";
import { metresPerPixel, metresToImagePx, zoomForMetresPerPixel } from "@/lib/web-mercator";
import { bestFitZoom, centroid } from "@/components/proposal/array-map";

/**
 * The projection both the roof designer and the customer's proposal draw
 * through. If these two disagree, a rep and a homeowner are looking at the same
 * array in two different places on the same roof.
 */

describe("ground resolution", () => {
  it("halves per pixel for every zoom level deeper", () => {
    const a = metresPerPixel(32.78, 20);
    const b = metresPerPixel(32.78, 21);
    expect(b).toBeCloseTo(a / 2, 10);
  });

  it("halves again for a HiDPI image, which has twice the pixels", () => {
    expect(metresPerPixel(32.78, 20, 2)).toBeCloseTo(metresPerPixel(32.78, 20) / 2, 10);
  });

  it("round-trips through the zoom inverse", () => {
    const mpp = metresPerPixel(32.78, 20, 2);
    expect(zoomForMetresPerPixel(32.78, mpp, 2)).toBeCloseTo(20, 9);
  });
});

describe("metres onto the picture", () => {
  const image = { widthPx: 1280, heightPx: 1280 };

  it("puts the origin at the centre, because the image is centred on the deal", () => {
    expect(metresToImagePx(0, 0, 0.05, image)).toEqual({ x: 640, y: 640 });
  });

  it("sends north UP the picture and east to the right", () => {
    const north = metresToImagePx(0, 10, 0.05, image);
    const east = metresToImagePx(10, 0, 0.05, image);
    expect(north.y).toBeLessThan(640);
    expect(east.x).toBeGreaterThan(640);
  });
});

describe("framing the array", () => {
  const quad = (e: number, n: number) => [
    { e, n },
    { e: e + 1, n },
    { e: e + 1, n: n + 1.7 },
    { e, n: n + 1.7 },
  ];

  it("frames a small array deeper than a large one", () => {
    const small = bestFitZoom(32.78, [quad(0, 0)]);
    const large = bestFitZoom(32.78, [quad(0, 0), quad(40, 40)]);
    expect(small).toBeGreaterThan(large);
  });

  it("never asks for imagery deeper or shallower than the route will serve", () => {
    expect(bestFitZoom(32.78, [quad(0, 0)])).toBeLessThanOrEqual(21);
    expect(bestFitZoom(32.78, [quad(0, 0), quad(4000, 4000)])).toBeGreaterThanOrEqual(17);
  });

  it("frames an offset array as tightly as one at the pin, because the frame slides to it", () => {
    // A detached garage 30 m off the coordinate is the SAME SIZE as one on the
    // house. Framing from the pin would zoom out far enough to hold the empty
    // half of the lot as well; framing from the array's own centre does not.
    expect(bestFitZoom(32.78, [quad(30, 0)])).toBe(bestFitZoom(32.78, [quad(0, 0)]));
    // And a genuinely wider array still frames wider.
    expect(bestFitZoom(32.78, [quad(-30, 0), quad(30, 0)])).toBeLessThan(
      bestFitZoom(32.78, [quad(0, 0)])
    );
  });

  it("finds the middle of the array, which is what the frame slides to", () => {
    expect(centroid([quad(0, 0)])).toEqual({ e: 0.5, n: 0.85 });
    expect(centroid([])).toEqual({ e: 0, n: 0 });
  });

  it("falls back to a sensible zoom when there is nothing drawn", () => {
    expect(bestFitZoom(32.78, [])).toBe(20);
  });
});
