import { describe, it, expect } from "vitest";
import {
  orientationFactor,
  optimalTiltDeg,
  pitchToTiltDeg,
  tiltDegToPitch,
  compassLabel,
} from "../solar-orientation";

/** Dallas–Fort Worth, where every real deal on this system is. */
const DFW = 32.9;

const factor = (tiltDeg: number, azimuthDeg: number, lat = DFW) =>
  orientationFactor({ lat, tiltDeg, azimuthDeg });

describe("orientationFactor", () => {
  it("is 1 when the array's orientation is unknown", () => {
    // The no-regression contract: an undescribed array prices exactly as it did
    // before this model existed, rather than the maths inventing a south roof.
    expect(orientationFactor({ lat: DFW, tiltDeg: null, azimuthDeg: 180 })).toBe(1);
    expect(orientationFactor({ lat: DFW, tiltDeg: 20, azimuthDeg: null })).toBe(1);
    expect(orientationFactor({ lat: null, tiltDeg: 20, azimuthDeg: 180 })).toBe(1);
  });

  it("peaks due south at roughly latitude tilt", () => {
    const best = optimalTiltDeg(DFW);
    expect(best).toBeGreaterThan(25);
    expect(best).toBeLessThan(40);
    expect(factor(best, 180)).toBeCloseTo(1, 2);
  });

  it("ranks the compass the way the sun does", () => {
    const south = factor(20, 180);
    const southEast = factor(20, 135);
    const east = factor(20, 90);
    const north = factor(20, 0);

    expect(south).toBeGreaterThan(southEast);
    expect(southEast).toBeGreaterThan(east);
    expect(east).toBeGreaterThan(north);
  });

  it("treats east and west as equals", () => {
    // A clear-sky year is symmetric about noon. Any gap here is a sign the
    // azimuth atan2 has picked up an afternoon/morning branch error.
    expect(factor(25, 90)).toBeCloseTo(factor(25, 270), 3);
    expect(factor(25, 135)).toBeCloseTo(factor(25, 225), 3);
  });

  it("keeps a flat roof close to optimal, and a steep north roof far from it", () => {
    // The numbers a rep will be asked to defend. Flat loses a little; north
    // loses a lot, and the steeper it is the worse it gets.
    expect(factor(0, 180)).toBeGreaterThan(0.85);
    expect(factor(0, 180)).toBeLessThan(0.95);

    expect(factor(18.4, 0)).toBeLessThan(0.85);
    expect(factor(45, 0)).toBeLessThan(factor(18.4, 0));
  });

  it("never returns more than 1 or less than 0", () => {
    for (const tilt of [0, 5, 18.4, 26.6, 45, 60, 90]) {
      for (let az = 0; az < 360; az += 30) {
        const f = factor(tilt, az);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("reads a negative azimuth as the same plane as its positive twin", () => {
    expect(factor(20, -90)).toBeCloseTo(factor(20, 270), 6);
    expect(factor(20, 540)).toBeCloseTo(factor(20, 180), 6);
  });

  it("penalises a north roof harder the further north the house is", () => {
    expect(factor(30, 0, 47)).toBeLessThan(factor(30, 0, 26));
  });
});

describe("roof pitch", () => {
  it("converts the pitches a roofer actually calls out", () => {
    expect(pitchToTiltDeg(4)).toBeCloseTo(18.4, 1);
    expect(pitchToTiltDeg(6)).toBeCloseTo(26.6, 1);
    expect(pitchToTiltDeg(12)).toBeCloseTo(45, 1);
  });

  it("round-trips back to the same rise", () => {
    for (const rise of [2, 4, 6, 8, 12]) {
      expect(tiltDegToPitch(pitchToTiltDeg(rise))).toBe(rise);
    }
  });
});

describe("compassLabel", () => {
  it("names the eight points", () => {
    expect(compassLabel(0)).toBe("N");
    expect(compassLabel(90)).toBe("E");
    expect(compassLabel(180)).toBe("S");
    expect(compassLabel(225)).toBe("SW");
    expect(compassLabel(359)).toBe("N");
  });
});
