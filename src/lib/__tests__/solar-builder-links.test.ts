import { describe, it, expect } from "vitest";
import { builderHref, builderStepFromHref } from "@/lib/solar-validation";

const LEAD = "00000000-0000-4000-8000-000000000102";

/**
 * The readiness report is rendered INSIDE the builder, so a finding that points
 * at another of its steps has to switch the step in place — navigating to the
 * page you are already on does nothing, which is how "Open system design" spent
 * its life as a dead link. This parser is what tells those two cases apart, so
 * both directions are pinned: a builder link must be recognised, and a link
 * that genuinely leaves the builder must NOT be, or it becomes the dead one.
 */
describe("builderStepFromHref", () => {
  it("recognises the links the report mints", () => {
    expect(builderStepFromHref(builderHref(LEAD, "design"))).toBe("design");
    expect(builderStepFromHref(builderHref(LEAD, "financing"))).toBe("financing");
  });

  it("treats a bare builder link as the first step, like the page does", () => {
    expect(builderStepFromHref(`/portal/leads/${LEAD}/solar-proposal`)).toBe("design");
  });

  it("leaves links to other screens alone", () => {
    expect(builderStepFromHref(`/portal/leads/${LEAD}`)).toBeNull();
    expect(builderStepFromHref("/portal/settings/company")).toBeNull();
    expect(builderStepFromHref("/portal/settings/solar")).toBeNull();
    // The roofing counterpart is a different builder on a different route.
    expect(builderStepFromHref(`/portal/leads/${LEAD}/presentation`)).toBeNull();
  });
});
