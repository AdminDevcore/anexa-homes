import { describe, it, expect } from "vitest";
import { distanceConfidence, sourceLabel } from "../confidence";

describe("storm confidence", () => {
  it("distance tiers", () => {
    expect(distanceConfidence(0.5)).toBe("High");
    expect(distanceConfidence(3)).toBe("High");
    expect(distanceConfidence(3.1)).toBe("Medium");
    expect(distanceConfidence(5)).toBe("Medium");
    expect(distanceConfidence(7)).toBe("Low");
    expect(distanceConfidence(10)).toBe("Low");
    expect(distanceConfidence(11)).toBeNull();
  });
  it("source labels", () => {
    expect(sourceLabel("spc_reports")).toBe("SPC Daily Report");
    expect(sourceLabel("noaa_storm_events")).toBe("NOAA Storm Events");
    expect(sourceLabel("mrms_mesh")).toBe("MRMS Radar (MESH)");
  });
});
