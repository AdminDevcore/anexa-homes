# Customer and Energy steps: verify who they are, then work out what they use

**Date:** 2026-08-18
**Status:** approved

## The problem

The solar proposal builder opens on System design. A rep on a call therefore starts by drawing a roof, with no prompt to confirm they are talking to the person the deal says they are, and no structured place to work out what the house actually consumes.

Consumption is the worse gap. Today the form takes annual kWh and a monthly bill, and derives the rate from `bill ÷ usage`. That only works when the customer knows their annual kWh — which is the number they are least likely to have on hand. What they DO know is what they pay a month and, often, their rate per kWh. There is no way to enter those and get usage out.

And nothing tells a rep how big a system this house needs before they start drawing one.

## What we are building

Two steps ahead of System design, taking the builder to five:

```
1 · Customer    2 · Energy    3 · System design    4 · Financing    5 · Generate & send
```

### Step 1 — Customer

First name, last name, co-signer, email, phone, address, city, state, ZIP. Editable in place and saved onto the Lead, so a rep who spots a wrong phone number fixes it without leaving the proposal.

All of these already exist on `Lead` — `coOwnerName` is the co-signer — so this step relocates fields rather than inventing them. It reuses the same zod validation the deal's edit form uses; there must not be two definitions of what a valid lead is.

**Address changes move the roof.** `updateLeadAction` clears `lat`/`lng` when the address changes, and the satellite route re-geocodes on next load. That is correct and self-healing, but it means an address corrected AFTER the array was drawn leaves panels positioned against the old coordinate. The step says so on screen when the address is edited and a layout already exists.

### Step 2 — Energy

**Providers.** Two dropdowns: the utility that delivers the power, and the retail electric provider that bills for it — the TDU/REP split that Texas actually runs on. Both come from company-managed lists. Each ends in an "Other…" option that reveals a text box, so a provider nobody has added yet does not stop a call; whatever is chosen or typed is stored as text on the design, exactly as `utilityProvider` is today. A design naming a provider later deactivated keeps rendering it.

**Consumption, by one of two methods.** A switch picks which two numbers the rep types; the third is calculated and read-only. There is no state in which three contradictory figures are stored.

*From their usage:*
```
  Annual usage (kWh) [ 14000 ]   ·or·   Avg monthly kWh [      ]
  Average monthly bill ($) [ 180 ]
  → 14,000 kWh/yr · $0.154/kWh (calculated)
```
Average monthly kWh is multiplied by 12. Entering either annual or monthly fills the other.

*From their bill:*
```
  Average monthly bill ($) [ 200 ]   Rate ($/kWh) [ 0.20 ]
  → 12,000 kWh/yr (calculated)
```
`$200 ÷ $0.20 = 1,000 kWh/month = 12,000 kWh/year`.

**The target system size.**

```
targetKwDc    = annualUsageKwh × (targetOffsetPct / 100) ÷ (kwhPerKwYear × derateFactor)
targetPanels  = ceil(targetKwDc × 1000 ÷ defaultPanelWatts)
```

Every input is company data from Solar Settings. `targetOffsetPct` is new, defaulting to 100 — some companies deliberately size to 90 or 110, and a hardcoded 100 would break this module's rule that every assumption a homeowner sees arrives as data.

The target is computed, never stored. It is a function of usage and three settings, so storing it would mean a figure that goes stale the moment any of them changes.

### Step 3 — System design

Unchanged except that the designer's counter now reads against the target: **"24 of ~25 panels"**, going green at or above it. The quoted system is still the drawn array. The roof beats the arithmetic — that is the whole point of having drawn it.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Customer step | Editable in place | A rep fixes a wrong number mid-call rather than navigating away. |
| Consumption inputs | Annual kWh, average monthly kWh (×12), bill ÷ rate | The three a customer can actually answer. Twelve individual months was considered and dropped: most accurate, but twelve numbers to type on a call. |
| Conflicting figures | A method switch; the third figure is calculated and read-only | Three editable boxes let a rep store figures that do not reconcile, with no signal which one the proposal used. |
| Target kW | Guides the drawing | Auto-placing panels puts them over chimneys on any real roof; treating the target AS the system re-opens the problem the designer just fixed. |
| Providers | Company-managed lists, free-text fallback | Consistent enough to report on, without blocking a call on a missing entry. |
| Target offset | `SolarSettings.targetOffsetPct`, default 100 | Business preference, and this module hardcodes nothing a customer sees. |

