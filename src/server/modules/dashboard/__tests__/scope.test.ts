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

/**
 * THE OUTSIDE CPA ON THE DASHBOARD.
 *
 * `accountant_readonly` holds no `Lead` and no `Project` grant, so `listScope`
 * drops it into its deny-by-default branch. That matters more than it looks:
 * the dashboard page itself has no `can()` gate, and every books and reports
 * route denies with `redirect("/portal/dashboard")` — so this filter is the ONLY
 * thing standing between an outside accountant and six customers' names on
 * `getRecentLeads`.
 *
 * Asserted by execution rather than read off the comment at policies.ts:112,
 * because "sees nothing by default" is a claim about a returned expression and
 * a company-wide fallthrough would look identical in prose.
 */
describe("the outside CPA's dashboard scope", () => {
  const CPA = u("accountant_readonly", "cpa-1");

  it("is not scoped to the company on leads — it is denied", () => {
    const where = dashboardLeadWhere(CPA, "solar");
    // The tell for a leak: a filter that names ONLY the company, which would
    // return every lead in it.
    expect(mentions(where, "cpa-1"), "a deny filter must not be an ownership filter").toBe(false);
    expect(JSON.stringify(where)).not.toBe(
      JSON.stringify({ AND: [{ companyId: "co-1" }, { vertical: "solar" }] })
    );
  });

  it("is denied on projects too", () => {
    const where = dashboardProjectWhere(CPA, "solar");
    expect(JSON.stringify(where)).not.toBe(
      JSON.stringify({ AND: [{ companyId: "co-1" }, { lead: { is: { vertical: "solar" } } }] })
    );
  });

  /** Accounting IS company-wide here, and stays that way — the CPA is the exception. */
  it("does not disturb the in-house bookkeeper", () => {
    const where = dashboardLeadWhere(u("accounting"), "solar");
    expect(mentions(where, "co-1")).toBe(true);
    expect(mentions(where, "solar")).toBe(true);
  });
});
