import { describe, it, expect } from "vitest";
import { ROLES, roleCan, type Resource } from "../matrix";
import type { Role } from "@prisma/client";

/**
 * Who may take data OUT of the product.
 *
 * `read` is the verb everybody holds on something. `export` is the verb that
 * exists to be withheld — it is what separates "look at your own pipeline" from
 * "download the company as a spreadsheet". Downloads are gated on it by
 * src/lib/__tests__/export-route-guard.test.ts; this file pins WHO that gate
 * then admits, so a later edit to the matrix cannot widen a download without
 * one of these failing.
 *
 * The grants below already held on 2026-09-10 — every one of them comes from a
 * `manage` on the resource rather than a listed verb. That is exactly why they
 * are written down here: `manage` is silent, and reading it out loud is the
 * only way a reviewer sees that `sales_rep` is excluded on purpose rather than
 * by an oversight nobody has noticed yet.
 */

const expectExport = (resource: Resource, allowed: Role[]) => {
  for (const role of ROLES as readonly Role[]) {
    const may = roleCan(role, "export", resource);
    expect(may, `${role} export ${resource}`).toBe(allowed.includes(role));
  }
};

describe("export grants", () => {
  /**
   * The storm CSV/PDF is a company-wide extract of homeowner names, addresses
   * and coordinates. A canvasser reads the storm layer to decide which door to
   * knock; that is `read`, and they keep it. Downloading the list is not the
   * same act.
   */
  it("StormIntelligence exports are leadership only", () => {
    expectExport("StormIntelligence", ["super_admin", "admin", "manager"]);
    // The read that feeds the on-screen table is deliberately wider.
    expect(roleCan("sales_rep", "read", "StormIntelligence")).toBe(true);
    expect(roleCan("canvasser", "read", "StormIntelligence")).toBe(true);
  });

  /**
   * The 1099 CSV carries recipient TINs. The P&L and balance sheet are the books.
   *
   * `accountant_readonly` is the outside CPA, and exporting is most of what they
   * are for — a year-end handover is a set of files, not a screen share. It is
   * written out here rather than inherited quietly, because this is the one
   * place a reviewer sees that an outside party can download the books.
   */
  it("Bookkeeping exports are the funding desk, the owner and the CPA", () => {
    expectExport("Bookkeeping", ["super_admin", "accounting", "accountant_readonly"]);
  });

  /** Knock lists name every door a rep worked, with notes. */
  it("Canvassing exports are leadership only", () => {
    expectExport("Canvassing", ["super_admin", "admin", "manager"]);
    expect(roleCan("canvasser", "read", "Canvassing")).toBe(true);
  });

  /** Recorded so a matrix edit has to come past this file. */
  it("Report and Payroll exports stay with finance", () => {
    expectExport("Report", ["super_admin", "accounting", "accountant_readonly"]);

    /**
     * And the CPA is deliberately ABSENT from these two.
     *
     * Payroll and contractor invoices name individual people and what they were
     * paid. An accountant needs the totals, which the reports give them; they do
     * not need the roster. Now that `accountant_readonly` is in ROLES, these two
     * lines actively assert that exclusion instead of merely not mentioning it.
     */
    expectExport("Payroll", ["super_admin", "admin", "accounting"]);
    expectExport("ContractorInvoice", ["super_admin", "accounting"]);
  });
});
