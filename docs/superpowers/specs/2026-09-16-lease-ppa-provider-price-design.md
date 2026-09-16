# Lease & PPA provider price — design

**Status:** approved by the owner 2026-09-16. Implementation plan next.
**Branch:** `feat/provider-price` (off `main` @ `4315f92`).

## Why

On a lease or PPA the homeowner never buys the system. The provider (today only
Axess Energy) owns it and bills the household per kWh or per month. The provider
still pays Anexa for the system, usually a price per watt, and the app has
nowhere to record that:

- `financeRowForProduct` writes `grossPpwCents`, `contractPriceCents` and the
  adder totals as **0** on lease/PPA.
- Reports book a lease/PPA at **$0** (`solarContractRevenueCents`), and the
  pipeline shows only the kWh rate or monthly.
- Rep pay on lease/PPA is forced to a **flat rate per watt** (`resolveSolarPay`),
  because there was no price to measure a redline against.

This came out of a real report on 2026-09-16: a rep kept typing a price on an
Axess PPA and it "kept going back". That was fixed in `fc47d2e` (the card now
says there is no system price on a PPA). This design gives that card a real
number.

**Production today (read-only check, 2026-09-16):** 1 PPA deal (the owner's test
deal), 0 leases, 5 active Axess 30-year PPA programmes (escalators 1.99, 2.5,
2.99, 3.5, 3.99%), and **no solar commission has ever been written**. Changing
the pay basis therefore moves no existing money.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where the $/W comes from | **Rate sheet + override.** Each lease/PPA programme carries its own $/W. A deal inherits it, and an admin can override it on one deal. |
| 2 | Rep pay | **Redline against the provider price**, the same shape as cash and loan. |
| 3 | Revenue | **Revenue and deal value.** Reports, the job's contract value and the pipeline all use the provider total. |
| 4 | Scope | **Lease and PPA**, same field and same rules. |
| 5 | Adders and battery | **Paid on top.** Total = $/W × watts + the deal's adders + the battery at its price. |
| 6 | Where it shows | **The builder's System price card**, with an admin click-to-override. |
| 7 | Approach | **A separate provider-price field on `main`**, read through one resolver. |

Rejected approaches:

- **Inside `priceDeal()` on `feat/pricing-rework`.** That rework stopped before
  Stage 4 pending counsel, and nothing imports `priceDeal()` yet.
- **Reusing the purchase columns** (write the provider $/W into `grossPpwCents`
  on a PPA). Credits, the lender submission amount, the sign-today credit and the
  proposal all read those columns as what the household signs, so every one of
  them would start treating a PPA as a purchase.

## Hard constraint: never in the proposal snapshot

`src/app/proposal/[token]/page.tsx` passes the **whole** `snapshot` to
`SolarProposalView`, which is `"use client"`. Anything in the snapshot therefore
ships to the homeowner's browser. The provider price and provider total must
**not** be written into `SolarProposalSnapshot`. Every reader below takes them
from the deal row, server-side. A test pins this.

## Data

Additive migration. No backfill: the owner types Axess's $/W onto the 5
programmes after deploy.

| Column | Type | Meaning |
|---|---|---|
| `SolarLenderProduct.providerPpwCents` | `Int?` | Lease/PPA programmes only. What the provider pays Anexa per installed watt, in cents ($2.80/W = 280). Null means the programme has no price set. |
| `SolarFinance.providerPpwOverrideCents` | `Int?` | An admin's price for this one deal. Null means use the programme's. |
| `SolarFinance.providerRevenueCents` | `Int @default(0)` | DERIVED cache, like `contractPriceCents`: what the provider pays in total on this deal. 0 on cash/loan and on a lease/PPA with no price. |

Validation:

- `providerPpwCents` and the override are integers, 1–2000 (cents per watt;
  anything above $20/W is a units mistake).
- Both are refused on cash and loan rows, and on storage-only deals (lease/PPA
  storage stays blocked, as today).

## The one resolver

New pure module `src/lib/solar-provider-price.ts`:

```ts
providerPrice({
  product,                // FinanceProduct
  systemType,             // "pv" | "pv_storage" | "storage"
  programmePpwCents,      // SolarLenderProduct.providerPpwCents
  overridePpwCents,       // SolarFinance.providerPpwOverrideCents
  systemWatts,
  adderTotalCents,        // inside + on-top, at face value (no dealer fee on lease/PPA)
  batteryPriceCents,      // batteryChargeCents(...)
}): null | {
  ppwCents: number;
  source: "override" | "programme";
  systemCents: number;    // ppwCents × systemWatts, the part a redline is measured on
  totalCents: number;     // systemCents + adderTotalCents + batteryPriceCents
}
```

