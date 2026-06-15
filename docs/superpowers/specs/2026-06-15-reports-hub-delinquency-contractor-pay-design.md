# Reports hub + Delinquency & Contractor Pay reports

**Date:** 2026-06-15
**Status:** Approved — building directly (no schema changes)

## Problem

The Reports page is a single combined "Company Report". We want it to be a **hub of
distinct report cards** — each opens its own view and exports to CSV/PDF. Two new
reports are needed:

1. **Delinquency / Follow-up** — every open deal sitting in a pipeline stage longer
   than that stage's day limit, grouped by stage. The day limit is the existing
   per-stage `targetDays`.
2. **Contractor Pay** — money paid/owed to installer-crews and 1099 contractors.

## Already exists (no work)

- Per-stage day limit: `PipelineStage.targetDays` (+ `escalationDays`, recipient,
  in-app/email, `markOverdue`) configured in Settings → Pipeline.
- Overdue notifications: daily cron `/api/cron/stage-alerts` (scheduled in
  `vercel.json`, 13:00 UTC) fires in-app + email alerts via `runStageAlerts()`.
- Export plumbing: `pdf-lib` PDF + CSV; reusable single-report renderer
  `buildReportPdf(company, report)`; `ReportResult = { title, periodLabel,
  scopeLabel, metrics[], tables[] }`.
- Scope/period: `resolvePeriod`, `resolveScope` (RBAC-aware `leadWhere` + `userIds`).

## Design

### 1. Reports hub
- `/portal/reports` → grid of RBAC-gated report cards (catalog-driven).
- Existing dashboard **moves** to `/portal/reports/company` (its export/pdf routes
  move under `/company/` too). `ReportsControls` gains a `basePath` prop so nav +
  export hrefs target the right report.
- `src/server/modules/reports/catalog.ts`: `REPORT_CARDS` ({ id, title, description,
  icon, href, subject, action }) + `visibleReportCards(user)`.
- Cards: Company Report, Job Profitability (exist), Delinquency, Contractor Pay (new).

### 2. Delinquency / Follow-up — `src/server/modules/reports/delinquency.ts`
- Query open leads in scope whose stage has `targetDays > 0`; compute time-in-stage
  via existing `stageTiming()`; keep **overdue** (default) + optional **due-soon**.
- Grouped by stage (ordered by `position`). Columns: Job/Customer · Status · Days in
  stage · Limit · Days over · Rep · In stage since.
- Metrics: # overdue, # due-soon, deals tracked, avg days over, worst offender.
- View `/portal/reports/delinquency` with scope select + due-soon toggle + PDF/CSV;
  rows link to `/portal/leads/{id}`.

### 3. Contractor Pay — `src/server/modules/reports/contractor-pay.ts`
- Installer/crew payouts: `Commission` where `rule.role = "installer"`, scoped by
  project's lead. Paid = status `paid` & `paidAt` in period; Owed = not paid.
- 1099 / labor payments: bookkeeping transactions (money out, in period) to 1099
  vendors or contractor/labor/crew/subcontractor categories (reuses `buildFinancial`
  logic), grouped by contractor.
- Tables: by-contractor (Paid in period · Owed · Total) and installer payouts by job.
- Metrics: total paid (period), total owed, # contractors.
- View `/portal/reports/contractor-pay` with period + scope + PDF/CSV.

### 4. Export generalization
- Add `RenderableReport` type (= ReportResult minus `type`); `buildReportPdf` accepts
  it. New `src/server/modules/reports/csv.ts` → `reportToCsv(report)`.
- Each new report folder: `export/route.ts` (CSV) + `pdf/route.ts` (PDF), gated by
  `can(user, "export", "Report")`.

### 5. Settings clarity
- Stage row shows readable "Limit: N days" + a helper note that the limit powers the
  Delinquency report and overdue alerts. No schema/action change.

## Out of scope
- No DB schema changes. Notifications untouched. Delinquency tracks pipeline-stage
  time only (not production status).

## Testing
- Unit test: delinquency builder days-over / grouping (pure logic).
- Playwright e2e: hub cards render + role gate; delinquency lists overdue rows;
  CSV + PDF endpoints return 200 with correct content-type for both new reports.
