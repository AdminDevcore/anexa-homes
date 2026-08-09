# Solar proposal builder

**Date:** 2026-08-08
**Status:** approved

## The problem

A roofing rep closes from the Summary card: one emphasized **Build Proposal**
button that opens `/portal/leads/[id]/presentation`, a five-step builder. A
solar rep has no such button. Instead the solar deal page carries the proposal
inline as three full cards — `1 · System Design`, `2 · Financing`,
`3 · Generate & send` — sitting between the activity feed and operations.

That split costs twice:

- **No way in.** There is nothing on a solar deal that reads as "build the
  proposal". The rep scrolls for it.
- **Financing lives in two places.** The Summary card carries a live
  Cash/Loan/Lease/PPA picker (`SolarProductToggle`) writing the same
  `SolarFinance.product` that the `2 · Financing` card's picker writes. Two
  controls, one value. The escalator, term, APR and monthly belong to the
  quote the customer signs — they are proposal inputs that ended up as deal
  chrome.

## The shape

Solar gets roofing's shape: a button in the Summary, a builder on its own page,
and a deal page that reports proposal *status* rather than hosting proposal
*inputs*.

### New route — `src/app/portal/leads/[id]/solar-proposal/page.tsx`

Server component, modelled on `presentation/page.tsx`.

- `requireUser()`; redirect to the deal unless
  `can(user, "create", "Proposal") || can(user, "update", "Proposal")`.
- Redirect a non-solar deal to `/portal/leads/[id]/presentation` — the two
  verticals close through different builders and a stale link must land
  somewhere sensible rather than render an empty solar form.
- Loads what the removed section loaded: `solarDesign`, `solarFinance`,
  `solarSettings`, equipment options, and the proposal versions.
- Same page chrome as roofing: back-link, `Build Proposal` heading, customer
  name · address subtitle.

### New client — `src/components/portal/solar-proposal-builder.tsx`

Pill step nav in the vocabulary of `presentation-builder.tsx`:

| Step | Renders | Owns |
|---|---|---|
| `1 · System design` | `<SolarDesignPanel>` | utility, usage, site, modules/inverter/battery |
| `2 · Financing` | `<SolarFinancePanel>` | product, $/W, dealer fee, adders, APR, term, escalator, monthly, ITC |
| `3 · Generate & send` | `<SolarProposalGate>` | readiness check, generate, version list |

The three panels move **unchanged**. No new server actions and no second copy
of the pricing rules — `SolarFinancePanel` already owns the entire product
surface, it simply stops rendering on the deal page. Each step ends with a
`Next →` to the following one, as roofing does.

### Deal page — `src/app/portal/leads/[id]/page.tsx`

`<section id="proposal">`'s three cards collapse to one `Proposal` card holding
a new `<SolarProposalStrip>`:

- **Headline** — product · kW-DC · headline price (monthly for lease/PPA,
  contract price for cash/loan) · offset %.
- **Versions** — the compact list from `SolarProposalGate`, keeping `Open` and
  `Mark sent` reachable without entering the builder. Reading a proposal and
  building one are different jobs.
- **Build Proposal** button.

Nothing is generated or edited here.

### Summary card

- `dealTypeSlot` on solar renders a read-only `<ProductChip>` instead of
  `SolarProductToggle`. The Summary still answers "is this a lease?"; it no
  longer *sets* it.
- `DealActionsPanel.showProposal` drops its `!isSolar`, so solar gets the same
  terminal **Build Proposal** button, pointed at `/solar-proposal`.

`SolarProductToggle` and `setSolarFinanceProductAction` are deleted with their
only caller — the builder's product picker writes the same field through
`saveSolarFinanceAction`.

### Left alone

The `System & financing` card stays. It is a readout of the numbers the builder
produces ("Add a system design and financing in the Proposal tab and the numbers
appear here") — moving it would take the answer away from the deal along with
the inputs.

## Testing

- Repoint `e2e/solar-no-insurance.spec.ts` (expects `1 · System Design` and
  `3 · Generate & send` on the deal) and `e2e/vertical.spec.ts` (drives
  `Save design` / `Check proposal readiness` from the deal) at the builder
  route.
- New `e2e/solar-proposal-builder.spec.ts`: Summary button opens the builder;
  all three steps reachable; financing saved in step 2 shows as a chip on the
  deal; a roofing deal's `/solar-proposal` redirects to `/presentation`.

## Risks

- **Deep links.** `#proposal` was an anchor only, with no nav referencing it —
  safe to repurpose for the status card.
- **Permissions.** The builder route repeats the deal page's
  `can(..., "Proposal")` guard rather than trusting the button's absence.
