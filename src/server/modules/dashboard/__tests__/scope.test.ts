import { describe, it, expect } from "vitest";
import type { SessionUser } from "@/server/auth/session";
import { dashboardLeadWhere, dashboardProjectWhere } from "../scope";

function u(role: string, userId = "user-1"): SessionUser {
  return { userId, companyId: "co-1", role, permissions: {} } as unknown as SessionUser;
}

// Recursively look for a filter value anywhere in a where fragment. The shape of
// the ownership clause differs per role, so we assert the OWNER IS MENTIONED
// rather than pinning one literal object.
function mentions(frag: unknown, needle: string): boolean {
  if (frag == null || typeof frag !== "object") return false;
  return Object.values(frag as Record<string, unknown>).some((v) =>
    v === needle || (Array.isArray(v) ? v.some((x) => mentions(x, needle)) : mentions(v, needle))
  );
}

// The regression this file exists for: adding the vertical filter used to
// OVERWRITE the `lead: {...}` ownership clause that listScope returns for every
// non-privileged role, so a marketing/canvasser/rep dashboard counted the whole
// company's jobs. Ownership and vertical must BOTH survive.
describe("dashboard project scope", () => {
  const OWNER_SCOPED = ["marketing", "canvasser", "sales_rep", "manager"];

  for (const role of OWNER_SCOPED) {
    it(`${role} keeps its ownership filter alongside the vertical filter`, () => {
      const where = dashboardProjectWhere(u(role, "me-42"), "solar");
      expect(mentions(where, "me-42"), `${role} lost its ownership clause`).toBe(true);
      expect(mentions(where, "solar"), `${role} lost its vertical clause`).toBe(true);
      expect(mentions(where, "co-1"), `${role} lost its company clause`).toBe(true);
    });
  }

  it("admin still sees the whole company, scoped to the vertical", () => {
    const where = dashboardProjectWhere(u("super_admin"), "solar");
    expect(mentions(where, "solar")).toBe(true);
    expect(mentions(where, "co-1")).toBe(true);
  });

  it("lead scope keeps ownership and vertical too", () => {
    const where = dashboardLeadWhere(u("marketing", "me-42"), "solar");
    expect(mentions(where, "me-42")).toBe(true);
    expect(mentions(where, "solar")).toBe(true);
  });
});
