import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { ROLES, roleCan } from "../matrix";
import { can } from "../guards";

/**
 * Who may open a contractor's invoice.
 *
 * This is the whole feature, so it is asserted as a closed list rather than a
 * few spot checks: every role in the product is named, and the ones that must
 * be refused are refused BY NAME. A future grant added for symmetry — admin is
 * the obvious candidate, since admins hold nearly everything else — fails here
 * rather than quietly publishing subcontractor pricing to the sales floor.
 *
 * See src/lib/contractor-invoice.ts.
 */
const ALLOWED: Role[] = ["super_admin", "accounting"];

describe("ContractorInvoice permission", () => {
  it("is held by super_admin and accounting, and nobody else", () => {
    const holders = ROLES.filter((r) => roleCan(r as Role, "read", "ContractorInvoice"));
    expect([...holders].sort()).toEqual([...ALLOWED].sort());
  });

  it.each(["admin", "manager", "sales_rep", "canvasser", "marketing", "installer"] as Role[])(
    "refuses %s — including the installer who submitted it",
    (role) => {
      expect(roleCan(role, "read", "ContractorInvoice")).toBe(false);
    },
  );

  // Accounting pays these; it does not get to make one disappear. Deleting a
  // submitted invoice destroys the contractor's evidence that he billed.
  it("lets only a super admin delete one", () => {
    expect(roleCan("super_admin", "delete", "ContractorInvoice")).toBe(true);
    expect(roleCan("accounting", "delete", "ContractorInvoice")).toBe(false);
  });

  it("lets accounting export the payout report it sits beside", () => {
    expect(roleCan("accounting", "export", "ContractorInvoice")).toBe(true);
  });

  // The funding desk prices these off the PDF and approves them into payroll —
  // the same verbs it already holds on Commission. Nobody else does, which is
  // what keeps "generate contractor pay" off every other person's screen.
  it("lets the funding desk price and approve, and nobody else", () => {
    for (const action of ["update", "approve"] as const) {
      const holders = ROLES.filter((r) => roleCan(r as Role, action, "ContractorInvoice"));
      expect([...holders].sort(), `who may ${action}`).toEqual([...ALLOWED].sort());
    }
  });

  // The per-user override mechanism still works on it, which is how one person
  // in a funding role gets access without a new role being invented for them.
  it("honours a per-user override", () => {
    const rep = { userId: "u1", companyId: "c1", role: "sales_rep" as Role, permissions: null };
    expect(can(rep, "read", "ContractorInvoice")).toBe(false);
    expect(
      can({ ...rep, permissions: { "ContractorInvoice:read": true } }, "read", "ContractorInvoice"),
    ).toBe(true);
  });
});
