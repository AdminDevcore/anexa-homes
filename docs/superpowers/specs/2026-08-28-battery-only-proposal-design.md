# Storage-only proposals: a battery is not a small solar system

Date: 2026-08-28
Status: approved

## Problem

Anexa sells Tesla batteries without panels. The proposal builder cannot quote
one, and the failure is not cosmetic — it is arithmetic.

**The price collapses to zero.** `pricePurchase()` in `src/lib/solar-money.ts`
opens with `systemWatts = systemSizeKwDc * 1000` and multiplies everything by
it. A storage-only design has no array, so `systemSizeKwDc` is 0, so
`baseStickerCents` is 0 and the contract is worth whatever the adders happen to
come to. Every guardrail around that number is per-watt too: the lender's
`maxFinalPpwCents` ceiling (Amos Capital Fund is a flat $5.50/W), the
`minBasePpwCents` margin floor, and the company band all divide by watts that
are not there.

**The document argues from production.** The seven chapters in
`src/components/proposal/solar/index.tsx` are built on `year1ProductionKwh`:
offset %, the twelve-month production-against-usage chart, the twenty-five-year
utility-versus-solar table, the post-solar bill, and the environmental
equivalences. A battery makes no kilowatt-hours. Rendering those chapters for a
storage deal prints zeroes where a homeowner expects the argument.

**Commission pays nothing, quietly.** `solarRepPayCents()` supports a
`per_watt` basis. On a deal with no watts it returns zero without complaint —
the same shape of bug as the `Project.contractValue = 0` incident that zeroed
every solar commission.

So this is a **second pricing basis and a second value story**, not a flag that
hides the panel card.

## Decisions

| Question | Decision |
|---|---|
| What the rep is asked | "What are we quoting?" — Solar / Solar + Storage / Storage only, at the top of step 1 (Customer) |
| Storage pricing basis | Flat base price **per battery**, grossed up by the lender's fee exactly as $/W is |
| PV + Storage ("Both") | **Byte-identical to today.** Only `storage` branches |
| Price guardrails | Per-battery floor and ceiling on the lender, mirroring the $/W trio |
| Commission | Redline measured per battery; a `per_watt` rule on a storage deal **refuses**, never pays zero |
| Which lenders appear | Filtered by a `financesStorageOnly` flag on each finance product |
| Value story | Backup hours + VPP earnings + time-of-use savings. No 25-year table, no environmental chapter |
| TOU rates | On the electric provider in Settings, beside the buyback rate; per-deal override |
| Backup hours | Company-editable load profiles (Essentials / + AC / Whole home), hours derived |
| Incentive | VPP earnings (already exists) + a new rebate catalogue that comes **off gross, before the fee** |
| The document | A new `storage.tsx` sibling, not a branch inside the 69 KB `index.tsx` |

## The one field everything hangs off

```prisma
enum SolarSystemType {
  pv
  pv_storage
  storage
}

model SolarDesign {
  systemType SolarSystemType @default(pv_storage)
}
```

Backfilled from what is already on the row: `pv_storage` where `batteryId IS
NOT NULL`, `pv` otherwise. That is derivable and honest; defaulting every
historical design to one value would relabel deals that were sold with a
battery.

**`pv` and `pv_storage` take the identical code path everywhere.** The
distinction exists for the rep's mental model and for the storage-only filter
to have something to test against. Nothing else may branch on it. This is
written down because a three-value enum where two values are meant to behave
identically is exactly the shape that drifts apart six months later, one
`if` at a time.

## Pricing: a second basis in the same ladder

The vocabulary does not change, because every expensive mistake in this module
has been a vocabulary mistake:

```
  BASE      what the rep prices the batteries at, before any lender's cut
+ ADDERS    the extra work, at catalogue price, likewise before the cut
- REBATE    the manufacturer's money, passed through
= GROSS     what the company keeps
+ FEE       the lender's cut, a percentage OF FINAL
= FINAL     what the customer signs
```

