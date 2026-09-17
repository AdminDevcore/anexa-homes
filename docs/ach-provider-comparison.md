# Paying money out: choosing an ACH provider

**Status:** a recommendation for the owner, not a decision taken in code.
**Nothing is blocked on it.** Phase 5 builds against `AchProvider`, an interface
selected by `ACH_PROVIDER`, with a fixture implementation used by every test —
the same shape `BANK_FEED_PROVIDER` already uses for Plaid. Choosing a provider
later is a matter of writing one adapter and setting one environment variable.

**On the figures below:** provider pricing and programme terms change often, and
anything quoted from memory would read authoritatively and might simply be
wrong. So this compares the things that actually drive the code and the risk —
who holds the money, who holds the compliance obligation, how returns and
approvals work — and marks every commercial term as something to confirm in
writing at signup. Ask each provider for current pricing and minimums directly.

---

## What this company actually needs

Worth being concrete, because it rules several options out immediately.

1. **Pay vendors and subcontractors** — a few dozen payments a month, ranging
   from a few hundred dollars to tens of thousands. This is ACH *credit*
   origination: we push money out.
2. **No customer collection.** Homeowners pay by cheque, card or lender wire,
   and [no-customer-portal] applies — homeowners never log in here. We do not
   need ACH debit/pull, which is where most of the fraud and dispute risk lives.
3. **Payments must land in the ledger as journal entries**, not just in a
   dashboard. Every movement is already double-entry with an audit record.
4. **A returned payment must be recoverable.** ACH returns arrive days later
   (insufficient funds, closed account, wrong number). The books have to reverse
   cleanly when they do — which is a webhook and a reversing entry, not a
   deletion.
5. **Two people, not one.** Phase 5 requires maker-checker on money movement.
   Whether the provider also enforces approvals is a bonus; we cannot rely on it,
   because the control must hold for payments originated by our own code.

## What we are NOT buying

- **A payroll rail.** Employee pay is already handled and is not in scope here.
- **Card issuing, spend management, or a new operating bank.** Several vendors
  below will try to sell all three. Switching the company's bank account is a far
  larger decision than choosing an ACH API and should not be smuggled in with it.
- **An AP SaaS product** (Bill.com and similar). These are good products, but
  they are a *destination* — the work happens in their UI, and the books here
  would be a copy of their state. That is the opposite of the direction this
  whole module is going.

---

## The candidates

### Plaid Transfer — recommended first choice

Plaid is already being adopted for bank feeds (Phase 2), so the owner is already
signing that contract, completing that diligence, and linking accounts through
that flow. Transfer originates ACH against those same linked accounts.

- **Why it wins on architecture:** one vendor relationship, one set of
  credentials, one support channel, and the account a payment leaves is an
  account already linked and verified for the feed. Balance checks before
  sending come from the same integration.
- **Why it wins operationally:** the owner has one onboarding to complete, not
  two. Realistically this matters more than a few cents per transfer at this
  volume.
- **The catch:** Transfer is a separate product with its own approval and risk
  review; being approved for Plaid's data products does **not** mean being
  approved to move money. Confirm eligibility *before* treating this as settled.
- **Also confirm:** per-transfer pricing, monthly minimums, whether same-day ACH
  is included, the return-handling model, and funding/settlement timing.

### Dwolla — recommended alternative

Purpose-built, white-label ACH origination with a long track record for exactly
this use case: a business paying a list of vendors on a schedule.

- Straightforward mental model, good documentation, webhooks designed around ACH
  lifecycle events including returns — which is most of what our adapter cares
  about.
- Mature handling of the boring, important parts: return codes,
  micro-deposit verification, balance-held vs pass-through models.
- **Take this one if Plaid Transfer is refused or priced badly**, and it is the
  safer pick if we ever need to originate on behalf of others.

### Increase / Column — strong, if the owner wants the bank to be the API

Both are API-first with a bank charter behind them (Column is itself a chartered
bank; Increase is developer-first banking infrastructure). Excellent engineering,
very direct access to the rails, typically better economics at volume.

- **Why not first:** taking full advantage means moving banking relationships,
  which is a business decision far bigger than this module. Adopting one purely
  as a payment rail while banking elsewhere is possible but gives up much of the
  benefit.
- Revisit if the company outgrows the recommendation above or wants to
  consolidate banking and payments deliberately.

### Modern Treasury — over-specified for this scale

Payment operations on top of *your own* bank, with genuinely excellent
reconciliation and approval workflows — several of which overlap what Phase 5
builds here.

- **Why not:** it is aimed at companies running far higher payment volume, and
  is priced accordingly. At a few dozen payments a month the platform fee buys
  capability this business will not use, and it still requires a bank
  relationship that supports it.
- Worth remembering as the answer if payment volume grows by an order of
  magnitude.

### Stripe — the wrong shape here

Stripe is superb at taking money *in* from customers. Paying arbitrary vendors
out means Treasury/Connect constructs designed around platforms paying their own
sellers, which is not what this is. Using it would mean modelling vendors as
something they are not.

---

## Recommendation

1. **Ask Plaid about Transfer eligibility while signing up for bank feeds.** One
   vendor, one onboarding, one set of linked accounts. If approved on reasonable
   terms, take it.
2. **If Transfer is refused or priced badly, use Dwolla.** It is purpose-built
   for this and nothing in our design would change.
3. **Do not change banks for this.** If consolidating banking and payments
   becomes attractive later, look at Increase or Column then, deliberately.

## What the owner must actually do

- Ask Plaid, during bank-feed signup, whether this account can be approved for
  Transfer, and get pricing in writing.
- If not, open a Dwolla sandbox account and get their pricing in writing.
- Decide who the second approver is. Maker-checker needs two real people with
  finance access; if only one person is ever going to approve payments, say so
  now, because that changes the control rather than silently defeating it.

## What the code does until then

`ACH_PROVIDER` defaults to `fixture`, exactly as `BANK_FEED_PROVIDER` does. The
fixture moves no money, behaves deterministically, and every test runs against
it. A real provider is one adapter implementing `AchProvider` plus one
environment variable — and because the fixture is what the tests use, adding
that adapter cannot quietly change the behaviour the tests pin.

This is deliberate: **an unmade commercial decision must never be a blocked
engineering decision.** The same approach let Phase 2 ship a complete bank-feed
module before anyone had Plaid credentials.
