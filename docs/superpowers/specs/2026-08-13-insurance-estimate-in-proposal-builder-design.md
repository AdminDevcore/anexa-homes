# Insurance estimate figures in the proposal builder

**Date:** 2026-08-13
**Status:** approved

## Problem

Building a proposal on an insurance deal cannot produce a complete document.

The builder's *2 · Details* step collects exactly one insurance number — the
deductible. The other four figures the customer document prints in its Financial
Summary — **Insurance RCV, ACV, Recoverable depreciation, Approved
supplements** — are read straight off the `Claim` record and the `Project`
(`supplementCents`). A rep who has the adjuster's estimate in hand but has not
already filled in the Claim tab builds a proposal that shows `$0` covered, and
the only way to fix it is to leave the builder, go to another tab, and come back.

So the rep needs the carrier's estimate figures where the proposal is actually
being built.

## Design

### Where

A bordered block titled **Insurance estimate** inside step *2 · Details* of
`PresentationBuilder`, rendered only when the deal type is insurance. It absorbs
the existing Deductible field so all five carrier numbers sit together, ordered
the way the customer document prints them:

1. Insurance RCV
2. Actual cash value (ACV)
3. Recoverable depreciation
4. Approved supplements
5. Your deductible

Cash deals are untouched — they keep the Project price field, and the block does
not render.

### Data

Four new optional fields on `ProposalContent` (`src/lib/proposal.ts`):

```ts
rcvCents?: number;
acvCents?: number;
depreciationCents?: number;
approvedSupplementsCents?: number;
```

`deductibleCents` already exists. Proposal content is a JSON column, so there is
**no schema migration**.

### Fallback rule

Every field follows the pattern `deductibleCents` already uses: a typed value
wins; blank falls back to the stored record.

| Field                   | Override            | Falls back to             |
| ----------------------- | ------------------- | ------------------------- |
| RCV                     | `content.rcvCents`  | `claim.rcv`               |
| ACV                     | `content.acvCents`  | `claim.acv`               |
| Recoverable depreciation| `content.depreciationCents` | `claim.depreciation` |
| Approved supplements    | `content.approvedSupplementsCents` | `project.supplementCents` |
| Deductible              | `content.deductibleCents` | `claim.deductible`  |

Each input's helper text names the figure it would fall back to — "Leave blank to
use the claim's $28,400" — so the rep can see the stored number without leaving
the builder, and a deal whose claim is already filled in keeps working with zero
typing.

To render those hints the builder needs the raw stored values, not the resolved
ones. `ProposalBuilderData` gains:

```ts
claimFallback: {
  rcvCents: number;
  acvCents: number;
  depreciationCents: number;
  supplementsCents: number;
  deductibleCents: number;
};
```

### Wiring

In `assembleView` (`src/server/modules/proposals/queries.ts`), the four figures
change from reading the record directly to override-then-fallback:

```ts
const rcvCents = cash ? 0 : content.rcvCents ?? claim?.rcv ?? 0;
const acvCents = cash ? 0 : content.acvCents ?? claim?.acv ?? 0;
const depreciationCents = cash ? 0 : content.depreciationCents ?? claim?.depreciation ?? 0;
const approvedSupplementsCents =
  cash ? 0 : content.approvedSupplementsCents ?? lead?.project?.supplementCents ?? 0;
```

Cash deals keep zeroing all five, so nothing about a cash proposal changes.

`computeProposalFinancials` already takes these as inputs and needs no change.
Because RCV feeds `totalProjectValueCents`, the total project value on the
customer document tracks what the rep types.

### Preview

The "Customer sees" panel already in the Details step gains a **Total project
value** tile (RCV + supplements + selected upgrades), so the rep sees RCV land
somewhere immediately — none of the four new figures move the out-of-pocket
number that panel shows today.

One amber hint appears when an insurance proposal resolves to RCV 0, matching
the existing "Set a deductible" hint: *"Set an RCV — the financial summary will
show $0 covered."*

### Accepted trade-off

These five figures are **proposal-only**. The Claim tab, the claims report
(`reports/claims`), payroll/commission eligibility, bookkeeping suggestions, and
project cost actions all keep reading `claim.*` and `project.supplementCents`.

A rep who types RCV in the builder and nowhere else therefore leaves those
consumers at whatever the Claim record says — usually `0`. This is a deliberate
choice (the builder edits the presentation, not the official claim), and it
matches how `deductibleCents` has always behaved. It is not designed around.

## Testing

**Unit** (`src/lib/__tests__/proposal.test.ts` and a queries-level test):

- Each of the five figures resolves to the content override when set.
- Each falls back to the claim/project value when the content field is absent.
- `0` typed by the rep is an override, not "blank" — it must not fall back.
- A cash deal zeroes all five regardless of content or claim.
- `totalProjectValueCents` reflects an overridden RCV.

**E2E** (`e2e/`):

- On an insurance deal, open Build Proposal → Details, fill the five figures,
  save, and assert each one on the public proposal page's Financial Summary.
- With the fields left blank, the claim's stored figures still appear.

## Out of scope

- The line-item Estimate worksheet (`EstimatePanel`) — untouched.
- The Scope tab's per-line "Covered (RCV)" table — still fed by `ScopeOfWork`.
- Writing any of these figures back to `Claim` or `Project`.
- Cross-field validation (e.g. ACV + depreciation = RCV).
