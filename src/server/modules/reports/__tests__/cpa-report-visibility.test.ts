import { describe, it, expect } from "vitest";
import { visibleReportCards } from "../catalog";
import { allowedReportTypes, allowedSections } from "../builders";
import { roleCan } from "@/server/rbac/matrix";
import type { Role } from "@prisma/client";

/**
 * WHAT THE OUTSIDE CPA CAN REACH ON THE REPORTS HUB.
 *
 * `accountant_readonly` is an outside accountant. The first version of that
 * role granted `Report: ["read", "export"]` so they could pull the books — and
 * `Report` turned out to be the wrong resource entirely. It does not mean "the
 * financial statements"; it is the gate on the whole reports hub, which is
 * mostly the SALES FLOOR: Funnel, Lead Sources, Canvassing, Rep Scorecard,
 * Delinquency, Claims, A/R Aging and Production. Customer names, addresses and
 * per-rep performance.
 *
 * Worse, it does not stop at the hub. Every report page gates itself on
 * `can(user, "read", "Report")` independently, so an empty hub would still
 * leave `/portal/reports/funnel` openable by URL — across ten pages and twenty
 * export/PDF routes, each one a place a future page can forget.
 *
 * So the role holds `Bookkeeping` and NOT `Report`. The statements an
 * accountant actually needs are bookkeeping artifacts, and withholding the
 * coarse resource makes all thirty routes deny by default — including routes
 * nobody has written yet. That is the property this file pins.
 */

const CPA: Role = "accountant_readonly";
const user = (role: Role) => ({ companyId: "c1", userId: "u1", role });

describe("the outside CPA and the reports hub", () => {
  /**
   * The load-bearing assertion. Every page and route under /portal/reports
   * gates on exactly this, so a false here denies all of them at once.
   */
  it("cannot read or export the Report resource at all", () => {
    expect(roleCan(CPA, "read", "Report")).toBe(false);
    expect(roleCan(CPA, "export", "Report")).toBe(false);
  });

  /** What it does hold, so this file also documents the swap rather than only the removal. */
  it("reads and exports the books instead", () => {
    expect(roleCan(CPA, "read", "Bookkeeping")).toBe(true);
    expect(roleCan(CPA, "export", "Bookkeeping")).toBe(true);
    expect(roleCan(CPA, "create", "Bookkeeping")).toBe(false);
    expect(roleCan(CPA, "update", "Bookkeeping")).toBe(false);
  });

  /**
   * Stated as an exact list rather than a count, so a card added to the hub
   * fails this test until somebody decides whether the CPA should have it.
   * It is empty today because the CPA's own statements are not hub cards —
   * they hang off the books, under `Bookkeeping`.
   */
  it("sees no report card", () => {
    expect(visibleReportCards(user(CPA)).map((c) => c.id)).toEqual([]);
  });

  /**
   * Defence in depth. `allowedReportTypes` seeds EVERY role with "operations",
   * which was harmless only because roles without a `Report` grant never got
   * past the gate. That is an assumption, not a guarantee, so the CPA is
   * excluded explicitly as well — two independent reasons it sees nothing.
   */
  it("is offered no Company-Report section even before the resource gate", () => {
    expect(allowedReportTypes(CPA)).toEqual([]);
    expect(allowedSections(CPA)).toEqual([]);
  });

  /**
   * The roles that genuinely run the company are untouched.
   *
   * `admin` is deliberately not asserted here: it holds no `Report` grant, so
   * it sees only the `jobs` card, which is gated on `Commission`. That is
   * pre-existing and correct, and asserting otherwise is how the first draft of
   * this test failed.
   */
  it("leaves the internal roles alone", () => {
    for (const role of ["super_admin", "accounting"] as Role[]) {
      const ids = visibleReportCards(user(role)).map((c) => c.id);
      expect(ids, `${role} keeps the sales reports`).toContain("funnel");
      expect(ids, `${role} keeps the scorecard`).toContain("rep-scorecard");
    }
    expect(allowedReportTypes("accounting")).toContain("payroll");
    expect(allowedReportTypes("manager")).toContain("financial");
    expect(allowedReportTypes("sales_rep")).toContain("operations");
  });
});
