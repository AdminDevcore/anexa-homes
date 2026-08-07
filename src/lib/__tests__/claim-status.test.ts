import { describe, it, expect } from "vitest";
import {
  DEFAULT_CLAIM_STATUSES,
  DEFAULT_CLAIM_STATUS_KEY,
  claimIsIncomplete,
  claimStatusKey,
  claimStatusOpensClaim,
  claimStatusLabel,
  claimStatusOptionsFor,
  isBuiltInClaimStatus,
  parseClaimStatuses,
} from "../claim-status";
import { isScopeReady } from "@/server/modules/scope/policies";

describe("parseClaimStatuses", () => {
  it("falls back to the built-ins when nothing usable is stored", () => {
    expect(parseClaimStatuses(null)).toEqual(DEFAULT_CLAIM_STATUSES);
    expect(parseClaimStatuses([])).toEqual(DEFAULT_CLAIM_STATUSES);
    expect(parseClaimStatuses("nope")).toEqual(DEFAULT_CLAIM_STATUSES);
    expect(parseClaimStatuses([{ label: "  " }, { key: "x" }])).toEqual(DEFAULT_CLAIM_STATUSES);
  });

  it("keeps the stored order and keys", () => {
    const stored = [
      { key: "filed", label: "Claim Filed" },
      { key: "not_filed", label: "No Claim Yet" },
    ];
    expect(parseClaimStatuses(stored)).toEqual(stored);
  });

  it("de-dupes by key and by label, first one winning", () => {
    const parsed = parseClaimStatuses([
      { key: "filed", label: "Filed" },
      { key: "filed", label: "Filed again" },
      { key: "other", label: "FILED" },
      { key: "paid", label: "Paid" },
    ]);
    expect(parsed).toEqual([
      { key: "filed", label: "Filed" },
      { key: "paid", label: "Paid" },
    ]);
  });

  it("accepts bare strings, slugging a key from the label", () => {
    expect(parseClaimStatuses(["Scope Received"])).toEqual([
      { key: "scope_received", label: "Scope Received" },
    ]);
  });
});

describe("claimStatusKey", () => {
  it("slugs a label", () => {
    expect(claimStatusKey("Depreciation Released")).toBe("depreciation_released");
    expect(claimStatusKey("Re-inspection requested!")).toBe("re_inspection_requested");
  });

  it("never returns an empty key", () => {
    expect(claimStatusKey("!!!")).toBe("status");
  });
});

describe("claimStatusLabel", () => {
  const options = [{ key: "filed", label: "Claim Filed" }];

  it("uses the company's own wording", () => {
    expect(claimStatusLabel("filed", options)).toBe("Claim Filed");
  });

  it("still reads sensibly for a status the company deleted", () => {
    // The deal keeps its stored key; the customer-visible string must not
    // regress to "adjuster_scheduled".
    expect(claimStatusLabel("adjuster_scheduled", options)).toBe("Adjuster Scheduled");
  });
});

describe("claimStatusOptionsFor", () => {
  const options = [{ key: "filed", label: "Filed" }];

  it("leaves the list alone when the current status is on it", () => {
    expect(claimStatusOptionsFor("filed", options)).toBe(options);
  });

  it("appends an orphaned status so the picker is never blank", () => {
    expect(claimStatusOptionsFor("paid", options)).toEqual([
      { key: "filed", label: "Filed" },
      { key: "paid", label: "Paid" },
    ]);
  });
});

describe("claimStatusOpensClaim", () => {
  it("treats Not Filed as the one status with no claim behind it", () => {
    expect(claimStatusOpensClaim("not_filed")).toBe(false);
    expect(claimStatusOpensClaim(DEFAULT_CLAIM_STATUS_KEY)).toBe(false);
  });

  it("opens the claim on every other built-in, not just Filed", () => {
    // Back-filling a deal straight to "Approved" or "Denied" must open the claim
    // too — the office is recording a claim that already exists at the carrier.
    for (const { key } of DEFAULT_CLAIM_STATUSES.filter((s) => s.key !== "not_filed")) {
      expect(claimStatusOpensClaim(key)).toBe(true);
    }
  });

  it("opens the claim on a status the company invented", () => {
    expect(claimStatusOpensClaim(claimStatusKey("Depreciation Released"))).toBe(true);
  });

  it("is not fooled by a company renaming Not Filed", () => {
    // The key is what's stored, so renaming the label leaves the rule intact.
    const renamed = parseClaimStatuses([{ key: "not_filed", label: "No Claim Yet" }]);
    expect(claimStatusOpensClaim(renamed[0].key)).toBe(false);
  });
});

describe("claimIsIncomplete", () => {
  const full = { carrier: "State Farm", claimNumber: "SF-2026-4471" };

  it("passes a claim that names its carrier and number", () => {
    expect(claimIsIncomplete(full)).toBe(false);
  });

  it("flags a claim opened with the dialog skipped", () => {
    expect(claimIsIncomplete({ carrier: null, claimNumber: null })).toBe(true);
  });

  it("flags a half-filled claim either way round", () => {
    expect(claimIsIncomplete({ ...full, claimNumber: null })).toBe(true);
    expect(claimIsIncomplete({ ...full, carrier: null })).toBe(true);
  });

  it("does not accept whitespace as a claim number", () => {
    expect(claimIsIncomplete({ ...full, claimNumber: "   " })).toBe(true);
  });

  it("says nothing about a deal with no claim at all", () => {
    // Not Filed is not an incomplete claim — it is the absence of one, and
    // warning about it would put an amber banner on every fresh deal.
    expect(claimIsIncomplete(null)).toBe(false);
  });
});

describe("built-in keys still drive scope gating", () => {
  it("recognises the scope-ready built-ins", () => {
    for (const key of ["scope_received", "supplement_needed", "approved", "paid", "closed"]) {
      expect(isBuiltInClaimStatus(key)).toBe(true);
      expect(isScopeReady(key)).toBe(true);
    }
    expect(isScopeReady("not_filed")).toBe(false);
    expect(isScopeReady("filed")).toBe(false);
  });

  it("survives a rename, because the key is what's stored", () => {
    // The whole reason options carry a key: an office renaming "Scope Received"
    // to its own wording must not silently close the Scope of Work tab.
    const renamed = parseClaimStatuses([{ key: "scope_received", label: "ITEL Received" }]);
    expect(isScopeReady(renamed[0].key)).toBe(true);
    expect(claimStatusLabel("scope_received", renamed)).toBe("ITEL Received");
  });

  it("treats an invented status as not scope-ready", () => {
    expect(isBuiltInClaimStatus(claimStatusKey("Depreciation Released"))).toBe(false);
    expect(isScopeReady(claimStatusKey("Depreciation Released"))).toBe(false);
  });
});
