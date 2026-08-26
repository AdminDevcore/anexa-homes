# Solar proposal — layout redesign

**Date:** 2026-08-26
**Scope:** the customer-facing solar proposal document only. Roofing untouched.

## Why

The document works but reads as a template. Three concrete faults, all visible in
a single screenshot of `/portal/leads/<id>/solar-proposal/preview?v=3`:

1. **It repeats itself.** `netSavingsCents` renders four times
   (`solar-proposal-view.tsx:442`, `:474`, `:741`, `:947`). System size, year-one
   production and offset render on the cover as four tiles and again one screen
   later as three cards.
2. **It leads with the wrong number.** The cover and the second chapter both give
   the largest type on the page to the 25-year net figure. On a financed deal
   that figure can be negative — prod v3 shows `-$19,217` in accent orange under
   the words "net saving", which is an oxymoron.
3. **It is twelve stops long.** Twelve `<Section>`s of equal visual weight, so
   nothing is emphasised and everything is scrolled past.

## Direction

Editorial paper ground — the existing warm `#f6f3ee` and Fraunces (already wired
as `--font-display` in `src/app/layout.tsx`) used at real display sizes — with
the two key comparisons **drawn rather than stated**: the bill swap on the cover
and the utility-vs-solar crossover in the lifetime chapter.

Light ground throughout. Dark chapters stay as accents only, because print is a
first-class output here and Chrome drops backgrounds by default.

## Chapter map — 12 → 7

| # | Chapter | Absorbs | Notes |
|---|---------|---------|-------|
| 1 | Cover | `cover` | Leads with the strongest *true* line for this deal (see below). Four stat tiles become one spec line. |
| 2 | Today → Tomorrow | `overview` + `today` | Bill now vs bill after, drawn. One lifetime figure beneath. |
| 3 | Your system | `system` + `layout` + `how` | Specs and the aerial array on one screen. `how-it-works` becomes a 4-step strip at the foot. |
| 4 | Your cost | `cost` | Payment menu, incentives, inclusions. Loses the `CostStat` row. |
| 5 | Over 25 years | `savings` | Chart, scrubber, table. Skipped when `showComparison` is off. |
| 6 | What happens next | `timeline` + `impact` | Impact folds in as a slim stat band. |
| 7 | Accept | `accept` + `faq` | Signature first, FAQ as an accordion below, expanded in print. |

After this, the lifetime figure renders **once**, in chapter 5 — or in chapter 2
when chapter 5 is disabled.

## The cover pitch

The cover must not run one template. A financed deal whose payment exceeds the
current bill (prod v3: roughly $330 against $180) reads *worse* under a
"monthly swap" cover than under today's layout.

`coverPitch(snapshot, option)` returns one of three shapes:

- `monthly-swap` — financed, and `monthlyCents + postSolarMonthlyCents` is below
  today's bill. Draw the two bars.
- `cash-then` — no `monthlyCents` (cash). "One payment of $X, then about $Y a
  month instead of $Z."
- `coverage` — financed, and the payment is **not** below the bill. Do not lead
  with money at all; lead with what is true: coverage, production, ownership.

Today's bill is `energy.avgMonthlyBillCents`, falling back to year-one
`utilityCostCents / 12`, which always exists.

## The lifetime figure

`lifetimeFigure(savings)` returns `{ label, cents, tone }`:

- `cents >= 0` → "Projected N-year net saving", `tone: "good"`.
- `cents < 0` → "Projected N-year net cost", **absolute value**, `tone: "plain"`,
  with copy that says the bill avoided does not fully cover the system, that the
  customer owns it outright, and that it transfers with the house.

The accent colour is withheld from a negative figure. Nothing is hidden and no
number changes — only the label, the sign and the emphasis.

## Deck behaviour

- `scroll-snap-type: y proximity` on the root, `scroll-snap-align: start` per
  chapter, `scroll-margin-top: var(--proposal-chrome-h)`. **Proximity, not
  mandatory** — chapters 4 and 5 are taller than a viewport and mandatory snap
  traps the reader inside them.
- `←` `→` `PageUp` `PageDown` move by chapter, ignored while focus is inside the
  signature field or any input.
- Chrome shows seven labels wide, seven dots narrow. Seven fits where ten did not.
- Snap disabled below 768px, under `prefers-reduced-motion`, and in print.

## Structure

`solar-proposal-view.tsx` (2,074 lines) becomes `src/components/proposal/solar/`
— one file per chapter plus `primitives.tsx`, `deck.tsx` and `pitch.ts`.
`solar-proposal-view.tsx` stays as a re-export so `/proposal/[token]` and the
portal preview import paths do not change.

`SolarProposalView`'s props are unchanged.

## Out of scope

- `savingsModel`. A `loan` books the full cash price in year one and no interest
  thereafter, which flatters every financed deal. Real, and a separate change.
- Amos pricing and the lender cap.
- The roofing proposal (`presentation-view.tsx`) and its e2e specs.
- Any schema or migration. There are none.

## Verification

- `pitch.ts` and the lifetime label are pure functions with unit tests, covering
  cash, financed-below-bill, financed-above-bill, missing bill, and negative net.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- Render the real Plano deal and confirm against the DB: 8.80 kW, $26,400,
  $56,444 avoided, $30,044 net, payback year 14.
- `git diff --stat` proving no roofing file changed.