Worked example — two Powerwalls at a $13,000 base, a $2,700 main-panel upgrade,
a $500-per-battery rebate, a 25% programme:

```
BASE     2 x $13,000            $26,000
+ ADDERS  MPU                    $2,700
- REBATE  2 x $500               $1,000
= GROSS                         $27,700
+ FEE     (25% of final)         $9,233
= FINAL   customer signs        $36,933
```

### Storage

```prisma
model SolarFinance {
  stickerPricePerBatteryCents Int @default(0)
}
```

Stored as the **sticker** — fee included — for exact symmetry with
`grossPpwCents`, whose comment already records that it carries the fee. The
rep's input box takes the base and converts with the same
`grossPpwFromNet` / `basePpwFromSticker` helpers the $/W box uses. One
convention, two units.

### The function

`priceStoragePurchase()` in `solar-money.ts`, returning the same named fields
as `PurchaseBreakdown` with per-battery rates in place of per-watt ones:
`batteryQty`, `basePriceCents`, `basePricePerBatteryCents`, `adderTotalCents`,
`onTopAdderTotalCents`, `rebateCents`, `grossPriceCents`, `dealerFeeCents`,
`contractPriceCents`, `finalPricePerBatteryCents`, `baseStickerCents`,
`adderStickerCents`, `marginCents`.

The invariant a homeowner checks with a calculator holds identically:

```
baseStickerCents + adderStickerCents - rebateStickerCents === contractPriceCents
```

The fee stays a percentage **of final** (`gross / (1 - f)`, never
`gross * (1 + f)`), the fee still applies to ordinary adders and still does not
apply to on-top ones, and cash still rejects a dealer fee rather than silently
applying it. Every rule in `pricePurchase`'s docblock carries over unchanged;
only the thing being multiplied is different.

### The band functions

`capStickerToFinalPpw`, `underBaseFloor` and `bandPpwCents` get a shared core
parameterised by a divisor — watts or batteries. **The existing per-watt
signatures stay as thin wrappers, so no PV call site changes.** These functions
are load-bearing and heavily commented; duplicating them for storage is how the
two copies end up disagreeing about the 50% fee rule.

## Everything else that gains a column

| Model | Field | Why |
|---|---|---|
| `SolarLender` | `minBasePricePerBatteryCents` | Margin floor. A rep cannot quote a Powerwall under it |
| `SolarLender` | `maxFinalPricePerBatteryCents` | Ceiling, or a flat price |
| `SolarLender` | `finalBatteryPriceMode` (`cap` \| `flat`) | Mirrors `finalPpwMode` — Amos prices flat |
| `SolarLenderProduct` | `financesStorageOnly Boolean @default(false)` | Not every lender funds standalone storage |
| `SolarProvider` | `touPeakRateMills`, `touOffPeakRateMills`, `touPeakWindow` | Beside `buybackRateMills`, which is already there |
| `SolarDesign` | `touPeakRateMills`, `touOffPeakRateMills` (nullable) | Per-deal override for the odd plan; null means use the provider's |

Default `false` on `financesStorageOnly` is deliberate: an unreviewed product
does not offer to fund something it may not fund.

### Usable capacity needs no new field

Battery capacity is already in the catalogue. `SolarEquipment.ratingW` holds
**watt-hours** on a battery — `solarEquipmentLabel` renders "Tesla Powerwall 3 ·
13500Wh". So:

```
usableKwh = (battery.ratingW / 1000) * batteryQty
```

The column is misnamed for this kind. It is **read, not renamed**: a rename
reaches the VPP equipment lists, the catalogue manager and the AVL joins, and
buys nothing this feature needs.

### Backup load profiles

```prisma
model SolarBackupProfile {
  id        String  @id @default(uuid())
  companyId String
  vertical  Vertical @default(solar)
  name      String
  loadWatts Int
  rank      Int     @default(0)
  isActive  Boolean @default(true)
}
```

Seeded per company: Essentials 1000 W, Essentials + AC 3500 W, Whole home
5000 W. Hours are derived, never typed:

