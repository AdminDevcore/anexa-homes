import { describe, it, expect } from "vitest";
import {
  SELECTABLE_SERVICE_TYPES,
  serviceTypeOptions,
  serviceTypeLabel,
  serviceTypeFromSlug,
} from "@/lib/service-types";

describe("selectable service types", () => {
  it("does not offer a retired product as a new choice", () => {
    expect(SELECTABLE_SERVICE_TYPES.map((s) => s.value)).not.toContain("storm_restoration");
  });

  it("offers solar", () => {
    expect(SELECTABLE_SERVICE_TYPES.map((s) => s.value)).toContain("solar");
  });
});

describe("serviceTypeOptions", () => {
  // Without this, a storm_restoration project opens the edit dialog showing
  // "Roofing" (the first option) and silently reassigns itself on save.
  it("keeps a record's retired value selectable so saving doesn't reassign it", () => {
    const opts = serviceTypeOptions("storm_restoration");
    expect(opts[0]).toEqual({ value: "storm_restoration", label: "Storm Restoration" });
    expect(opts.filter((o) => o.value === "storm_restoration")).toHaveLength(1);
  });

  it("does not duplicate or widen options for a current product", () => {
    const opts = serviceTypeOptions("roofing");
    expect(opts.filter((o) => o.value === "roofing")).toHaveLength(1);
    expect(opts.map((o) => o.value)).not.toContain("storm_restoration");
  });
});

describe("serviceTypeLabel", () => {
  it("still names historical storm deals", () => {
    expect(serviceTypeLabel("storm_restoration")).toBe("Storm Restoration");
  });
});

describe("serviceTypeFromSlug", () => {
  it("maps every live marketing slug", () => {
    expect(serviceTypeFromSlug("roofing")).toBe("roofing");
    expect(serviceTypeFromSlug("solar")).toBe("solar");
    expect(serviceTypeFromSlug("hvac")).toBe("hvac");
    expect(serviceTypeFromSlug("water-filtration")).toBe("water_filtration");
    expect(serviceTypeFromSlug("windows")).toBe("windows");
    // Gutters has no dedicated ServiceType column.
    expect(serviceTypeFromSlug("gutters")).toBe("other");
  });

  it("still resolves the retired slug for stale referrers", () => {
    expect(serviceTypeFromSlug("storm-restoration")).toBe("storm_restoration");
  });
});
