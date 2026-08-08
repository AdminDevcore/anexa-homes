# Estimate — pricing a job on the deal

**Date:** 2026-08-07
**Status:** approved, built

## The problem

Nothing in the app prices a job before the carrier does.

**Scope of Work** looks like it should, but it answers a different question. Its lines carry
what the carrier *allows* and what the work *costs us*; it exists to show profit and
supplement potential. It is also gated three ways: insurance deals only, only once the deal
reaches Scope Received, and hidden entirely on cash deals.

So a rep standing in a driveway has no way to work out what to charge. On a cash deal the
Claim Info tab literally says "Set the price in the proposal" — meaning: type a number you
worked out somewhere else. On an insurance deal there is nothing at all until the carrier's
scope arrives.

## What we're building

An **Estimate** slide on the deal: line items × quantity × the price we charge → a total,
with an explicit button to send that total to the deal's price.

## Placement

A new slide in the deal's switcher, between **Claim Info** and **Scope of Work**. That order
is the order the work happens in: we price the job, then a carrier scope arrives, if one ever
does.

Shown on **cash and insurance alike, with no stage gate** — the two gaps above are the whole
reason it exists. Hidden only for solar deals, which price through their own design and
finance panels.

## Permissions

Estimates reuse the existing **`Scope` resource** rather than introducing one of their own:
the roles that may price a job are exactly the roles that may work a scope, and `sales_rep`
already holds `read` + `update` there. No RBAC migration.

What separates the two is **cost visibility**, gated independently by the existing
`canSeeScopeCosts` (super_admin / admin / manager). A rep builds the estimate and quotes the
customer; cost, gross profit and margin are stripped from the payload before it leaves the
server, not merely hidden in the markup.

## Data

Two new tables (`estimates`, `estimate_lines`), one migration:

- **`Estimate`** — one per lead (`leadId @unique`), `vertical`, optional `costTemplateId`
  (SetNull, the pattern `ScopeOfWork` already uses), `discountCents`, `notes`.
- **`EstimateLine`** — `position`, optional `catalogItemId` (SetNull), `category`,
  `description`, `quantity`, `unit`, and **`unitPriceCents`** — the sell price, and the one
  field that makes this table something other than a `ScopeLine`.

`Estimate` is registered in `SCOPED_MODELS`, so reads are filtered to the active vertical and
writes are stamped with it. `EstimateLine` is a child reached through its parent, like
`ScopeLine`.

## Math

`src/lib/estimate.ts` — pure, integer cents, no DB and no UI, mirroring `scope.ts`:

    subtotal  = Σ (quantity × unitPrice)
    discount  = min(discount, subtotal)      ← clamped, never negative
    total     = subtotal − discount
    cost      = Σ (quantity × costPerUnit)   ← 0 with no cost template
    margin    = (total − cost) ÷ total

Two decisions worth stating: a discount larger than the subtotal makes the job **free**, not
money owed to the customer; and margin is measured against the **discounted** total, because
that is the money that actually arrives.

## The panel

`estimate-panel.tsx`, modelled on `scope-of-work-panel.tsx`:

- Inline-editable rows — category, description, qty, unit, price/unit → line total — saving
  on blur.
- **Add from catalog** — a searchable, multi-select dialog over the existing per-vertical
  Scope Catalog. It skips items already on the sheet, so using it twice can't duplicate lines.
- **Add line** — a one-off row for anything not in the catalog.
- Totals: subtotal → discount → **customer total**. Management additionally sees cost, gross
  profit and margin, plus a cost-template picker.

## Sending the total to the deal's price

`applyEstimateAsPriceAction` writes the total where that deal type is actually priced:

| Deal type | Lands on | Why |
|---|---|---|
| Cash | the proposal's `content.projectPriceCents` | that is the number the cash proposal quotes |
| Insurance | the project's `contractValue` | the insurance proposal quotes deductible and RCV, so there is no project price to set |

Explicit on purpose — editing a line never moves the deal's price on its own. An insurance
deal with no job yet has nothing to set, and the button says so instead of failing.

## Testing

`src/lib/__tests__/estimate.test.ts` — 11 cases over the math, including the discount clamp,
below-cost pricing, and category rollup.

`e2e/estimate.spec.ts` — three flows:

1. Price a line by hand, apply a discount, flip the deal to cash, push the total, and confirm
   the proposal builder opens with that price already in it.
2. The catalog picker adds several lines at once.
3. A sales rep can build the estimate but sees no cost, profit, margin or cost-template
   picker anywhere in the panel.

## Out of scope

- Sales tax — nothing in the app models tax today.
- Reusable whole-estimate templates ("full roof replacement" presets).
- Any customer-facing rendering of the estimate; the proposal remains the customer document.