```
hours = usableKwh / (loadWatts / 1000)
```

The proposal shows **every active profile** as a short table. There is no
"which one do I headline" field on the design: the cover takes the
lowest-load profile by rank, which is deterministic from data that already has
an order.

### Rebates

```prisma
model SolarRebate {
  id          String  @id @default(uuid())
  companyId   String
  vertical    Vertical @default(solar)
  name        String
  amountCents Int
  perBattery  Boolean @default(false)
  isActive    Boolean @default(true)
  rank        Int     @default(0)
}

model SolarDealRebate {
  id          String @id @default(uuid())
  leadId      String
  rebateId    String
  qty         Int    @default(1)
  /// Copied from the catalogue at apply time, so editing a rebate in Settings
  /// cannot move a price a rep has already quoted.
  amountCents Int
}
```

A rebate comes off **gross, before the fee**. The company is passing the
manufacturer's money through, so it reduces what the company keeps and the fee
is then taken on the lower final — which is why the payment amortises the
smaller number.

On the customer's side of the breakdown the rebate therefore appears **grossed
up by the same fee everything else is**, `rebate / (1 - f)`, which is what makes
the invariant above add up: $34,666.67 system + $3,600 work − $1,333.33 rebate
= $36,933.34. A rebate subtracted at face value from a grossed-up total leaves a
breakdown that is a few hundred dollars short of its own bottom line, in front
of a homeowner with a calculator.

Rebates are available on **any deal carrying a battery**, storage-only or Both:
a Tesla rebate is a Tesla rebate either way. Nothing is applied by default, so
every proposal in flight prices exactly as it does today.

## Time-of-use savings

```
peakUsageKwhPerDay   = annualUsageKwh / 365 * peakSharePct
shiftedKwhPerDay     = min(usableKwh * cyclesPerDay, peakUsageKwhPerDay)
annualTouSavingsCents = shiftedKwhPerDay * 365 * (peakRate - offPeakRate)
                        * roundTripEfficiency
```

`peakSharePct` (30%), `cyclesPerDay` (1.0) and `roundTripEfficiency` (90%)
become company assumptions and **freeze into the snapshot** with every other
assumption. Nothing is hardcoded — the standing rule at the top of
`solar-proposal.ts`, and a number a homeowner reads is one somebody at the
company decided to stand behind.

**When the provider carries no TOU rates and the rep has not overridden them,
the savings line is omitted entirely** — not printed as zero, not printed from
the single blended rate. Backup hours and VPP still carry the chapter.

`peakSharePct` is the softest number in this feature: it is modelled, not
measured. It is listed on the document as an assumption for exactly that
reason.

## VPP

`vpp-credits.ts` keys off `batteryId`, `batteryQty`, the finance product and
the provider. It does not appear to gate on system size, so it should survive
with no array attached. **To be confirmed in code, not assumed** — a VPP credit
that silently vanishes on storage-only deals removes the one earnings figure
this document has.

## The builder

Step 1 (Customer) opens with the question:

```
Step 1  Customer
+- What are we quoting? --------------+
|  ( ) Solar   (o) Solar + Storage    |
|  ( ) Storage only                   |
+-------------------------------------+
Name, address, contact...
```

It is first because everything downstream reshapes from it — which steps show,
what the Design step asks, which lenders appear. Asking it on the Design step
would leave the Energy step already behind the rep by the time the builder knew
what it was building.

When `systemType = storage`:

