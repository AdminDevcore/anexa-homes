import { describe, it, expect } from "vitest";
import type { AccessUser } from "../guards";
import { listScope } from "../policies";

// Minimal user factory — listScope only reads userId, companyId, role.
function u(role: string, opts: { userId?: string; companyId?: string } = {}): AccessUser {
  return {
    userId: opts.userId ?? "user-1",
    companyId: opts.companyId ?? "co-1",
    role: role as AccessUser["role"],
    permissions: {},
  } as AccessUser;
}

// Recursively check that a scope fragment constrains companyId somewhere.
function mentionsCompany(frag: unknown, companyId: string): boolean {
  if (frag == null || typeof frag !== "object") return false;
  const o = frag as Record<string, unknown>;
  if (o.companyId === companyId) return true;
  return Object.values(o).some((v) =>
    Array.isArray(v) ? v.some((x) => mentionsCompany(x, companyId)) : mentionsCompany(v, companyId)
  );
}

// `customer` is included on purpose even though it is retired: a row that still
// carries the role must still be scoped to its company, not handed the world.
const ROLES = ["super_admin", "admin", "manager", "sales_rep", "canvasser", "marketing", "installer", "accounting", "customer"];
const RESOURCES = ["Lead", "Project", "Commission", "Document", "Task", "Payroll"] as const;

describe("listScope — tenant isolation", () => {
  it("every role+resource fragment constrains the user's companyId", () => {
    for (const role of ROLES) {
      for (const res of RESOURCES) {
        const frag = listScope(u(role, { companyId: "co-XYZ" }), res);
        expect(mentionsCompany(frag, "co-XYZ"), `${role}/${res} must scope companyId`).toBe(true);
      }
    }
  });

  it("never scopes to a different company", () => {
    const frag = listScope(u("sales_rep", { companyId: "co-1" }), "Lead") as Record<string, unknown>;
    expect(frag.companyId).toBe("co-1");
  });
});

describe("listScope — per-rep isolation on Lead", () => {
  it("sales_rep is limited to their own / their canvassers' leads", () => {
    const frag = listScope(u("sales_rep", { userId: "rep-9" }), "Lead") as Record<string, unknown>;
    expect(frag.OR).toEqual([
      { assignedRepId: "rep-9" },
      { createdBy: { salesRepId: "rep-9" } },
    ]);
  });

  it("canvasser is limited to leads they own or created", () => {
    const frag = listScope(u("canvasser", { userId: "canv-3" }), "Lead") as Record<string, unknown>;
    expect(frag.OR).toEqual([{ assignedRepId: "canv-3" }, { createdById: "canv-3" }]);
  });

  it("installer is limited to leads for their crew's jobs", () => {
    const frag = listScope(u("installer", { userId: "inst-2" }), "Lead") as Record<string, unknown>;
    expect(frag.project).toEqual({
      crewAssignments: { some: { crew: { members: { some: { userId: "inst-2" } } } } },
    });
  });

  it("the retired customer role sees nothing at all", () => {
    // Homeowners have no accounts in this product. The role used to get its own
    // "your own deal" branch; a legacy row must now fall through to
    // deny-by-default rather than keep a working view of a deal.
    const frag = listScope(u("customer", { userId: "cust-1" }), "Lead") as Record<string, unknown>;
    expect(frag.customerUserId).toBeUndefined();
    expect(frag.id).toBe("__none__");
  });
});

describe("listScope — privileged roles see the whole company", () => {
  it("super_admin and admin get a company-only filter (no per-rep narrowing)", () => {
    for (const role of ["super_admin", "admin"]) {
      const frag = listScope(u(role), "Lead") as Record<string, unknown>;
      expect(frag).toEqual({ companyId: "co-1" });
    }
  });

  it("accounting sees company-wide financial data", () => {
    expect(listScope(u("accounting"), "Commission")).toEqual({ companyId: "co-1" });
  });
});

describe("listScope — Commission is owner-scoped for reps", () => {
  it("a rep only sees their own commission rows", () => {
    const frag = listScope(u("sales_rep", { userId: "rep-7" }), "Commission") as Record<string, unknown>;
    expect(frag.userId).toBe("rep-7");
  });

  it("a manager sees only their team's commissions", () => {
    const frag = listScope(u("manager", { userId: "mgr-1" }), "Commission") as Record<string, unknown>;
    expect(frag.user).toEqual({ OR: [{ id: "mgr-1" }, { managerId: "mgr-1" }, { salesRep: { managerId: "mgr-1" } }] });
  });
});

describe("listScope — deny-by-default", () => {
  it("a non-privileged role with no rule gets an impossible filter (sees nothing)", () => {
    // 'marketing' has no Project rule → must fall through to deny, not company-wide.
    const frag = listScope(u("marketing", { userId: "mkt-1" }), "Payroll") as Record<string, unknown>;
    expect(frag.id).toBe("__none__");
  });
});
