import { describe, it, expect } from "vitest";
import { configError, formatRunDuration, formValuesFor, productOf, timeAgo, utcStamp } from "../agent-labels";

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

  it("stamps the server's UTC time, and refuses a string that is not an instant", () => {
    expect(utcStamp("2026-09-15T14:00:00.000Z")).toBe("2026-09-15 14:00 UTC");
    // Read off the parsed instant, not sliced out of the input, so a valid time
    // written another way still renders.
    expect(utcStamp("2026-09-15T14:00:00Z")).toBe("2026-09-15 14:00 UTC");
    // A slice of any of these would have rendered silent garbage into both the
    // text and the `dateTime` attribute.
    expect(utcStamp("not a date")).toBeNull();
    expect(utcStamp("")).toBeNull();
    expect(utcStamp("2026-13-45T99:99:99.000Z")).toBeNull();
  });

  it("reads a NULL product as Both", () => {
    expect(productOf(null)).toBe("both");
    expect(productOf("solar")).toBe("solar");
    expect(productOf("others")).toBe("both");
  });

  it("says what is wrong with a config while it is being typed", () => {
    expect(configError('{"greeting":"hi"}')).toBeNull();
    // An empty box is not an error: it saves as {}, the way the server reads it.
    expect(configError("")).toBeNull();
    expect(configError("   ")).toBeNull();
    expect(configError("{nope")).toBe("Config is not valid JSON.");
    // Valid JSON, wrong shape — each of these parses, and none is settings.
    expect(configError("[]")).toBe("Config must be a JSON object, like {}.");
    expect(configError("null")).toBe("Config must be a JSON object, like {}.");
    expect(configError("42")).toBe("Config must be a JSON object, like {}.");
    expect(configError('"hi"')).toBe("Config must be a JSON object, like {}.");
    // The cap is read off the TRIMMED text, and comes before the parse, so a
    // huge malformed config is refused for its size rather than its syntax.
    expect(configError(`{"blob":"${"x".repeat(40_000)}"}`)).toBe("Keep config under 30,000 characters.");
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
