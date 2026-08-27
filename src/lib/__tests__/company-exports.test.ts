import { describe, expect, it } from "vitest";
import { companyExportLabel } from "../company-exports";

/**
 * The names in the "recognises" block are not invented for this test: each one
 * is a filename some route in src/app actually writes into its
 * Content-Disposition header. If a route's filename changes, its case here
 * should change with it — that is the point of listing them literally.
 */
describe("companyExportLabel", () => {
  it.each([
    // /portal/reports/[section]/{pdf,export}
    ["payroll-report-ytd.pdf", "Payroll report"],
    ["payroll-report-week.csv", "Payroll report"],
    ["financial-report-month.pdf", "Financial report"],
    ["executive-report-quarter.pdf", "Executive Summary report"],
    ["operations-report-ytd.csv", "Operations report"],
    // The standalone report pages
    ["contractor-pay-month.pdf", "Contractor Pay report"],
    ["rep-scorecard-ytd.csv", "Rep Scorecard report"],
    ["delinquency-report.pdf", "Delinquency report"],
    ["ar-aging.csv", "A/R Aging report"],
    ["sales-funnel-week.pdf", "Sales Funnel report"],
    ["lead-sources-ytd.csv", "Lead Source report"],
    ["production-month.pdf", "Production report"],
    ["canvassing-week.csv", "Canvassing report"],
    // Bookkeeping
    ["profit-and-loss-2026-08-27.pdf", "Profit & Loss statement"],
    ["balance-sheet-2026-08-27.pdf", "Balance Sheet"],
    ["reconciliation-2026-08-27.pdf", "Reconciliation report"],
    ["transactions-month.csv", "Transactions export"],
    ["1099-nec-2026.csv", "1099-NEC export"],
    // Payroll runs and pay stubs
    ["payroll_Aug_17_Aug_23.csv", "Payroll run export"],
    ["paystub_Aug_17_Aug_23_Silva.pdf", "Pay stub"],
    ["paystubs_Aug_17_Aug_23.pdf", "Pay stub"],
  ])("recognises %s", (name, label) => {
    expect(companyExportLabel(name)).toBe(label);
  });

  it("is case-insensitive — the browser may have renamed the copy", () => {
    expect(companyExportLabel("Payroll-Report-YTD.pdf")).toBe("Payroll report");
  });

  it("still catches a browser's de-duplicated second download", () => {
    // Chrome saves the second copy as "payroll-report-ytd (1).pdf".
    expect(companyExportLabel("payroll-report-ytd (1).pdf")).toBe("Payroll report");
    expect(companyExportLabel("paystub_Aug_17_Silva (2).pdf")).toBe("Pay stub");
  });

  it.each([
    // Job paperwork that genuinely belongs on a deal — must never be blocked.
    ["contract.pdf"],
    ["insurance-declarations.pdf"],
    ["1043-survey-photos.pdf"],
    ["1043-photo-report-install.pdf"],
    ["scope.pdf"],
    ["Roof from the back.jpg"],
    ["payroll deduction authorization.pdf"], // a customer's own paperwork
    ["production schedule.pdf"], // spaces, not our hyphenated export
    ["transactions.pdf"], // no period segment — not our export
  ])("lets %s through", (name) => {
    expect(companyExportLabel(name)).toBeNull();
  });
});
