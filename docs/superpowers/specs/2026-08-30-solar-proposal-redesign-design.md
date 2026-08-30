| `FigureRow` | **New.** Three or four large figures across the foot of a plate, replacing four ad-hoc stat grids. Every figure must have a real snapshot field behind it; a slot with no data is dropped, not filled. |
# Solar proposal — redesign of every sheet after the cover

**Date:** 2026-08-30
**Scope:** the customer-facing solar proposal document. Roofing is untouched.
**Status:** design, awaiting approval

---

## 1. What this is

Rebuild every chapter of the solar proposal except the cover, which was
redesigned on 2026-08-29 (`d4d2e17`, `1885fc0`) and stays exactly as it is.

The cover is now a full-bleed photograph with a frosted white card on it. The
eight chapters behind it are cream sheets of editorial type and tables. They no
longer read as the same document, and the chapters have problems of their own
that predate the new cover.

**Not in scope:** the pricing arithmetic, the snapshot shape, the credit ladder,
the signing flow, the certificate, the rep bar, the roofing proposal.
No `schemaVersion` bump. Nothing about what the document *claims* changes —
only how it is composed.

---

## 2. What is actually wrong

Read from a rendered PDF of a real proposal (`Proposal v4 — mustafa joulani`,
8.80 kW / Amos / 30-year / 2 Powerwalls), not from the source.

1. **Six chapters print as nine sheets.** Four carry no chapter mark: the
   equipment sheet, the battery-credit continuation, the chart continuation and
   the assumptions continuation. They read as leftovers.
2. **Three sheets are 30–50% empty.** The cost sheet has an empty rail running
   its full height. The system sheet has a dead quarter-page.
3. **The document repeats itself.** `BillSwap` renders on the cover and again as
   the first thing in chapter 1. The offset percentage appears on the cover, in
   chapter 1 and in chapter 2. The `$83,976 / $53,440 / $30,536` trio appears in
   `CompareCards` and again in `LifetimeBlock` one sheet later. The system price
   appears in the payment menu card and in the table directly beneath it.
4. **Screen widgets print into the PDF.** The `PaymentMenu` `<select>` and an
   unchecked radio circle are baked into the paper document.
5. **It is a stack of tables.** `SpecList`, `DarkRow` and the year table put
   roughly thirty identical label→value rows across the document. Only two
   things are drawn: `BillSwap` and `CumulativeCostChart`.
6. **The one real asset is wasted.** The array on the customer's own roof is a
   small blob inside a large dark frame, on a half-empty sheet.
7. **There is no proof.** No warranty statement, no company, no crew, no
   "what happens next" on paper before the colophon.

### 2.1 The root cause

`index.tsx` composes chapters as **portrait screen sections**. `print.tsx` then
spends ~380 lines of per-section CSS rearranging them into **landscape sheets** —
a rail grid, `data-print-slot` overrides for `specs`, `plate`, `hardware`,
`battery`, `ladder`, `compare`, `chart`, `programme`, `steps`, `impact`,
`uplift`, plus `data-print-break` and `data-print-tight` escape hatches.

The document is designed twice and the two designs disagree. Every orphan sheet
and every dead half-page is that disagreement surfacing. Adding a tenth override
does not fix it.

**The fix is to design each chapter once, landscape-native**, so the screen
composition and the paper composition are the same composition. `print.tsx`
keeps only what is genuinely about paper — the named `@page` box, background
opt-in, break rules, link/details handling, the certificate — and loses the
shadow layout.

---

## 3. The design system

### 3.1 The rhythm

Two sheet kinds, alternating:

- **Plate** — a photograph or a drawn figure runs full bleed. Type sits on it in
  a translucent white card. This is the cover's grammar, extended to the
  chapters that own a visual.
- **Paper** — cream `#f6f3ee`, Fraunces display, orange accent, the rebuilt
  chapter grid. For chapters that own numbers.

Sequence: `cover → paper → plate → paper → plate → paper → plate → paper → plate`.

