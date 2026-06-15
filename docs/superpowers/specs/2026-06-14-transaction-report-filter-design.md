# Filtered Transaction Report (CSV + PDF) — Design

**Date:** 2026-06-14

## Problem

Users need to pull a report of booked transactions filtered by **category**,
by **vendor**, or by **both**. Today the export at `/portal/bookkeeping/export`
filters by date range + single category + direction, outputs CSV only, and has
no vendor filter.

## Decisions (from brainstorming)

- **Filter scope:** at most one category AND one vendor (leaving either on "All"
  drops that filter — so category-only, vendor-only, and both all work).
- **Format:** CSV and PDF.
- **Layout:** flat list of matching transactions in date order + grand total.
- **Scope:** download dialog only; the on-screen transactions table is unchanged.

## Approach

### 1. Export route — `src/app/portal/bookkeeping/export/route.ts`
Add two query params to the existing handler:
- `vendor` — exact match on `Transaction.vendor` (`where.vendor = name`); "all" =
  no filter.
- `format` — `csv` (default, existing behavior) or `pdf`.

Both filters compose with the existing date/direction/category filters, AND-ed,
scoped to `companyId` with `approved: true` (booked only), as today. The query
already selects the fields the PDF needs (date, description, account, category
name, vendor, deal). For `format=pdf`, build the report PDF instead of CSV and
return it with a PDF content-type.

### 2. PDF builder — `src/server/modules/bookkeeping/pdf.ts`
New `buildTransactionReportPdf(company, rows, meta)` following the existing
`pdf-lib` pattern (header band + logo, A4, confidential footer). It renders:
- A filter summary line (date range, category, vendor, direction).
- A flat table: Date · Description · Category · Vendor · Deal · Amount, paginating
  with a `newPageIfNeeded` helper like `buildReconciliationPdf`.
- A grand-total ("Net") row at the end.

The route assembles the `ReportCompany` object the same way the P&L route does
(`prisma.company.findUnique` selecting name/address/.../email).

### 3. Export dialog — `src/components/portal/transactions-export.tsx`
- Add a **Vendor** dropdown (All + each managed vendor name) mirroring Category.
- Add a **Format** toggle (CSV / PDF).
- The download link carries the extra `vendor` and `format` params.
- `bookkeeping-client.tsx` passes `data.vendors` alongside `data.categories`.

## Permissions

Unchanged — `can(user, "read", "Bookkeeping")` gates the route, scoped to
`companyId`.

## Out of scope

Multi-select categories/vendors, grouped subtotals, on-screen table filtering.

## Files touched

- `src/app/portal/bookkeeping/export/route.ts` (vendor + format + PDF branch)
- `src/server/modules/bookkeeping/pdf.ts` (new `buildTransactionReportPdf`)
- `src/components/portal/transactions-export.tsx` (vendor + format controls)
- `src/components/portal/bookkeeping-client.tsx` (pass vendors)
