# Solar pay structure

**Date:** 2026-08-21
**Status:** Approved

## The problem

The team-member page carries one pay model: roofing's profit-pool split
(self-gen %, company-provided lead %/flat fee, deductible %). Solar does not pay
that way and never has, so today a solar rep's page shows a roofing worksheet
that means nothing on their deals.

Worse, the payout is silently broken. `computeCommissionsForProject` builds the
pool from `Project.contractValue`, and **no code path ever writes a solar deal's
price onto its Project** — the column is `0` on every solar row in the database.
A solar deal therefore generates a commission of $0, and so does every sales
manager's `CommissionOverride` on it, because those are a percentage of the same
zero. Nobody has noticed because no solar deal has reached payroll yet.

## How solar actually pays

Two bases, chosen per deal:

| Deal | Basis | Formula |
|---|---|---|
| Loan, lender set to **Fixed $/W** (Amos Capital Funding) | `per_watt` | `watts × rate` |
| Loan, lender set to **Redline** | `redline` | `max(0, netPrice − redline × watts)` |
| **Cash** — no lender, no dealer fee | `redline` | same; net equals gross |
| **Lease / PPA** — no system price exists | `per_watt` | `watts × rate` |

### Redline

The rep's redline is a **net** price per watt: what the company keeps after the
lender's cut. The rep keeps **100% of everything above it**.

```
Redline (net)   $2.00/W
Sold gross      $3.20/W
System          10,000 W

Credit Human, 18% fee -> net $2.624/W -> over $0.624/W -> rep earns $6,240
GoodLeap,     32% fee -> net $2.176/W -> over $0.176/W -> rep earns $1,760
```

Net rather than gross on purpose: moving a deal onto expensive money has to come
out of the rep, not the company. A gross-basis redline pays the same $4,000 on
both rows above while the company nets $6.4k less on the second.

**Adders are excluded.** The basis is `pricePurchase().netPriceCents` — gross
minus dealer fee, before adders. A steep-roof charge or a main-panel upgrade is
priced from the catalogue to cover its own cost; it is not rep overage.

### Fixed $/W

`watts × rate`, flat, whatever the price. Used on any lender flipped to fixed
pay, and on lease/PPA, where there is no system price to redline against — the
array is still physically installed, so per-watt is the only honest basis.

## Data model

No new tables. Columns only.

### `User` — the rep's terms

```prisma
/// The rep's redline: what the company must keep per installed watt, NET of the
/// lender's dealer fee, in cents (200 = $2.00/W). Everything the deal nets above
/// this is the rep's. Null = this rep has no redline and redline deals pay them
/// nothing — the team page says so rather than quietly generating $0.
solarRedlineCentsPerWatt Int?
/// Fixed rate per installed watt on a fixed-pay lender (and on every lease/PPA),
/// in MILLS — tenths of a cent, 400 = $0.40/W. Mills because $0.405/W is a real
/// rate and cents cannot express it; matches SolarDealAdder.millsPerWatt.
solarPerWattMills        Int?
```

### `SolarLender` — which lenders pay fixed

```prisma
enum SolarRepPayMode {
  /// The rep sells against their own redline and keeps the overage.
  redline
  /// The rep earns their fixed $/W rate whatever the deal prices at.
  per_watt
}

/// How reps are paid on this lender's deals. Data, not a name check: Amos is
/// simply the first lender switched to per_watt, and the second one needs no
/// deploy. Hardcoding `name === "Amos"` would flip every rep back onto redline
/// pay the day somebody renames it to "Amos Capital".
repPayMode SolarRepPayMode @default(redline)
```

### `Commission` — the snapshot

Same discipline the roofing `splitPct` / `splitFlatCents` snapshot already
enforces: the terms lock at generation so raising a rep's redline never
re-prices a deal they already sold.

```prisma
/// Which solar basis produced this line: "redline" | "per_watt". Null on every
/// roofing line.
solarBasis               String?
/// The rep's redline at generation, cents per watt.
solarRedlineCentsPerWatt Int?
/// The rep's fixed rate at generation, mills per watt.
solarMillsPerWatt        Int?
```

Watts and price are deliberately **not** snapshotted — a design that grows
between contract and install should move the number, exactly as job costs move a
roofing pool.

## Components

### `src/lib/solar-pay.ts` — new, pure, no I/O

The whole decision and the whole arithmetic, so the engine, the team page's
worked example and any future deal-page widget compute one number from one place.

```ts
export type SolarPayBasis = "redline" | "per_watt";

export type SolarPayTerms = {
  basis: SolarPayBasis;
  redlineCentsPerWatt: number | null;
  millsPerWatt: number | null;
};

/** Which basis applies, and on what terms. Null when the rep has no config for it. */
export function resolveSolarPayTerms(input: {
  product: FinanceProduct;
  lenderPayMode: SolarRepPayMode | null;   // null = no lender on the deal
  rep: { solarRedlineCentsPerWatt: number | null; solarPerWattMills: number | null };
}): SolarPayTerms | null;

/** What the terms pay on this deal. */
export function solarRepPayCents(
  terms: SolarPayTerms,
  deal: { systemWatts: number; netPriceCents: number }
): {
  amountCents: number;
  /** The figure `amountCents` was computed from — netPrice on redline, watts on per_watt. */
  basisCents: number;
  netPpwCents: number;
  overageCentsPerWatt: number;
};
```

