import { describe, it, expect } from "vitest";
import { hrefWith } from "@/components/portal/agents/href";

describe("hrefWith", () => {
  it("sets, replaces and removes query parameters, in a stable order", () => {
    expect(hrefWith("/portal/agents", {}, {})).toBe("/portal/agents");
    expect(hrefWith("/portal/agents", { product: "solar" }, { department: "permit" })).toBe(
      "/portal/agents?department=permit&product=solar"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed", page: "3" }, { status: null, page: null })).toBe(
      "/portal/agents/runs"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed" }, { page: 2 })).toBe("/portal/agents/runs?page=2&status=failed");
  });
});
