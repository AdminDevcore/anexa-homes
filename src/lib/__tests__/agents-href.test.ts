import { describe, it, expect } from "vitest";
import { hrefWith } from "@/lib/agents-href";

describe("hrefWith", () => {
  it("sets and removes query parameters, in a stable order", () => {
    expect(hrefWith("/portal/agents", {}, {})).toBe("/portal/agents");
    expect(hrefWith("/portal/agents", { product: "solar" }, { department: "permit" })).toBe(
      "/portal/agents?department=permit&product=solar"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed", page: "3" }, { status: null, page: null })).toBe(
      "/portal/agents/runs"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed" }, { page: 2 })).toBe("/portal/agents/runs?page=2&status=failed");
  });

  it("replaces a parameter that is already set", () => {
    expect(hrefWith("/portal/agents", { product: "solar" }, { product: "roofing" })).toBe("/portal/agents?product=roofing");
    expect(hrefWith("/portal/agents/runs", { page: "3" }, { page: 4 })).toBe("/portal/agents/runs?page=4");
  });

  it("clears one filter while the other stays set — what every All chip does", () => {
    expect(hrefWith("/portal/agents", { product: "solar", department: "permit" }, { product: null })).toBe(
      "/portal/agents?department=permit"
    );
    expect(hrefWith("/portal/agents", { product: "solar", department: "permit" }, { department: null })).toBe(
      "/portal/agents?product=solar"
    );
  });

  it("resets the page when a filter changes, which every filter link must ask for", () => {
    expect(hrefWith("/portal/agents/runs", { status: "failed", page: "5" }, { status: "success", page: null })).toBe(
      "/portal/agents/runs?status=success"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed", page: "5" }, { status: null, page: null })).toBe(
      "/portal/agents/runs"
    );
    // And what ships without the convention: the list clamps to page 1 while
    // the URL goes on claiming page 5.
    expect(hrefWith("/portal/agents/runs", { status: "failed", page: "5" }, { status: "success" })).toBe(
      "/portal/agents/runs?page=5&status=success"
    );
  });

  it("encodes a value that needs it", () => {
    expect(hrefWith("/portal/agents", {}, { q: "roof & solar" })).toBe("/portal/agents?q=roof+%26+solar");
  });
});