## Data model

```prisma
enum SolarProviderKind { utility retail }

/// The utilities and retail electric providers a company sells against.
/// Same shape as LeadSource: a per-company ordered list, deactivated rather
/// than deleted so a design that already names one keeps rendering.
model SolarProvider {
  id        String            @id @default(uuid())
  companyId String
  vertical  Vertical          @default(solar)
  kind      SolarProviderKind
  name      String
  position  Int               @default(0)
  active    Boolean           @default(true)
  createdAt DateTime          @default(now())

  @@unique([companyId, kind, name])
  @@map("solar_providers")
}

model SolarDesign {
  /// The retailer that bills the customer, where that differs from the utility
  /// that delivers the power. Free text, filled from the managed list.
  electricProvider String?
  /// The rate the rep was TOLD, in mills per kWh. Null means derive it from
  /// bill ÷ usage, which is what every existing design does.
  utilityRateMills Int?
  /// Which method step 2 was filled in with, so it reopens the way it was left.
  /// "usage" | "bill".
  usageBasis       String?
}

model SolarSettings {
  /// What share of the customer's usage a system is sized to cover. Drives the
  /// target on the Energy step; does not constrain what a rep may draw.
  targetOffsetPct Float @default(100)
}
```

`annualUsageKwh` remains the single stored consumption figure whichever method produced it, so everything downstream keeps reading one field.

## One rate, one place

Three call sites currently derive the rate independently (`solar-validation.ts`, `solar-proposal.ts`, and the savings model through it). They all move to:

```ts
/**
 * The customer's rate: what they told us, else what their bill implies.
 *
 * Every surface that shows a rate goes through this. Three call sites deriving
 * it separately is how the validation screen and the customer's proposal end up
 * disagreeing about what the customer pays.
 */
export function resolveUtilityRateMills(d: {
  utilityRateMills?: number | null;
  avgMonthlyBillCents?: number | null;
  annualUsageKwh?: number | null;
}): number | null
```

Returning null stays meaningful: it is what makes "no rate" a blocking validation issue rather than an invented assumption.

## Testing

**Unit** (`src/lib/__tests__/solar-energy.test.ts`)
- `$200 ÷ $0.20/kWh → 1,000 kWh/month → 12,000 kWh/year`, as a named test.
- Average monthly kWh × 12 equals the annual figure.
- Round trip: usage + bill → rate → back to usage, within rounding.
- `resolveUtilityRateMills` prefers a typed rate over the derived one, falls back when null, and returns null when neither is derivable.
- Target sizing at 100%, 90% and 110% offset; panel count always rounds UP (23.1 panels is 24 panels, because you cannot install a tenth of one).
- Zero and negative inputs produce null, never Infinity or NaN.

**Integration** (`src/server/modules/solar/__tests__/`)
- Saving in bill mode stores a derived `annualUsageKwh` alongside the typed rate.
- Saving in usage mode leaves `utilityRateMills` null so the rate stays derived.
- A provider from another company cannot be attached.

**E2E**
- Customer → Energy → System design in order; a bill-and-rate entry shows the derived usage and the target reaches the designer's counter.

## Build order

**Energy first.** It carries the arithmetic and it is what makes the designer's target useful. **Customer second** — mostly relocating fields that already exist. Each ships on its own.

## Out of scope

Twelve individual monthly readings (the `monthlyUsageKwh` column stays unused), time-of-use and tiered tariffs, utility bill parsing or upload, and any live rate lookup. Each is a real feature; none is needed to size a system from what a customer can tell you on a call.