- **Design step becomes Storage design.** Battery model (still filtered by the
  lender's approved-vendor list), quantity, and nothing else. The roof drawing,
  roof planes, facing arrow, PVWatts call, autofill, layout upload and layout
  approval are all skipped — there is no array to place.
- `systemSizeKwDc`, `year1ProductionKwh` and `offsetPct` stay 0 and are never
  presented as figures.
- **Energy step stays.** The bill and the rate are what the TOU savings and the
  "Today" chapter are built from.
- **Financing shelf filters** to products with `financesStorageOnly`. When none
  qualify, it says so plainly and names the reason. An empty shelf with no
  explanation is a rep on the phone to the office.

Readiness (`solar-validation.ts`) gains a storage branch: battery and quantity
set, a price per battery inside the band, a finance product that funds storage,
at least one active backup profile. The PV gates — module, planes, production,
offset — are skipped rather than failed.

## The document

Snapshot goes to `schemaVersion: 5`, adding `systemType` and a `storage` block
(battery label and quantity, usable kWh, the backup table, the TOU figures or
null, the rebate lines). **An absent `systemType` means an old document and
renders exactly as it does now.**

A new `src/components/proposal/solar/storage.tsx`, sibling to `index.tsx`,
reusing `primitives`, `cover`, `accept`, `certificate`, `deck` and `print`.
`index.tsx` is already 69 KB; a second full document inside it stops being
readable, and the two documents share primitives rather than control flow.

Six chapters, following the rule the solar document already keeps — a chapter
with no data is omitted, never rendered empty:

| # | Chapter | Content |
|---|---|---|
| 1 | Today | Their bill, their rate, what an outage costs them |
| 2 | System | Battery, quantity, usable kWh, inverter |
| 3 | Protection | Backup hours per profile, VPP earnings, TOU savings |
| 4 | Your cost | Price ladder, rebate, the payment menu (unchanged) |
| 5 | Next | Install timeline (unchanged) |
| 6 | Accept | Signature, ESIGN certificate, battery-specific FAQ |

**Dropped:** offset %, the production chart, the twenty-five-year table, the
environmental equivalences, the roof layout drawing. Each is dropped because
there is nothing behind it on a battery, not to save space.

The cover headlines usable kWh and backup hours on the lowest-load profile.

## Commission

`solarRepPayCents()` gains a storage branch: redline measured per battery
against `SolarLender.minBasePricePerBatteryCents`.

```
2 batteries, floor $9,000, quoted $11,500
  redline  2 x $2,500 = $5,000  x rep split
```

A rule whose basis is `per_watt` meeting a storage deal **returns an explicit
refusal naming the rule and the deal**, and payroll surfaces it as an unpayable
line. It must never return zero. Paying nothing silently is the precise failure
the `contractValue = 0` incident already caused once.

## Testing

**Unit**
- The storage ladder: base, adders, on-top adders, rebate, fee, and the sum
  invariant `baseSticker + adderSticker - rebate === contractPrice`
- Cash rejects a dealer fee; a fee at or above 100% stands down
- Per-battery floor blocks an under-margin quote; per-battery cap and flat mode
- Backup hours from `ratingW` and a load profile
- TOU savings, including the omission when rates are absent
- Commission refusal on a `per_watt` rule against a storage deal

**Integration**
- Generating a storage proposal writes `systemType: "storage"` and a snapshot
  carrying no production figures
- VPP credits still resolve with no array attached

**E2E**
- Build a storage-only proposal end to end: pick Storage only, price it, choose
  a storage-capable product, generate, and assert the PV chapters and the panel
  equipment card are absent
- **Regression guard: a `pv_storage` deal generates the same document it does
  today.** That is the promise "Both is identical" makes, and it is the one
  thing in this feature that can break deals already in flight

## Migration and rollout

1. Prisma migration for the enum, the six column groups and the three new
   models
2. Backfill `systemType` from `batteryId`
3. Seed the three backup profiles per company
4. Apply on prod through the session pooler on :5432 with the query string
   stripped and `?sslmode=require` appended, then verify the columns and the
   `_prisma_migrations` row by hand — the transaction pooler silently no-ops and
   the migrate CLI reports success either way

## Out of scope

- The federal 30% credit on standalone storage. The product quotes no tax
  credit anywhere, deliberately, and that stays true
- Renaming `SolarEquipment.ratingW` on batteries
- A twenty-five-year projection of storage savings. A TOU spread will not hold
  for twenty-five years and the document should not claim it will
- Modelling a real TOU rate schedule with seasons and weekday/weekend splits.
  One peak rate, one off-peak rate, one window