Basis selection:

- `lease` / `ppa` -> `per_watt`, whatever the lender's mode says. There is no
  system price, so a redline has nothing to compare against.
- `cash` -> `redline`. No lender, no fee, so net equals gross.
- `loan` -> the lender's `repPayMode`; a loan with no lender chosen yet falls to
  `redline`.

Redline arithmetic is `max(0, netPriceCents − redlineCentsPerWatt × watts)` —
integer throughout, no float division, so a 10,001 W system does not round a cent
adrift. Per-watt is `round(watts × mills / 10)`.

A rep whose relevant column is null returns `null` terms and generates no line.

### `src/server/modules/payroll/solar-engine.ts` — new

`computeCommissionsForProject` branches on `project.vertical === "solar"` and
delegates here. A separate file rather than a branch inside `engine.ts`: the two
pay models share no arithmetic, and folding them together produces one function
where half the locals are meaningless on any given call.

The solar path:

1. Loads the lead's `SolarFinance` + `SolarDesign` and the lender's `repPayMode`.
   **Not `Project.contractValue`** — see the problem statement; that column is
   zero on solar.
2. Prices the deal through the existing `pricePurchase` (cash/loan) or
   `priceThirdParty` (lease/ppa) to get `systemWatts` and `netPriceCents`.
3. Rep line — preserve an existing line's snapshot and refresh only the amount,
   mirroring the roofing engine's locked-terms rule. Labels:
   - `Solar redline ($0.62/W over $2.00 · 10,000 W)`
   - `Solar per-watt ($0.40/W · 10,000 W)`
4. Override lines — the existing vertical-scoped `CommissionOverride` path,
   given `SolarFinance.contractPriceCents` as its basis instead of the Project's
   zero.

Deliberately absent on solar: the manager pool split (there is no pool in a
redline model — solar managers earn through overrides, configured on this same
page) and the crew/PM `CommissionRule` lines (the solar workspace has no
commission-rules page and no rules to find).

### `src/server/modules/payroll/eligibility.ts` — changed

The gate stage becomes per-industry. Roofing keeps `depreciation_requested`.
Solar gates at `contract_signed` — the line appears when the deal is sold and
recomputes as the price moves, sitting `pending` until approved, so nothing pays
early but the rep and accounting can see what is owed. `isWon` stays the fallback
for custom pipelines with neither key.

Without this change solar falls to its only `isWon` stage, System Activated —
months after the sale, past both milestone payouts.

### Team member page — reorganised

Pay moves out of the narrow right rail into a full-width **Pay structure** card
in the main column, between the profile and Onboarding & Payroll.

```
MAIN COLUMN                                RIGHT RAIL
+-------------------------------------+   +---------------+
| Abe Silva   AH-00004  Sales Rep      |   | Manage member |
+-------------------------------------+   | Role / Status |
| PAY STRUCTURE                        |   | Title         |
| +---------------+ +----------------+ |   | Reports to    |
| | ROOFING       | | SOLAR          | |   | Verticals     |
| | Self-gen %    | | Redline  $/W   | |   | [Save]        |
| | Provided lead | | Fixed-pay $/W  | |   | [Delete user] |
| | Deductible %  | | worked example | |   +---------------+
| +---------------+ +----------------+ |
|                             [Save]   |
+-------------------------------------+
| Onboarding & Payroll                 |
+-------------------------------------+
```

- Each panel renders only for a vertical the member is actually granted, and
  only for `sales_rep` / `manager`. A roofing-only rep sees one panel and no
  solar controls at all.
- Read unfiltered by the active workspace, matching the override sheet directly
  below it: an admin standing in Solar still needs to see this person's roofing
  terms.
- The roofing panel is the three existing controls moved verbatim. No roofing
  behaviour changes.
- The solar panel shows a worked example that recomputes as you type, and names
  which lenders are currently on fixed pay so "$0.40/W" is not an unexplained
  number. An amber hint when Solar is granted but the redline is blank —
  otherwise the failure mode is a silent $0 months later.
- Its own Save and its own server action, separate from Manage member's. The
  rail gets shorter, not longer.
- The busy flag is wrapped in `try/finally`, so a throwing action cannot latch
  the form into a state where nothing types.

### Settings -> Solar -> Lenders — changed

Each lender row gets a **Rep pay** control: `Redline` / `Fixed $/W`.

## Testing

- `src/lib/__tests__/solar-pay.test.ts` — basis selection across all four
  finance products with and without a lender; redline above, below and exactly
  at the line; cash with no fee; lease/PPA falling to per-watt; mills rounding;
  a rep with the relevant column null generating nothing.
- An integration test beside `override-vertical.itest.ts` — a solar project
  generates the expected rep line and a solar-scoped override off the real
  contract price, and **the roofing path produces byte-identical output to
  today**.

## Not in scope

- Roofing's math, untouched.
- No commission widget on the solar deal page.
- `SolarMilestone` M1/M2 amounts stay manually entered.
- No company-default redline. Per rep only; blank means blank, and the page says
  so.
