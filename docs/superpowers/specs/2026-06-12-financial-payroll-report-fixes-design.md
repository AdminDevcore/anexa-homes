# Financial & Payroll Report Fixes — Design

**Date:** 2026-06-12
**Status:** Approved, ready for implementation plan
**Area:** `src/server/modules/reports/*`

## Problem

The Reports → Financial and Payroll views show three numbers that mislead the operator:

1. **"Commissions owed: $2,890" is far too low.** It only sums *generated* `Commission`
   rows (status `pending`/`approved`). A commission record doesn't exist until someone runs
   `generateDealCommissionAction` on a deal — which is *gated* and can't be generated until the
   deal reaches the "Depreciation Requested" stage. Every active deal earlier in the pipeline
   contributes $0, so the figure ignores the real commission liability sitting against the
   $122,900 left to collect.

2. **"Contractor payments: $0" is a single lumped number.** The business pays more than one
   contractor (e.g. construction vs. installation), but the report shows one total with no
   breakdown. Detection today: a money-out transaction whose vendor is a 1099 vendor, or whose
   category matches `/contractor|subcontractor|labor|crew/i`.

3. **Payroll gives no view of remaining estimated commissions.** The operator wants to see, on
   Payroll, roughly how much commission is owed in total against work in progress — the
   "$122,900 to collect → ~$X estimated commission owed" picture.

## Decisions (from the user)

- **Contractor breakdown:** by **individual contractor** (1099 vendor), each listed with their
  period total. No new data — uses who was actually paid.
- **Commissions owed:** **generated + estimated combined** headline, with a sub-breakdown
  showing locked-in (generated) vs. estimated.
- **Estimate basis:** a deal's estimated commission uses the rep's *current* split terms (nothing
  is locked until generation), so the projection shifts if a rep's split changes — correct for a
  forward-looking number.

## Approach

No schema changes. Everything derives from existing models (`Project`, `Lead`, `Commission`,
`Transaction`, `BookkeepingVendor`, `User`). PDF and CSV outputs inherit the changes
automatically because they consume the same `ReportResult` shape.

### Component 1 — shared `getCommissionLiability` helper (`reports/queries.ts`)

```
getCommissionLiability(companyId, scope) → {
  lockedInCents,   // generated, unpaid (status in [pending, approved]) — today's number
  estimatedCents,  // estimated rep split across ACTIVE deals with NO generated commission
  byRep: [{ name, lockedInCents, estimatedCents }]
}
```

- **Active deals** = `Project` rows with `status notIn [cancelled]` whose `lead` matches
  `scope.leadWhere`.
- **lockedInCents** = sum of `Commission.amount` where `status in [pending, approved]`, scoped by
  `scope.userIds` when present (mirrors the existing `commissionOwed` aggregate).
- **estimatedCents** = for each active deal that has **no** generated commission row yet, run the
  canonical `computeDealCommission` (the same engine used by the deal page and the Bookkeeping
  Jobs profit card) and take the rep-split total. Deals that already have a generated commission
  are represented by `lockedInCents` instead — **no double counting**.
  - Inputs per deal: `contractValue`, `supplementCents`, `deductibleCents`, `repGetsSupplement`,
    job cost (from bookkeeping), `overheadPct`, the rep's active split %, `deductiblePct`.
  - The rep's *active* split = provided-lead split when `companyProvidedLead`, else self-gen split
    (same precedence as `getDealFinancials`).
- **Efficiency:** batch the per-deal job-cost lookup across all active projects rather than N
  sequential `getDealJobCost` calls. Job cost = approved deal-tagged expenses minus
  contractor/sales payouts (existing `costs/job-cost.ts` logic), grouped by `projectId`.
- **Overrides** (manager-earns-off-rep) are only counted when actually generated, so they live in
  `lockedInCents`. The estimate covers the rep split only — kept deliberately simple/honest.

### Component 2 — Financial report (`buildFinancial`)

- **Commissions owed** metric value = `usd(lockedInCents + estimatedCents)`; hint →
  `"generated + estimated"`.
- New table **"Commissions owed — locked-in vs. estimated"**: a per-rep table with columns
  `[Rep, Locked-in, Estimated, Total]` plus a totals row, so the operator sees what is
  contractually generated vs. projected.

### Component 3 — Financial report contractor breakdown (`buildFinancial`)

- Keep the **Contractor payments** headline total.
- Build a per-contractor map while iterating money-out transactions: bucket by the transaction's
  `vendor` name when it is a known 1099 vendor; otherwise fall back to bucketing under the
  transaction `category` name (e.g. "Crew labor"). Only transactions already classified as
  contractor spend (current detection rule) are included.
- New table **"Contractor payments by contractor (in period)"**, columns `[Contractor, Amount]`,
  sorted high→low.

### Component 4 — Payroll report (`buildPayroll`)

- New metric **"Est. commissions remaining"** = `usd(lockedInCents + estimatedCents)` (scoped),
  hint `"generated + estimated"`.
- New table **"Estimated commissions by person"** from `byRep`, columns
  `[Person, Locked-in, Estimated, Total]`.

## Testing

Extend `e2e/reports.spec.ts`:

- Financial report renders the **"Contractor payments by contractor"** table.
- Financial **Commissions owed** reflects the combined (generated + estimated) figure — assert it
  is greater than the locked-in-only baseline given seeded active deals.
- Payroll report renders **"Est. commissions remaining"** and the by-person estimate table.
- Rep scope still sees only their own estimate (no company-wide leakage).

Seed already creates active deals with rep split terms (rep 45% / rep2 40%), so the estimate is
non-zero without new seed data. Add a seeded active, not-yet-generated deal if needed to make the
combined figure provably exceed the locked-in baseline.

## Out of scope

- No contractor "trade/type" field added to vendors (would be a separate data-model change).
- No change to how commissions are generated or gated.
- No change to the estimate to include overrides before generation.
