import { describe, it, expect } from "vitest";
import {
  scoreProperty,
  hailPoints,
  windPoints,
  recencyPoints,
  clusterPoints,
} from "../scoring";

const NOW = new Date("2026-06-27T00:00:00Z");

describe("storm scoring", () => {
  it("hail is tiered, not additive", () => {
    expect(hailPoints(0.9)).toBe(0);
    expect(hailPoints(1)).toBe(30);
    expect(hailPoints(1.49)).toBe(30);
    expect(hailPoints(1.5)).toBe(50);
    expect(hailPoints(2)).toBe(70);
    expect(hailPoints(4)).toBe(70);
    expect(hailPoints(null)).toBe(0);
  });

  it("wind crosses at 60mph", () => {
    expect(windPoints(59)).toBe(0);
    expect(windPoints(60)).toBe(40);
    expect(windPoints(null)).toBe(0);
  });

  it("recency: only the last 30 days count", () => {
    expect(recencyPoints(new Date("2026-06-10T00:00:00Z"), NOW)).toBe(20);
    expect(recencyPoints(new Date("2026-05-01T00:00:00Z"), NOW)).toBe(0);
    expect(recencyPoints("2026-06-26", NOW)).toBe(20);
    expect(recencyPoints(null, NOW)).toBe(0);
    expect(recencyPoints("not-a-date", NOW)).toBe(0);
  });

  it("cluster needs >=2 reports within 5mi", () => {
    expect(clusterPoints(1)).toBe(0);
    expect(clusterPoints(2)).toBe(20);
    expect(clusterPoints(null)).toBe(0);
  });

  it("composite: 2in hail + 70mph + recent + cluster = 150", () => {
    expect(
      scoreProperty(
        {
          maxHailIn: 2,
          maxWindMph: 70,
          mostRecentEventAt: new Date("2026-06-20T00:00:00Z"),
          reportsWithin5mi: 3,
        },
        NOW,
      ),
    ).toBe(150);
  });

  it("composite: 1in hail only = 30", () => {
    expect(scoreProperty({ maxHailIn: 1 }, NOW)).toBe(30);
  });

  it("composite: nothing qualifying = 0", () => {
    expect(scoreProperty({ maxHailIn: 0.5, maxWindMph: 30, reportsWithin5mi: 1 }, NOW)).toBe(0);
  });
});
