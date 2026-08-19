# Lender finance products: quote the payment from the product, not from memory

**Date:** 2026-08-18
**Status:** approved

## The problem

A solar rep quoting a loan today types the APR, the term, the down payment and
the monthly payment into step 2 by hand, from a rate sheet that lives outside
this system. Nothing checks any of it. The only pricing the company controls
centrally is one `defaultGrossPpwCents` and one `defaultDealerFeePct` in Solar
Settings — a single dealer fee for every lender and every product, when the
whole point of a lender's rate sheet is that the fee moves with the money.

Lenders exist as data since `0be5b9e`, but only as a name and an approved-vendor
list. They carry nothing about what they actually finance.

Two things follow:

- **The quoted payment is unverifiable.** It is whatever the rep typed. A
  transposed digit ships to the customer on a signed proposal.
- **Margin leaks silently.** Cheap money costs a bigger dealer fee. A rep who
  moves a deal from 5.99% (12% fee) to 3.99% (28% fee) to win it, without
  raising the sticker, hands over 16% of gross and nothing on the screen says
  so.

## What we are building

A **Lenders & Finance Products** settings screen, and a step-2 product picker
that prices the deal from the chosen product.

```
Settings › Lenders & Finance Products › Credit Human

LOAN PRODUCTS
  25yr · 4.99% · fee 18.0%     [active]
  25yr · 3.99% · fee 28.0%     [active]
  20yr · 5.99% · fee 12.0%     [active]
  12yr · 6.99% · fee  8.0%     [retired]
```

```
Step 2 · Financing

Product  [ 25yr · 4.99% · fee 18% ▾ ]

  target net $/W   2.87
  gross $/W        3.50    derived — override
  system price  $34,200
  ─────────────────────────────
  Monthly (est.)   $198.44
```

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the monthly payment comes from | **Computed** from the product at proposal time; the lender's approved figure overrides it once a credit application comes back | A rep has to quote a payment before any approval exists. After approval, the number a customer is held to is the lender's, not ours — the existing rule (`solar-panels.tsx`) is right, it was just applied to a moment that has no lender figure yet. |
| What a product is | A flat row of terms per finance type: loan, lease, PPA | It matches how rate sheets are published — one row per (term, APR, fee) combination. Cash has no lender and gets no row. |
| Rate cards (size band × market → $/kWh) | **Not now** | Real for Sunrun/Sunnova-style PPAs, and a much larger build. A flat row per product is honest for a company selling its own loans, and rate cards can hang off a product row later without rewriting it. |
| What a differing dealer fee does to price | **Hold target net $/W, derive gross**: `gross = net ÷ (1 − fee)` | Margin is protected by construction rather than by a rep remembering to reprice. Cheaper money visibly costs the customer more, which is what it actually does. |
| Where the net target lives | One `targetNetPpwCents` on `SolarSettings` | Same altitude as the pricing defaults already there. Null turns the whole behaviour off, so nothing changes until it is set. |
| One products table or three | **One**, nullable columns gated by `product` | Exactly the shape `SolarFinance` already uses for the same four products. Three tables would triple the CRUD for no gain. |
| Terms on the deal: copy or reference | **Copy**, keeping `lenderProductId` for provenance | Editing next quarter's rate sheet must not silently re-term a signed proposal. Same argument that made equipment retire rather than delete. |
| Where the lender is chosen | Step 1, where it already is | It gates equipment, so it has to be decided before equipment. Step 2 reads it. A second control writing the same field is the mistake the builder already avoided once. |

## Data model

### `SolarLenderProduct` — new

```
id, companyId, vertical(solar), lenderId → SolarLender (Cascade)
product        FinanceProduct   -- loan | lease | ppa, never cash
name           String?          -- optional label; falls back to derived terms

-- Loan
aprPct         Float?
termMonths     Int?
dealerFeePct   Float?

-- Lease
leaseRateCentsPerKwMonth Int?

-- PPA
rateMillsPerKwh Int?

-- Lease & PPA
escalatorPct   Float?
termYears      Int?

isActive       Boolean @default(true)   -- retire, never delete in use
rank           Int     @default(0)
```

Required-by-type is enforced in the action, not the column types: a loan row
needs APR, term and fee; a lease row needs rate, escalator and term; a PPA row
needs mills, escalator and term.

### Changed

- `SolarFinance.lenderProductId` — nullable, `ON DELETE SET NULL`. Provenance
  only; the terms themselves are copied onto the finance row.
- `SolarSettings.targetNetPpwCents` — nullable Int. Null = derive nothing.

Both additive. Rollback is a drop.

## The maths

New in `solar-money.ts`, pure and unit-tested:

- `loanPaymentCents({ principalCents, aprPct, termMonths })` — standard
  amortisation, with the 0% APR case returning `principal / term` rather than
  dividing by zero. Principal is the contract price minus any down payment.
- `grossPpwFromNet(netPpwCents, dealerFeePct)` — `net ÷ (1 − fee/100)`. A fee
  of 100% or more is rejected rather than returning Infinity.

Lease and PPA need no new maths. A lease product's $/kW-month multiplied by
system size produces the `monthlyPaymentCents` that `priceThirdParty()` already
takes; a PPA product's mills feed it directly.

## Behaviour on the deal

1. Step 1 picks the lender (already built).
2. Step 2 offers that lender's **active** products for the selected finance
   type. A product the deal already uses stays offered even when retired — the
   same rule equipment follows, and for the same reason: a save must never
   write null over a deal's own terms.
3. With no lender on the design, step 2 says so and links to step 1.
4. Choosing a product copies APR / term / fee (or rate / escalator / term) onto
   the finance row, derives gross from the net target when one is set, and shows
   the estimated monthly.
5. Gross stays overridable. The derived figure is a starting point, not a lock.
6. `loanMonthlyPaymentCents`, once entered from a real approval, wins
   everywhere — the builder and the customer-facing proposal — and the UI
   labels which of the two is being shown.

Readiness gains one blocking finding: a loan, lease or PPA deal with no product
chosen, linking to step 2.

## Testing

- Unit: `loanPaymentCents` against known amortisation values, the 0% case, a
  zero-term guard; `grossPpwFromNet` including the ≥100% fee rejection.
- Unit: product validation — each type rejects a row missing its own terms.
- Integration: creating, retiring and deleting a product; deleting is refused
  while a finance row references it.
- Manual: build a loan deal end to end and confirm the proposal shows the
  estimate, then the approved figure once entered.

## Rollout

One `CREATE TABLE` plus two nullable columns, all additive. **This work sits on
top of the lender AVL feature and cannot reach production before it does** —
both migrations apply in order, manually, via the session pooler.
