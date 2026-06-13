# Public-Adjuster Fee in Deal Commission — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorm), pending implementation plan
**Area:** Deal Financials / commission engine

## Problem

On the Deal Financials worksheet the commission engine deducts a **"Company
overhead (10%)" computed on the whole contract** (`computeDealCommission` uses
`Company.overheadPct × splitBase`). That does not match how the business
actually works:

1. On real deals a **public adjuster (PA) takes 10% of the supplement** — the
   extra dollars recovered beyond the original claim. The owner thinks of this
   10% as "the company overhead," but it is really the PA's cut and it is tied
   to the **supplement**, not the contract.
2. Some reps do not want to wait for the supplement to land. They are **paid
   early on the base only**; the company still collects the supplement later and
   the rep does not get a share of it.

The Scope projection module already models rule (1) correctly
(`src/lib/scope.ts`: `paFeeCents = supplement × paFeePct%`). The commission
engine was never brought in line. Rule (2) is **already implemented** via the
per-deal "Rep waived supplement" toggle (`repGetsSupplement`) — no change needed
there; we keep it as-is.

## Decisions (from brainstorm)

- **PA fee base = supplement only.** `PA fee = round(supplement × rate%)`. A deal
  with **no supplement has no PA fee and no overhead deduction at all.**
- **PA fee replaces the company-overhead line.** Relabel "Company overhead
  (10%)" → **"Public adjuster (10%)"**; it is money leaving to the PA.
- **Rep early-pay uses the existing `repGetsSupplement` toggle.** No new flow.
- **Marketing/company-provided-lead split is unchanged** (already handled by the
  provided-lead split %).

## Math

In `computeDealCommission` (mirrors `scope.ts`):

```
paFeeCents      = supplement > 0 ? round(supplement × paFeePct%) : 0
inclSuppl       = repGetsSupplement ? supplement : 0
splitBaseCents  = base + inclSuppl
deductedPaFee   = repGetsSupplement ? paFeeCents : 0   // PA fee only burdens the side that holds the supplement
poolCents       = splitBaseCents − jobCost − deductedPaFee
splitCommission = pool > 0 ? round(pool × repSplit%) : 0
companyProfit   = pool − splitCommission (+ net supplement kept when rep waived)
adjustedContract= base + supplement + deductible   // company revenue, unchanged
deductibleComm  = round(deductible × repDeductible%) // unchanged, separate line
```

**Why `deductedPaFee` is gated on `repGetsSupplement`:** the PA fee is entirely
attributable to the supplement. When the rep waives the supplement, the
supplement (and its PA fee) are company-only — the rep's base pool must not be
docked for a PA fee on money they are not receiving. When the rep gets the
supplement, the net supplement (90%) flows through the shared pool.

### Worked example — base $28,900, supplement $6,000, cost $0, rep 45%

| Line | Rep **gets** supplement | Rep **waived** (paid early) |
|---|---|---|
| Split base | $34,900 | $28,900 |
| − Public adjuster (10% × $6,000) | −$600 | not charged to rep's base |
| Profit pool | $34,300 | $28,900 |
| Rep commission (45%) | $15,435 | $13,005 |
| Company keeps | $18,865 | $15,895 + $5,400 net supplement |

### No-supplement deal (the accepted behavior change)

Base $28,900, no supplement → **no PA/overhead deduction.** Pool = $28,900 −
cost. Previously the deal lost $2,890 to "Company overhead." Owner explicitly
confirmed this is intended: the 10% only applies when there is a supplement (the
PA only earns on what they recover).

## Rate source

Reuse the existing **`Company.overheadPct`** (default 10) as the single
company-wide rate — **no schema migration.** It is now interpreted as the
PA-fee rate applied to the supplement. The settings field
(`deal-split-settings.tsx`) is relabeled "Public adjuster fee %." The per-deal
`ScopeOfWork.paFeePct` is left untouched (Scope projection keeps its own).

## Components to change

- `src/lib/commission.ts` — `computeDealCommission`: rename the `overheadPct`
  input role to `paFeePct`; compute `paFeeCents` on `supplementCents`; gate the
  deduction on `repGetsSupplement`; expose `paFeeCents` in `DealCommission`
  (replacing `overheadCents`, or keep the field name with new meaning).
  `computeDealSplit` (legacy, contract-overhead) is unused by the deal path —
  audit and remove or leave; do not let it diverge silently.
- `src/server/modules/costs/queries.ts` — `getDealFinancials` already loads
  `overheadPct`; just feeds it as the PA rate. No query shape change.
- `src/components/portal/deal-financials.tsx` — relabel the line to **"Public
  adjuster (N%)"**, render it **only when `supplementCents > 0`**, and only as a
  pool deduction when `repGetsSupplement`. Keep the live `computeDealCommission`
  call in sync with the server.
- `src/components/portal/deal-split-settings.tsx` — relabel the company
  `overheadPct` control to "Public adjuster fee %."

## Consistency / blast radius

`computeDealCommission` is the canonical engine; `getJobSettlements`
(bookkeeping Jobs profit card) and `getProjectPayout` derive from the same deal
financials, so they inherit the change. **Audit `payroll/engine.ts` and
`reports/queries.ts`** (both reference `overheadPct`) — if either independently
applies `overheadPct × contract` for commission/profit, update it to the
supplement-based PA fee so all surfaces agree. Generated commissions are
snapshotted at generation time, so already-generated commissions are unaffected
until regenerated.

## Testing

- Unit (`src/lib/commission`): the four cases — (a) no supplement → no PA fee;
  (b) rep gets supplement → PA fee deducted, rep shares net supplement; (c) rep
  waived → rep base pool untouched by PA fee, company keeps net supplement;
  (d) deductible share unchanged.
- E2E (extend `bookkeeping-jobs` / deal-financials spec): worksheet shows
  "Public adjuster" only with a supplement; no-supplement deal shows no overhead
  line; waived-supplement deal does not reduce the rep line by the PA fee.

## Out of scope

- No change to the "Rep waived supplement" UX beyond optional copy tweaks.
- No new schema fields; no migration.
- Scope projection module (`scope.ts`) is already correct — untouched.
