/**
 * Recognising this company's own report downloads by their filename.
 *
 * WHY THIS EXISTS. On 2026-08-09 a year-to-date Payroll report — every
 * person's pay, in one PDF — was uploaded to a customer's deal and sat in its
 * "Other" folder. Nothing malfunctioned: the file was picked out of the
 * Downloads folder by hand, minutes after being exported, and the deal's
 * uploader had no reason to refuse it. But a file attached to a deal is
 * authorised by DEAL scope (src/app/portal/files/[id]/route.ts) and never by
 * the Report permission, so anyone who can open that job can open whatever is
 * filed on it. Dropping a company report there quietly hands it to a wider
 * audience than the Reports page would ever have shown it to.
 *
 * WHY A FILENAME IS ENOUGH TO GO ON. These are not guesses about what a PDF
 * might contain. Every pattern below is a name one of OUR OWN routes writes
 * into its Content-Disposition header, so matching one means the file is, to a
 * near certainty, a copy of that export straight out of the browser's Downloads
 * folder — which is exactly the accident this is here to catch. Rename the file
 * and it gets through; that is a deliberate trade. The point is to stop the
 * slip, not to police a determined uploader, and a false refusal on a rep's
 * genuine customer paperwork would cost more than it saves.
 *
 * KEEP THIS IN STEP WITH THE ROUTES. Each entry names the route it mirrors. If
 * a route's filename changes, change its pattern here and its case in
 * company-exports.test.ts, which lists all of them literally for that purpose.
 */

const PATTERNS: { re: RegExp; label: string }[] = [
  // /portal/reports/[section]/{pdf,export} — the four Company Report sections.
  { re: /^executive-report-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Executive Summary report" },
  { re: /^operations-report-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Operations report" },
  { re: /^financial-report-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Financial report" },
  { re: /^payroll-report-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Payroll report" },

  // The standalone report pages under /portal/reports.
  { re: /^contractor-pay-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Contractor Pay report" },
  { re: /^rep-scorecard-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Rep Scorecard report" },
  { re: /^delinquency-report\.(pdf|csv)$/i, label: "Delinquency report" },
  { re: /^ar-aging\.(pdf|csv)$/i, label: "A/R Aging report" },
  { re: /^sales-funnel-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Sales Funnel report" },
  { re: /^lead-sources-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Lead Source report" },
  { re: /^production-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Production report" },
  { re: /^canvassing-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Canvassing report" },

  // /api/bookkeeping/* and /portal/bookkeeping/*.
  { re: /^profit-and-loss-\d{4}-\d{2}-\d{2}\.pdf$/i, label: "Profit & Loss statement" },
  { re: /^balance-sheet-\d{4}-\d{2}-\d{2}\.pdf$/i, label: "Balance Sheet" },
  { re: /^reconciliation-\d{4}-\d{2}-\d{2}\.pdf$/i, label: "Reconciliation report" },
  { re: /^transactions-[a-z0-9_-]+\.(pdf|csv)$/i, label: "Transactions export" },
  { re: /^1099-nec-\d{4}\.csv$/i, label: "1099-NEC export" },

  // /portal/payroll/[id]/* — a run's line items, and the stubs themselves.
  // Underscored rather than hyphenated because that is what those routes build.
  { re: /^payroll_[a-z0-9_]+\.csv$/i, label: "Payroll run export" },
  { re: /^paystubs?_[a-z0-9_]+\.pdf$/i, label: "Pay stub" },
];

// Chrome saves a second copy of the same download as "name (1).pdf". That copy
// is the more likely one to be picked by mistake, not the less, so the suffix
// is stripped before matching rather than being allowed to defeat it.
const DEDUPE_SUFFIX = /\s*\(\d+\)(?=\.[a-z0-9]+$)/i;

/**
 * The human name of the company report this filename is a copy of, or `null` if
 * it is not one of ours. The label is written to be dropped straight into a
 * message to whoever tried to upload it.
 */
export function companyExportLabel(name: string): string | null {
  const cleaned = name.trim().replace(DEDUPE_SUFFIX, "");
  return PATTERNS.find((p) => p.re.test(cleaned))?.label ?? null;
}