The alternation is load-bearing, not decorative: it is what guarantees no two
table pages sit adjacent, which is the actual fix for finding #5.

### 3.2 Tokens (unchanged)

Paper `#f6f3ee`, dark `#0a0a0a`, accent `var(--proposal-accent)` (per-tenant,
defaults `#F4631E`), Fraunces display / Inter sans. The retained cover already
defines this; nothing is re-picked.

### 3.3 Primitives

`primitives.tsx` gains a second chapter shell and keeps the first:

| Component | Change |
|---|---|
| `Chapter` | Becomes **landscape-native**: a 12-column grid with a fixed head zone, sized so it composes identically at `min-h-[100svh]` on screen and `8.5in` on paper. Keeps `id`, `index`, `total`, `eyebrow`, `title`, `lede`, `tone`. **Drops `printLayout`** — there is no second layout to switch to. |
| `Plate` | **New.** Full-bleed `<img>` or `<svg>` child, gradient veil, and named slots for a `GlassCard` and a bottom `FigureRow`. Carries `print-color-adjust: exact` and the veil, so a plate prints as drawn. |
| `GlassCard` | **New.** Extracted from the cover's card so the cover and the plates provably share one component. The cover keeps its current props and rendering. |
| `FigureRow` | **New.** Three or four large figures across the foot of a plate, replacing four ad-hoc stat grids. Every figure must have a real snapshot field behind it; a slot with no data is dropped, not filled. |
| `Stat` | Keeps `accent`-withheld-on-loss behaviour. `tone="card"` variant retired — the card ground is now `GlassCard`. |
| `SpecList` / `DarkRow` | Kept, but demoted: allowed on paper sheets and inside glass cards, never as a chapter's only content. |
| `EquipCard` | Kept for the back matter and the storage document; no longer gets a sheet of its own. |
| `ChapterMark` | Kept as-is. The `01 / 08` numbering is real and earns its place. |

### 3.4 Two new drawn figures

Both use data already in the snapshot that nothing currently renders.

- **`EscalatorCurve`** — the utility's annual cost from year 1 to year N, from
  `savings.years[].utilityCostCents`. One filled curve, both endpoints labelled.
- **`YearShape`** — twelve months of production against twelve months of usage,
  from `snapshot.monthly`. This field exists, is populated only when *both*
  halves are real, and is currently rendered by `YearChart` in a
  half-buried block at the bottom of chapter 1.

---

## 4. The sheets

Cover, eight chapters (marked `01 / 08` … `08 / 08`) and a back-matter sheet that
carries no chapter mark. The mark denominator is computed from the chapters this
document actually has, exactly as the current `chapters` array already does.

`N` = `savings.years.length` (follows the loan term, floor 25, cap 40).

### 00 · Cover — **unchanged**

No edits. Everything below inherits its grammar.

### 01 · Where you are now — **paper**

*Eyebrow:* Today · *Title:* the bill is not flat

- `EscalatorCurve` as the dominant element, endpoints labelled year 1 and year N.
- `SpecList`: utility, annual usage, derived rate, escalation.
- Keeps: "Your rate is worked out from your own bill and usage — not a regional
  average."

**`BillSwap` is removed from this chapter.** The cover owns that figure. What
replaces it is the argument the document has never made explicitly — that
standing still is not free.

**Guard rail:** when `showComparison` is false, `LifetimeBlock` still moves here.
That behaviour is preserved exactly.

### 02 · Your system — **plate**

Full-bleed array-on-roof (`ArrayMap` over `siteImageBase`, falling back to the
uploaded layout image), veil, `GlassCard` naming the hardware, and a `FigureRow` of system size, year-one
production and offset — plus usable battery capacity as a fourth figure only
where `system.battery` exists. No warranty term: `SnapshotEquipment` records
manufacturer, model, rating, quantity, datasheet and photo, and nothing else.
The warranty is a sentence, not a figure, and stays a sentence.

- **The equipment sheet folds in here.** The `EquipCard` trio and the
  "manufacturer warranties" sentence move into the glass card and its footnote.
  One orphan sheet disappears and the hardware is named once.
