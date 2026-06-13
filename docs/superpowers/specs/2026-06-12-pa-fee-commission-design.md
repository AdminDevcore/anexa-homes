# Deal Economics — Public-Adjuster Fee + Scope Rep-Commission Estimate

**Date:** 2026-06-12
**Status:** Approved (brainstorm), pending implementation plan
**Area:** Deal Financials worksheet + Scope of Work estimate panel

## The one model (applies to every surface)

Two **separate** 10% cuts — they are NOT the same money:

1. **Company overhead** = `Company.overheadPct%` of revenue/contract (base). The
   company's operating margin. Applies on **every** deal, supplement or not.
   **Unchanged from today.**
2. **Public-adjuster (PA) fee** = `paFeePct%` of the **supplement** (the recovered
   delta beyond the allowed/base amount). Money that **leaves to the PA**. Only
   when there is a supplement. This is the **new** piece on the Deal Financials
   worksheet; the Scope estimate already models it.

Decision (owner): *"Two separate 10%s, everywhere."* This revises the earlier
"PA replaces overhead" idea — overhead is kept; the PA fee is **additional**.

The rep early-pay case is already handled by the per-deal **`repGetsSupplement`**
toggle and is unchanged.

## Surface A — Deal Financials worksheet (`computeDealCommission`)

Today: `pool = splitBase − jobCost − overhead`, `overhead = overheadPct × splitBase`.
**Change = add a PA-fee deduction on the supplement; keep overhead as-is.**

```
inclSuppl     = repGetsSupplement ? supplement : 0
splitBase     = base + inclSuppl
overhead      = round(splitBase × overheadPct%)            // UNCHANGED
paFee         = supplement > 0 ? round(supplement × paFeePct%) : 0   // NEW
deductedPaFee = repGetsSupplement ? paFee : 0   // PA fee only burdens the side holding the supplement
pool          = splitBase − jobCost − overhead − deductedPaFee
repSplit      = pool > 0 ? round(pool × repSplit%) : 0
companyProfit = pool − repSplit (+ net supplement kept when rep waived)
adjustedContract = base + supplement + deductible          // UNCHANGED
deductibleComm   = round(deductible × repDeductible%)      // UNCHANGED, separate line
```

**Why `deductedPaFee` is gated on `repGetsSupplement`:** the PA fee is entirely
attributable to the supplement. When the rep waives the supplement, the
supplement (and its PA fee) are company-only; the rep's base pool must not be
docked for a PA fee on money they are not receiving.

**Worked example** — base $28,900, supplement $6,000, cost $0, overhead 10%, rep 45%:

| Line | Rep **gets** supplement | Rep **waived** (paid early) |
|---|---|---|
| Split base | $34,900 | $28,900 |
| − Company overhead (10%) | −$3,490 | −$2,890 |
| − Public adjuster (10% × $6,000) | −$600 | not charged to rep's base |
| Profit pool | $30,810 | $26,010 |
| Rep commission (45%) | $13,864 | $11,705 |
| Company keeps | $16,946 | $14,305 + net supplement |

A **no-supplement** deal is unchanged from today (overhead only, no PA line).

**UI (`deal-financials.tsx`):** add a **"Public adjuster (10%)"** row, shown only
when `supplementCents > 0`, and only as a pool deduction when `repGetsSupplement`.
Keep the live `computeDealCommission` call in sync with the server.

## Surface B — Scope of Work estimate (`scope-of-work-panel.tsx`)

Overhead model here is **unchanged** (the footer keeps "Company overhead (10%)"
on RCV; the "If we supplement" section already adds the PA fee on top — both
10%s, which is correct under this model).

**New "What this deal pays" card** (management-only — same `showCosts` gate as the
Profit Pool card; reps don't see the pool), computed on the **no-supplement
pool** (the green card, RCV − cost − overhead = $2,200 in the screenshot):

```
pool                 = currentProfitCents (no supplement)
rep (self-gen)       = applySplitSnapshot(pool, selfGenPct, 0)
rep (lead-fed)       = applySplitSnapshot(pool, providedLeadPct or selfGen−flat)
deductibleShare      = round(deductibleEstimate × repDeductiblePct%)
rep total (self-gen) = rep self-gen + deductibleShare    | company = pool − rep self-gen
rep total (lead-fed) = rep lead-fed + deductibleShare    | company = pool − rep lead-fed
```

Show, side by side: **rep total** and **company profit** under each split.

**Deductible input** — a small "Deductible (estimate)" field in the card. Transient
client state (it is "just for the estimate"), pre-filled from the project's
`deductibleCents` if a project exists. Not persisted.

Reuses `resolveSplitSnapshot` / `applySplitSnapshot` from `commission.ts` so
flat-fee lead-fed reps compute correctly.

## Rate source

- **Company overhead:** existing `Company.overheadPct` (default 10) — unchanged.
- **PA fee:** add **`Company.paFeePct Float @default(10)`** (small migration) as the
  company-wide PA rate for the Deal Financials worksheet. The Scope estimate keeps
  its per-deal `ScopeOfWork.paFeePct` (already editable in the "If we supplement"
  section); its default may read from `Company.paFeePct`.

## Components to change

- `src/lib/commission.ts` — `computeDealCommission`: add `supplementCents` already
  present; add `paFeePct` input + `paFeeCents` output; gate the deduction on
  `repGetsSupplement`. Keep overhead untouched.
- `src/server/modules/costs/queries.ts` — `getDealFinancials`: load
  `company.paFeePct`, pass it through.
- `src/components/portal/deal-financials.tsx` — add the conditional "Public
  adjuster" row; keep the overhead row.
- `src/server/modules/scope/queries.ts` — `getScopeForLead`: load the assigned
  rep's `commissionSplitPct`, `providedLeadSplitPct` (+ flat-fee fields if used),
  `deductiblePct`; expose only under `showCosts`.
- `src/components/portal/scope-of-work-panel.tsx` — new "What this deal pays" card
  + deductible input, gated by `showCosts`.
- `src/components/portal/deal-split-settings.tsx` — add the company `paFeePct`
  control next to `overheadPct`.
- `prisma/schema.prisma` — add `Company.paFeePct`.

## Consistency / blast radius

`computeDealCommission` is the canonical engine; `getJobSettlements` (bookkeeping
Jobs profit card) and `getProjectPayout` derive from the same financials and
inherit the change. **Audit `payroll/engine.ts` and `reports/queries.ts`** (both
reference `overheadPct`) so they also subtract the PA fee on supplemented deals;
overhead handling there is unchanged. Already-generated commissions are
snapshotted and unaffected until regenerated.

## Testing

- Unit (`src/lib/commission`): (a) no supplement → overhead only, no PA line;
  (b) rep gets supplement → overhead + PA both deducted; (c) rep waived → PA fee
  not charged to rep's base pool, company keeps net supplement; (d) deductible
  share unchanged.
- Unit (scope estimate helper): rep self-gen vs lead-fed off the no-supplement
  pool; deductible share adds to rep total.
- E2E: Deal Financials shows "Public adjuster" only with a supplement; Scope
  estimate "What this deal pays" card shows both splits + company profit and
  reacts to the deductible input; card hidden from reps.

## Out of scope

- No change to the `repGetsSupplement` UX beyond optional copy.
- Rep-commission estimate runs on the no-supplement pool only (not the
  supplemented pool) per owner.
- Deductible estimate is not persisted.
