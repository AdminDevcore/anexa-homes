# A lender can demand a minimum, not just accept a maximum

**Date:** 2026-08-22
**Status:** approved

## The ask

"Can we have a cap on a lender pricing? Also can we have a minimum pricing."

The cap already exists — `SolarLender.maxFinalPpwCents`, edited as **Max final $/W** on
the lender card, a ceiling on the CONTRACT (dealer fee and adders included). It is set on
no lender in production. Nothing in this spec changes it.

The minimum does not exist. The only floor today is company-wide: Settings → Solar →
**Min $/W**, one number for every lender at once.

## What a minimum means here

A floor on the **base** $/W — what the company keeps per installed watt before the
lender's cut. It is a margin guard, not a customer-price guard. That is the number a rep
can erode by discounting, and the number a high-fee partner leaves least of.

### The floor is checked against what you KEEP, not what the rep TYPED

On an uncapped lender these are the same number. On a capped one they come apart, and
the difference is the whole reason this is written down:

    Amos: 65% dealer fee, $5.50/W cap.
    Rep types a $3.00/W base.
    Uncapped that stickers at $8.57/W; the cap solves it back down to $5.50/W.
    What the company actually keeps: $5.50 x (1 - 0.65) = $1.93/W.

A floor tested against the typed $3.00 passes a deal that netted a third of it. So the
test is on the realised figure:

    realised base $/W  =  capped sticker $/W  x  (1 - dealer fee)
    BLOCK when         realised base $/W  <  lender's min base $/W

On an uncapped lender `capped sticker = base / (1 - fee)`, so the expression reduces to
the typed base exactly and no existing deal moves.

Two consequences worth stating, because both are intended:

- **Adders are covered for free.** Under a cap, extra work eats the sticker, which lowers
  what the company keeps — which is exactly when a margin floor should fire.
- **A capped lender's floor lives in the capped world.** Amos at $5.50/W and 65% cannot
  net more than $1.93/W before adders. A $3.00 floor there blocks every Amos deal. That
  is the cap telling the truth about itself, not a bug.

### Interaction with the company-wide band

They stack; the stricter wins. Settings stays the floor under everything and a lender may
only demand more margin, never less. No cross-field validation between the lender's floor
and its cap: they govern different numbers and the realised-base test already reconciles
them.

## The field

`SolarLender.minBasePpwCents Int?` — cents, nullable, null = no floor, which is every
lender until somebody sets one. Sits beside `maxFinalPpwCents`; named for the number it
governs so the pair cannot be confused.

Edited in the same pencil panel as the cap:

> **Min base $/W** — the least this partner's deals may leave you, after its fee.
> Blank = no floor.

Shown on the lender card as a chip, only once set — same rule the cap follows.

## Enforcement: a hard block, in three places

Mirrors exactly how the company-wide band is enforced, so there is one story:

1. **`solar/system-price.tsx`** — a red note under the price the moment the realised base
   drops under the floor.
2. **`solar-validation.ts` → `validateFinance`** — a `block` issue, so readiness fails and
   the proposal will not generate. The lender's floor rides in on `FinanceForValidation`;
   `readiness.ts` reads it off the design's lender.
3. **`proposal-reprice-actions.ts`** — the same check server-side, so the live re-price
   link on a sent proposal cannot be dragged under the floor either.

Only a super admin editing the lender can change the floor. There is no per-deal override.

## Fixed alongside: the band is enforced against two different numbers

Pre-existing defect, in the way of this work:

- `system-price.tsx:200` warns when the **base** leaves the company band.
- `solar-validation.ts:351` and `proposal-reprice-actions.ts:255` block when the
  **sticker** (`SolarFinance.grossPpwCents`, fee-inclusive) leaves it.

On a high-fee lender those are far apart: a $2.80/W base at 65% stickers at $8.00/W and
trips a $8.00 maximum — no warning while typing, a hard block at generate. The builder's
own copy says "this is a guard rail, not a lock" while the server locks it.

**Resolution:** the server compares the **base**, matching the builder. Base is derived
the way `solar-panels.tsx:780` already derives it: `grossPpwCents x (1 - dealerFeePct/100)`.
The "not a lock" copy is corrected. Both floors then govern the same number and cannot
contradict each other.

Consequence, and it is the intended one: a deal blocked today only because its sticker
left the band starts generating.

## Tests

- `solar-money`: realised base from a capped sticker; the uncapped case reducing to the
  typed base; adders dragging the realised base under a floor.
- `solar-validation`: block above/below the lender floor; the company band tested against
  the base and no longer against the sticker; no floor set = no issue.
- Reprice action rejects a below-floor price.
- E2E: set a floor on a lender, price under it, assert generation is blocked.

## Out of scope

Per-lender maximum on the base $/W. A minimum on the final contract price. Manager
override of a blocked deal. Any change to `maxFinalPpwCents` behaviour.