- The preliminary/final caption is retained verbatim, set on the veil.

**Guard rail — this is the highest-risk sheet.** `hasLayout` is false on plenty
of real deals (no geocode, no uploaded drawing, dead storage object). A plate
with no image is not allowed to render as a grey rectangle. When `hasLayout` is
false, **02 falls back to a paper sheet** with the specs and equipment as they
are today. Never a placeholder, never an empty frame, never the bare aerial with
no array on it.

### 03 · The shape of your year — **paper**

*Eyebrow:* Month by month · *Title:* summer carries winter

`YearShape`, legend, and the existing paragraph about June credit paying for
December.

**Omitted entirely when `snapshot.monthly` is null**, which is most older
documents. The chapter list is built from what this document actually has —
same rule the current `chapters` array already follows for `pay` and `savings`.

### 04 · What it costs — **plate (drawn, dark)**

The credit ladder drawn as a descending stack: contract price, each credit as a
negative bar, net cost. The existing `DarkRow` ladder table sits under the
drawing as the checkable version.

**Everything on today's cost + pay chapters merges here**, in this order:
price rows → ladder → the two payment cards (until credits / once applied) →
`adjustment.disclosure` → `ownershipNote` → `BatteryCredit` → showcased adders →
paydown warning.

**Guard rails — none of this may be lost:**
- The paydown warning (`loanPaydownCents != null`) is a legal-weight block.
- `adjustment.disclosure` is the administrator's own wording, printed verbatim.
- `ladder.disclaimer` is never optional on a page of tax-credit arithmetic.
- Both monthly figures print — "until the credits are applied" and "once they
  are". Printing only the second is the most misleading thing this document
  could do.
- `systemPriceCents` derivation, the total-row suppression rules and the
  "amount financed" suppression rules are presentation logic that has already
  been argued out in comments. **Move them, do not rewrite them.**

### 05 · How you pay — **paper**

The quoted payment at display size, the terms as a `SpecList` (lender, term,
APR, amount financed, price per watt), and the "plus ~$X your utility still
bills you" sentence.

**`PaymentMenu` stops printing.** On screen the rep keeps the switcher; it gets
`print:hidden` and the sheet prints the quoted option's terms as static type.
Where `options.length > 1`, alternatives print as a small comparison strip —
label, monthly, term — not as a form control.

### 06 · N years, both ways — **plate (drawn, dark)**

`CumulativeCostChart` becomes the page: full bleed, the gap between the two
lines shaded, `GlassCard` bottom-right carrying `LifetimeBlock`'s figure plus
the two totals.

- `CompareCards` is **deleted**. Its content is the two lines and the two totals,
  which the chart and the card now carry. This is where the duplicated trio goes
  away.
- The `vpp` "included above" block, the assumptions paragraph, `SavingsScrubber`
  and the year table **move to back matter (09)**.

**Guard rails:** `lifetimeFigure`'s label-follows-the-sign and accent-withheld
rules are honesty logic and are preserved unchanged. `lifetimeNote`'s
`hasOwnershipNote` drop is preserved. The whole chapter still renders only when
`showComparison` is true.

### 07 · What happens next — **paper**

`SOLAR_TIMELINE` as a real timeline — connector rule, numbered nodes, duration
ranges right-aligned, owner chips with "You" in accent.

The environmental band and the home-value uplift block **move to back matter**.
Four EPA equivalences do not belong on the sheet that answers "what do I have to
do?", and today they push it to a second page.

### 08 · Accept — **plate**

Closes on the cover's photograph. `GlassCard` holds `AcceptForm` (or
`ExecutionBlock` once signed), the consultant, the company and the reference.

- The FAQ **moves to back matter**. It currently sits under the signature and
  puts five paragraphs of reassurance behind a decided customer.
- `superseded` and `previewMode` states render inside the card, unchanged in
  wording.

**Guard rails:** signed-state swap without reload, `previewMode` never signs,
`superseded` never signs. The certificate still prints last, print-only,
unchanged.