- Returns `null` for cash/loan, for storage, when no $/W resolves, and when
  watts ≤ 0.
- The override wins over the programme.
- Every consumer below calls this and nothing re-derives the figure. The builder
  card calls it with live on-screen values; the server calls it with stored
  values.

## Writes

- **`dealMoneyColumns`** (`deal-money.ts`) computes `providerRevenueCents` via
  `providerPrice`. The adders come from `resolveAdderTotal` and the battery from
  `batteryChargeCents`, both of which it already reads. It also reads the quoted
  programme's `providerPpwCents` and the deal's override. `providerRevenueCents`
  joins `DERIVED_KEYS`, so `recomputeDealMoney` keeps it in step when the
  design, adders or battery change.
- **`saveSolarFinanceAction`** accepts an optional `providerPpwOverrideCents`:
  - A change to it by anyone below `admin` is refused ("Only an admin can
    override what the provider pays").
  - The existing `checkSignedLock` already covers the whole save, so a signed
    deal needs the super-admin unlock and the change is audited ("the provider
    price", before → after).
  - The override is cleared automatically when the deal moves to cash/loan.
- **Programme edits** (`lender-product-actions.ts`): when `providerPpwCents`
  changes, run `recomputeDealMoney` and `restampLeadValue` for every deal quoting
  that programme. The recompute chokepoint (`economicWritesAllowed`) already
  refuses signed deals, so a signed deal keeps its figure.

## Rep pay

- **`loadCommissionDeal`** (`commission-pricing.ts`): on a lease/PPA pv or
  pv_storage deal, `basePriceCents` is `providerPrice(...).systemCents` (0 when
  there is no price). `finalPriceCents` stays 0: there is no signed price to
  check against.
- **`resolveSolarPay`** (`solar-pay.ts`) gets a new input, `providerPriced`. It
  is true when `providerPrice(...)` resolves for the deal. On a lease/PPA pv or
  pv_storage deal:
  - `providerPriced` → basis `redline` (the rep's `solarRedlineCentsPerWatt`,
    measured on the provider system figure; adders and battery excluded, as on
    cash/loan).
  - Not priced → basis `per_watt`, exactly as today. No rep silently loses a
    commission line because a programme has no $/W yet.
  - The lender's `repPayMode` stays ignored on lease/PPA, as today. Storage-only
    lease/PPA stays `refused`.
- **The two callers of `resolveSolarPay` pass it:**
  - `dealTerms` in `solar/deal-comp.ts` freezes the TERMS at the first
    signature. It reads the finance row's override and the quoted programme's
    `providerPpwCents` and calls `providerPrice`.
  - `resolveDealPayTerms` in `payroll/solar-engine.ts` is the unsigned fallback.
    It uses the live measure its two callers already hold (`commissionMeasure`,
    around lines 258 and 550): `providerPriced = measure.basePriceCents > 0`.
- **Terms freeze at the first signature, and that is unchanged.** `SolarDealComp`
  is create-only, so the pay BASIS a lease/PPA signs under is permanent: a deal
  signed before its programme had a $/W stays on the flat rate. The owner should
  set Axess's $/W on the 5 programmes before the next PPA signs. The MEASURE
  (`basePriceCents`) still re-freezes on every signature. Lease/PPA already
  freeze it from the live deal (`pricedBasis: "live_deal"`), which now captures
  the provider system figure, and the super-admin "Re-freeze from the signed
  proposal" re-reads it.

## Revenue and deal value

- **`SolarPriceSource`** (`solar-deal-value.ts`) gains an optional
  `providerRevenueCents`, supplied only by server callers and never read from a
  snapshot.
  - `solarContractRevenueCents`: lease/PPA returns `providerRevenueCents` when
    > 0, else 0 (today's answer).
  - `solarDealValue` / `solarLeadValueCents`: lease/PPA with
    `providerRevenueCents > 0` is `kind: "total"` with that figure; otherwise
    today's monthly/rate reading.
- **`restampLeadValue`** (`deal-value.ts`) reads `SolarFinance.providerRevenueCents`
  for the lead and adds it to the price source. `Lead.value` and
  `Project.contractValue` then carry the provider total on lease/PPA.
  - It already runs at generation, approval and un-approval.
  - Add calls after a lease/PPA financing save and after a recompute that moved
    `providerRevenueCents`, so an override or a programme change reaches the
    pipeline without generating a new version.
- **`reports/solar-contract.ts`** snapshot fallback (deal with no job yet): for a
  lead whose reported snapshot is lease/PPA, use `providerRevenueCents` from its
  `SolarFinance` row (one extra batched `findMany` over the lead ids). Jobs are
  already covered by `Project.contractValue`.
- **Deal page** (`src/app/portal/leads/[id]/page.tsx`, its three
  `solarDealValue(...)` calls around lines 1111, 1219 and 1231): add the finance
  row's `providerRevenueCents` to each price source, so on lease/PPA the page,
  the pipeline and reports show the same total. This is a server component, so
  nothing reaches the homeowner.

## Screens

**Builder System price card** (`solar/system-price.tsx`). On lease/PPA this
replaces the "No system price on a PPA" note from `fc47d2e`.

- **Priced:** headline "{Provider} pays $2.80/W · $35,728", with the kW note.
- **Ladder:** Provider price, Adders, Battery × N (only when present), then
  **Total paid to Anexa**.
- **Footer:** "What {Provider} pays for this system. The homeowner's payment is
  the programme's rate."
- **Override:** admins and super admins click the $/W to open the same
  click-to-edit editor (±5¢ stepper, typeable, Done). It saves with Save
  financing, like the base price. When overridden, a small "Programme $X/W ·
  Reset" link appears. Reps see the figures read-only. The signed lock disables
  it like every other economic control.
- **No price anywhere:** "{Provider} has no price per watt on this programme
  yet." Admins also get "Set it in Settings → Lenders", linking to that lender.
- **Props:** `providerName`, `programmeProviderPpwCents`,
  `providerPpwOverrideCents`, `canOverrideProvider`, `onProviderOverrideChange`.
  The card calls `providerPrice` with its live adders and battery.
  `SolarFinancePanel` supplies them from the quoted programme, the finance row
  and `role ∈ {admin, super_admin}`.

**Settings → Lenders rate sheet** (`solar-lender/rate-sheet.tsx`): lease and PPA
rows get a "Provider pays ($/W)" input next to the rate, escalator and term. It
is absent on cash/loan rows.

## Out of scope

- The amount submitted to a lender's application (`lender-submit.ts`).
- The compare columns on the financing shelf.
- The homeowner's proposal document (see the hard constraint).
- Storage-only lease/PPA, which stays blocked.
- Folding into `feat/pricing-rework`. That branch (draft PR #38) will need to
  merge over this. Expected overlap: `schema.prisma` (Solar* models),
  `deal-money.ts`, `solar-pay.ts`, `commission-pricing.ts`,
  `solar-deal-value.ts`, `system-price.tsx`, `solar-panels.tsx`. Tell that
  session when this lands.

## Testing

**Unit (vitest):**
- `providerPrice`: override beats programme, null cases (cash, loan, storage, no
  price, 0 W), totals include adders and battery, cents arithmetic ($2.80 ×
  12,760 W = $35,728).
- `resolveSolarPay`: lease/PPA priced → redline; unpriced → per_watt; storage
  lease/PPA → refused; cash/loan unchanged.
- `solarContractRevenueCents` / `solarLeadValueCents`: lease/PPA with and
  without a provider total; cash/loan unchanged.
- `SystemPriceCard`: priced, overridden (Reset link), unpriced (with and without
  admin), rep read-only, loan still unchanged.
- **Snapshot guard:** a generated lease/PPA snapshot contains no `provider*`
  key.
- The cash/loan pricing goldens must stay byte-identical.

**Integration (itest, private schema per `itest-schema-contention`):**
- A save writes `providerRevenueCents`. A recompute after an adder moves it.
- A non-admin override is refused. A signed deal refuses it without an unlock,
  and with an unlock it is audited.
- A programme $/W change re-derives unsigned deals and leaves signed ones.
- `restampLeadValue` puts the provider total on `Lead.value` and
  `Project.contractValue`.
- The report fallback books the provider total for a lease/PPA lead with no job.
- Payroll pays redline on a priced PPA, and per-watt on an unpriced one.
- Signing a priced PPA freezes `basis = "redline"` on `SolarDealComp`, and
  signing an unpriced one freezes `per_watt`. A later programme price does not
  change the frozen basis.

**Manual:** a real builder on a local PPA deal: set the programme $/W, see the
card, override as admin, see read-only as a rep, and confirm Save financing
persists after reload (the original bug's shape).
