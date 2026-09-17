import { describe, it, expect } from "vitest";
import { ASSIGNABLE_ROLES, SUPER_ADMIN_ONLY_ROLES, ROLE_LABELS, assignableRolesFor, canAssignRole } from "@/lib/roles";
import { ROLES, LEGACY_ROLES, STAFF_ROLES } from "@/server/rbac/matrix";
import type { Role } from "@prisma/client";

/**
 * THE INVITE DROPDOWN AND THE SERVER MUST AGREE ON WHAT A ROLE IS.
 *
 * This file exists because they did not.
 *
 * `accountant_readonly` was added to ROLES, to the RBAC matrix, to
 * ASSIGNABLE_ROLES and to the labels — so the invite dropdown offered it. But
 * `team/actions.ts` validated the submitted role against its OWN hardcoded
 * tuple, re-typed from the same list months earlier, and that copy had eight
 * roles in it. The dropdown offered a role the server then rejected: a feature
 * that looks finished, is reachable in the UI, and cannot actually be used.
 *
 * Nothing caught it. A re-typed `as const` array of strings is invisible to
 * TypeScript — every entry is valid, the omission is not a type error, and
 * there is no test that compares one list to another.
 *
 * So these assertions compare the lists rather than restating them. They fail
 * when somebody adds a role and updates only some of the places that enumerate
 * roles, which is the actual failure mode.
 */

describe("the role lists agree with each other", () => {
  it("every assignable role is a real role", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(ROLES as readonly string[], `${role} is assignable but not in ROLES`).toContain(role);
    }
  });

  /**
   * The list the invite/edit zod schema validates against IS `ROLES` now,
   * rather than a copy. Stated as a property so re-introducing a private copy
   * that drifts fails here.
   */
  it("offers exactly the staff roles that are not retired", () => {
    const expected = (ROLES as readonly Role[]).filter((r) => !LEGACY_ROLES.includes(r));
    expect([...ASSIGNABLE_ROLES].sort()).toEqual([...expected].sort());
  });

  it("every assignable role has a label, so no dropdown shows a raw enum value", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(ROLE_LABELS[role], `${role} has no label`).toBeTruthy();
    }
  });

  it("every assignable role can reach the portal", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(STAFF_ROLES, `${role} is assignable but not staff`).toContain(role);
    }
  });

  /** A retired role is never offered, whoever is asking. */
  it("never offers a retired role", () => {
    for (const legacy of LEGACY_ROLES) {
      expect(ASSIGNABLE_ROLES).not.toContain(legacy);
      expect(assignableRolesFor("super_admin")).not.toContain(legacy);
    }
  });
});

describe("who may hand out which role", () => {
  it("only the owner may grant the privileged roles", () => {
    for (const role of SUPER_ADMIN_ONLY_ROLES) {
      expect(canAssignRole("super_admin", role), `owner should grant ${role}`).toBe(true);
      expect(canAssignRole("admin", role), `admin must not grant ${role}`).toBe(false);
      expect(canAssignRole("manager", role), `manager must not grant ${role}`).toBe(false);
    }
  });

  /**
   * The outside CPA reads every figure the company has. Read-only is not a
   * reason to let a sales manager hand that out — who sees the books is an
   * owner's decision, the same as who runs payroll.
   */
  it("keeps the outside CPA an owner's decision", () => {
    expect(SUPER_ADMIN_ONLY_ROLES).toContain("accountant_readonly");
    expect(assignableRolesFor("super_admin")).toContain("accountant_readonly");
    expect(assignableRolesFor("admin")).not.toContain("accountant_readonly");
    expect(assignableRolesFor("manager")).not.toContain("accountant_readonly");
  });

  it("leaves the ordinary roles assignable by an admin", () => {
    expect(assignableRolesFor("admin")).toContain("sales_rep");
    expect(assignableRolesFor("admin")).toContain("installer");
  });
});