### 09 · Back matter — **paper, small type**

One sheet: year-by-year table, `SavingsScrubber` (screen only), every
assumption, the `vpp` programme block, the FAQ, the environmental figures with
their EPA citations, the home-value block, the colophon and
`disclaimers.estimate`.

**Nothing is removed from the document.** It stops competing with the argument
for the same page. Everything that is honesty-critical stays honesty-critical
and stays printed.

---

## 5. The storage document

`storage.tsx` is a sibling document for battery-only deals sharing
`primitives`, `accept`, `signature-block`, `certificate` and `print`.

Because the primitives change under it, it must be updated in the same change or
a battery-only customer receives a document in the old language with a
half-migrated shell. **Its chapter content and argument stay exactly as they
are** — backup hours, programme earnings, time-of-use — only the shell moves to
the new `Chapter` / `Plate` / `GlassCard`.

---

## 6. Files

**Changed**
- `src/components/proposal/solar/primitives.tsx` — new `Chapter`, add `Plate`,
  `GlassCard`, `FigureRow`
- `src/components/proposal/solar/index.tsx` — the eight chapters recomposed
- `src/components/proposal/solar/print.tsx` — shadow layout deleted; keeps the
  named page box, background opt-in, break rules, details/link handling,
  certificate rules
- `src/components/proposal/solar/storage.tsx` — shell only
- `src/components/proposal/solar/cover.tsx` — extract `GlassCard`, no visual change
- `src/components/proposal/payment-menu.tsx` — `print:hidden` + static print fallback
- `src/components/proposal/year-chart.tsx` — becomes `YearShape`
- `src/components/proposal/solar/chart.tsx` — full-bleed plate variant

**New**
- `src/components/proposal/solar/escalator.tsx` — `EscalatorCurve`

**Deleted**
- `src/components/proposal/compare-cards.tsx` — content absorbed by 06

`index.tsx` is 1820 lines today. The chapters move into
`src/components/proposal/solar/chapters/*.tsx`, one file per sheet, with
`index.tsx` keeping the state, the derivations and the chapter list. No chapter
file should exceed ~300 lines; 04 is the largest because the cost and ladder
chapters merge into it.

---

## 7. What must not break

These are all load-bearing and each is currently correct:

- `coverPitch` — the cover never leads on money when money is not the strong
  part of the deal
- `lifetimeFigure` / `lifetimeNote` — a negative result is a *cost*, stated
  positively, without the accent colour
- The credit ladder rows subtract to the printed total to the cent
- Both monthly payment figures print
- The paydown warning prints
- `adjustment.disclosure` and `ladder.disclaimer` print verbatim
- A chapter with no data is **omitted**, never rendered empty — `pay`,
  `savings`, `monthly`, `hasLayout`, `hasEquipment`, `vpp`
- Old snapshots (`schemaVersion` 1–6) still render
- Rep re-price swaps the document under the customer without a reload
- Signing swaps the block in without a reload
- Dark grounds carry `print-color-adjust: exact`
- `@page anexa-solar` stays named and landscape

---

## 8. Testing

- Existing unit tests on `solar-proposal-pitch`, the ladder and the options
  build are untouched and must stay green.
- Print tests: the existing checks for dark-ground opt-in and for the named page
  box are extended to assert **every `[data-chapter]` starts a sheet and no
  sheet is emitted without a chapter mark** — the direct test for finding #1.
- Visual verification: generate a PDF for four shapes — financed with ladder and
  battery; cash with no battery; no layout image (02 falls back); `monthly` null
  (03 omitted) — and read them as documents.
- E2E: existing solar proposal specs must pass. Note the known
  `SOLAR_VERTICAL_ENABLED` skip and the seeded required-custom-field trap.

---

## 9. Assumption to confirm

Nine sheets plus back matter, as storyboarded and approved. The alternative —
folding 03 into 02 and 05 into 04 for six sheets — is a change to the chapter
list only and can be made later without touching the design system.
