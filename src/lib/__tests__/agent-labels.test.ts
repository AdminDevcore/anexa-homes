import { describe, it, expect } from "vitest";
import { formatRunDuration, formValuesFor, productOf, timeAgo } from "../agent-labels";

describe("agent labels", () => {
  const now = new Date("2026-09-15T14:00:00.000Z");

  it("says how long ago, in words read at a glance", () => {
    expect(timeAgo(new Date("2026-09-15T13:59:30.000Z"), now)).toBe("just now");
    expect(timeAgo("2026-09-15T13:56:00.000Z", now)).toBe("4 min ago");
    expect(timeAgo("2026-09-15T11:00:00.000Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-09-13T14:00:00.000Z", now)).toBe("2 d ago");
  });

  it("formats a run's duration", () => {
    expect(formatRunDuration(null)).toBe("—");
    expect(formatRunDuration(14)).toBe("14 ms");
    expect(formatRunDuration(2_300)).toBe("2.3 s");
    expect(formatRunDuration(245_000)).toBe("4 min 5 s");
  });

  it("reads a NULL product as Both", () => {
    expect(productOf(null)).toBe("both");
    expect(productOf("solar")).toBe("solar");
    expect(productOf("others")).toBe("both");
  });

  it("turns an agent into the strings its form edits", () => {
    expect(
      formValuesFor({
        name: "Hello Agent",
        description: "d",
        handlerKey: "system.hello",
        vertical: null,
        department: "operations",
        enabled: false,
        schedule: null,
        timeoutSeconds: 60,
        requiresHumanGate: true,
        config: {},
      })
    ).toEqual({
      name: "Hello Agent",
      description: "d",
      handlerKey: "system.hello",
      product: "both",
      department: "operations",
      enabled: false,
      schedule: "",
      timeoutSeconds: "60",
      requiresHumanGate: true,
      config: "{}",
    });
  });
});
