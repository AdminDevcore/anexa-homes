import { describe, it, expect, beforeEach } from "vitest";
import { createThrottle } from "../throttle";

describe("createThrottle", () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  it("allows a burst up to the limit", () => {
    const t = createThrottle({ limit: 3, windowMs: 60_000, clock });
    expect(t.allow("1.2.3.4")).toBe(true);
    expect(t.allow("1.2.3.4")).toBe(true);
    expect(t.allow("1.2.3.4")).toBe(true);
  });

  it("blocks the request past the limit", () => {
    const t = createThrottle({ limit: 2, windowMs: 60_000, clock });
    t.allow("1.2.3.4");
    t.allow("1.2.3.4");
    expect(t.allow("1.2.3.4")).toBe(false);
  });

  it("counts each caller separately", () => {
    const t = createThrottle({ limit: 1, windowMs: 60_000, clock });
    expect(t.allow("1.2.3.4")).toBe(true);
    expect(t.allow("1.2.3.4")).toBe(false);
    expect(t.allow("5.6.7.8")).toBe(true);
  });

  it("lets the caller back in once the window rolls over", () => {
    const t = createThrottle({ limit: 1, windowMs: 60_000, clock });
    expect(t.allow("1.2.3.4")).toBe(true);
    expect(t.allow("1.2.3.4")).toBe(false);
    now += 60_001;
    expect(t.allow("1.2.3.4")).toBe(true);
  });

  it("forgets callers who have gone quiet, so the map cannot grow forever", () => {
    const t = createThrottle({ limit: 5, windowMs: 60_000, clock });
    for (let i = 0; i < 500; i++) t.allow(`10.0.0.${i}`);
    expect(t.size()).toBe(500);
    now += 60_001;
    t.allow("10.0.1.1");
    expect(t.size()).toBe(1);
  });
});
