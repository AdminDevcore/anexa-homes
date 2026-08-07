# The visit panel & two payment options

**Date:** 2026-08-06
**Status:** Approved

## Problem

Two unrelated things are wrong on the roofing deal page.

**The sidebar reads as three strangers.** `DealActionsPanel` stacks Appointment
outcome, Insurance claim, and Inspection outcome — in that order, so the claim
sits *between* the two outcomes that belong together. Both outcomes carry
equal-weight buttons and each has an always-open notes textarea, so the panel is
tall, noisy, and gives no sense of sequence.

**The next action isn't there.** After recording an inspection outcome the rep's
next move is to build a proposal — but that button lives in a "Create a
document" card far down the main column, next to two contract tools.

And the proposal itself presents money as one number. A roofing close is
"$18,500, or $308 a month" — the customer should see both and pick.

## Design

### 1 · The visit panel

`deal-actions-panel.tsx` becomes one numbered flow. The claim block that used to
sit *between* the two outcomes is gone from the panel entirely.

```
THE VISIT
 ✓ 1  Appointment        ● Inspected · Damage found    Change
        2 notes ›
 ✓ 2  Inspection         ● Full replacement            Change
        1 note ›
 ──────────────────────────────────────
 [ ▸ Build Proposal ]
```

- A step is **done** when its outcome is set. Done steps show a filled check;
  undone steps a muted circle and their set-button.
- The claim is **not** a step. It was briefly step 3, but the Summary above
  already carries a Claim Status picker, and two controls for one claim forced
  the button to guess a status the deal might be well past. Setting the status
  opens the claim, so the visit ends at the inspection.
- **Notes collapse** behind an `N notes ›` toggle. Expanding reveals the locked
  list and the add box. Append-only semantics are unchanged — existing notes
  stay read-only, new ones are timestamped and attributed.
- **Solar** keeps its current behavior: labels stay "Record qualification" /
  "Site survey outcome", and no proposal button (solar closes through its own
  Proposal hub).
- RBAC is unchanged. `canEditLead` gates the outcome setters; the proposal
  button renders only under `create|update Proposal` — the same check the
  Documents card uses today.

### 2 · Two payment options

`Proposal.content` is already JSON and already carries
`financing: { enabled, termsMonths }`. **No migration.** One field is added:

```ts
selectedPayment?: { mode: "cash" | "finance"; months?: number; at: string };
```

The customer's Financial Summary gains a two-column block:

- **Cash column always renders** — the customer has to see the total regardless.
- **Monthly column renders when `financing.enabled`** and at least one term is
  selected and the amount is > 0.
- The financed amount is `estimatedOutOfPocketCents`, which
  `computeProposalFinancials` already returns correctly for both deal types:
  project price + upgrades − discount on cash, deductible + upgrades − discount
  on insurance. **No math changes.**
- With several terms selected the headline is the *lowest* monthly (longest
  term) — "from $308/mo" — with the other terms as chips underneath that
  re-price the headline live.

Financing stays **0% only**: monthly = amount ÷ months, rounded up so the
schedule never under-collects (`financingOptions`, unchanged). No APR, no lender
plans, no new settings.

On an insurance deal the block shows the deductible as the cash figure. The
Texas §707 disclaimer stays intact and the deductible is still shown in full —
financing is a payment method, not a rebate.

### 3 · The customer's pick

New token-authed `selectPaymentOptionAction` in `proposals/actions.ts`, built on
the existing `postCustomerNote` pattern:

- saves `content.selectedPayment`
- writes a `Note` (context `proposal`) and an `ActivityLog` row —
  *"Customer selected Monthly · 60 mo · $308.34/mo"*
- re-picking overwrites and logs again; a changed mind is information
- rep preview mode disables it, same as `NextStepActions`

The chosen column then renders with a check and "Your selection".

### 4 · Naming

User-facing **"Build Presentation" → "Build Proposal"**, matching the `Proposal`
model. The `/presentation` route stays — renaming it breaks any bookmarked
builder link and buys nothing.

### 5 · Builder

Payment options move out of the middle of step 2's field list into their own
bordered "Payment options" group at the bottom of **Details**, with a live
two-column preview of exactly what the customer will see. Still five steps —
adding a sixth would renumber a flow reps already know.

## Testing

- Unit: headline-term selection (lowest monthly wins), financed amount per deal
  type, and that a disabled/empty-term financing config yields no monthly column.
- E2E: record both outcomes in the visit panel → Build Proposal → enable terms →
  generate → open the public token page → Choose Monthly → assert the note lands
  on the deal.
- The 8 known-failing baseline specs stay out of the verdict.

## Out of scope

- APR-bearing or lender-integrated financing (explicitly rejected — 0% only).
- Multiple proposal rows per lead. One proposal, two payment paths.
- Any change to the appointment/inspection outcome *lists*, which stay
  customizable in Settings.
