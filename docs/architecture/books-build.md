# Books build — the QuickBooks replacement

This file is the source of truth for every phase of the Bookkeeping rebuild.
Read it before touching bookkeeping, payroll posting, bank or finance code. If a
decision here changes, change this file in the same PR.

Decided 2026-09-15.

---

## Goal

Replace QuickBooks completely for **Anexa Homes**. Anexa is the only company
(tenant) this is built for.

## Starting point: nothing to migrate

Anexa is a new company. It has **no QuickBooks history to import**, and
production holds **no real bookkeeping data** yet. So:

- the bookkeeping schema can be redesigned freely;
- there is no data migration and no QuickBooks import to write;
- today's models may be replaced rather than extended.

What exists on `main` today (d694e57), for orientation only. None of it is a
constraint:

| | today |
|---|---|
| `Transaction` (`transactions`) | Single-entry: one signed `amountCents` per row, a free-text `account` name, an optional category, `source` (manual / import / bank / quickbooks), an `externalId` dedup key. TAGGED vertical, via `projectId`. |
| `BookkeepingCategory` | A name and a free-text `type` (income / expense / asset / liability / equity). No numbers, no hierarchy. |
| `Reconciliation` | Keyed by the free-text account name. |
| `Invoice` | Per project, in cents, with a status enum. TAGGED, via `projectId`. |
| `BookkeepingVendor` | Vendors and 1099 flags, with an optional link to a user. |
| Payroll posting | `src/server/modules/payroll/post-bookkeeping.ts` writes one `Transaction` per payroll line, keyed `payroll:<runId>:item:<id>` / `payroll:<runId>:adj:<id>`. |
| Reports | `src/server/modules/bookkeeping/reports-db.ts` aggregates in the database. The P&L truncation fix is pinned by `__tests__/pnl-truncation.itest.ts`. |
| Bank connection | A provider picker (quickbooks / plaid / manual) and a key field in `bookkeeping/actions.ts`. Nothing pulls from a bank. |
| Encryption | `src/server/lib/crypto.ts`: AES-256-GCM, blob `iv:tag:ciphertext`, key = sha256 of the first env var set. The blob carries **no key version**. |
| Audit | `ActivityLog`: a message plus JSON metadata. |
| Access | The `Bookkeeping` subject is granted to `super_admin` and `accounting` in `src/server/rbac/matrix.ts`. There is no CPA role. |

## One set of books, split by vertical

- One legal entity, **one set of books**, one chart of accounts.
- Roofing and Solar are separated by the **`vertical` tag on every ledger
  line**, so each vertical has its own P&L, and the company P&L is their sum.
- The tag sits on the line, not the entry, so one entry can carry lines for
  both verticals.
- The general ledger is shared, as `docs/architecture/vertical-isolation.md`
  already says. Register every new ledger model in
  `src/server/vertical/models.ts` deliberately: a combined report must be able
  to read both verticals.

## Bank accounts

- **Two Truist checking accounts**: one for Roofing, one for Solar.
- Each bank account has a **default vertical**. A line from that account is
  tagged with it unless someone changes it.
- Money moving between Anexa's own accounts is a **transfer**. It is never
  income and never an expense, and its two sides must not be counted twice.
- More banks, **savings accounts** and **credit cards** must be addable later
  with **no code change**. An account is a row of data, not an enum branch.
  Credit cards are **liabilities**.

## Accounting model

- **True double-entry.** Every entry balances (debits = credits), and that is
  enforced in code and covered by tests.
- A **numbered chart of accounts**.
- **Period close and locking.** A locked period rejects any entry dated inside
  it, whether new or changed.

## Bank feeds

- Feeds come through an **aggregator, Plaid first**, behind a **provider
  interface**. Another aggregator can be added without touching the ledger.
- A **fixture provider** implements the same interface for tests and local
  development.
- On connect, pull the **maximum history: 24 months**.
- **CSV / QFX file import** runs through the **same pipeline** as a live feed:
  the same normalisation, dedup, matching and review.

## Reports

Everything a CPA expects from QuickBooks. The Phase 3 checklist starts from:

- P&L by vertical and combined
- balance sheet
- cash flow
- trial balance
- general ledger
- account register / transaction detail
- A/R and A/P aging
- reconciliation reports
- 1099 summary
- export of each of the above

## Invoices and bills

**Internal only.** The app never sends them to customers or vendors.

## Matching money to deals

- **Customer and insurance payments** are matched to deals **manually**.
- **Solar lender deposits:**
  - auto-detect the lender;
  - when there is **exactly one clear match**, auto-record the funded amount and
    date and mark **M1**;
  - otherwise, suggest matches and let the user split or confirm;
  - always record the **funding variance** (expected vs deposited).
- Marking M1 goes through the existing guards,
  `src/server/modules/pipeline/stage-guard.ts` and
  `src/server/modules/payroll/funding-authority.ts`, never around them.

## Money movement

Paying subcontractors and reps, and collecting money, is **required** and is
**built last**. It needs **MFA, approvals, limits and a full audit trail**.

## Who can see it

Bank and finance data is visible to **`super_admin` and `accounting` only**,
plus a future **read-only CPA role**. No other role sees it.

## Engineering rules

1. **Money is integer cents.** No floats, and no decimal dollars.
2. **Every financial change is audit-logged**: who, when, and before/after.
3. **Secrets are encrypted with versioned keys**, so a key can rotate without
   orphaning old ciphertext. Aggregator access tokens are secrets.
   `src/server/lib/crypto.ts` has no version in its blob. Read its header before
   changing it, because its key derivation is load-bearing for data already
   stored.
4. **Webhooks:**
   - verify the signature against the **raw body**;
   - **dedupe events** by their id;
   - return **2xx fast** and do the work afterwards.

   See `docs/runbooks/amos-inbound-callbacks.md`.

## Build order

| phase | scope |
|---|---|
| **1. Ledger foundation** | Chart of accounts, a double-entry journal, a vertical tag per line, bank and card accounts as data, periods and locking, audit. |
| **2. Bank feeds** | The provider interface, Plaid, the fixture provider, the 24-month backfill, CSV / QFX import on the same pipeline, transfer detection. |
| **3. CPA reports and close** | The report set above and the period-close workflow. |
| **4. Invoices, bills and matching** | Internal invoices and bills, manual deal payment matching, lender deposit detection, M1 and funding variance. |
| **5. Money movement** | Paying and collecting, with MFA, approvals, limits and audit. |

## Decisions settled before Phase 1 (2026-09-16)

These were the open questions. Each is now answered, and the answer is binding.

### Accounting basis — accrual, with a cash/accrual toggle on reports

The books are kept on **accrual**: an invoice posts A/R against revenue when it
is raised, a bill posts expense against A/P when it is entered, and that is what
the ledger stores. **Reports carry a cash/accrual toggle**; cash basis is a
presentation of the same journal, derived by following each A/R and A/P line to
the payment that settled it, never a second set of books.

### Fiscal year — January to December

Periods are calendar months, the fiscal year is **Jan 1 – Dec 31**, and year-end
close rolls net income into Retained Earnings.

### Chart of accounts — 4-digit, grouped by leading digit

| range | class |
|---|---|
| **1000–1999** | Assets |
| **2000–2999** | Liabilities |
| **3000–3999** | Equity |
| **4000–4999** | Income |
| **5000–5999** | Job costs / COGS |
| **6000–6999** | Operating expenses |
| **7000–7999** | Other income |
| **8000–8999** | Other expenses |

The number is data, not an enum. A new account is a row; nothing branches on a
specific number in code. The **leading digit decides the class**, and the class
decides the normal balance and which report the account lands on.

### Payroll and contractor pay onto the journal

An **approved** commission or contractor-pay line posts the expense immediately,
against a payable — it does not wait for the money to move:

| event | debit | credit |
|---|---|---|
| commission approved | Commissions (expense), tagged deal + vertical | Commissions Payable |
| contractor pay approved | Subcontractor Labor (expense), tagged deal + vertical | Payroll Payable |
| payment sent | the payable | the bank account |

The expense carries the **deal and the vertical**, so job profitability and the
departmental P&L both work; the payment does not, because a single cheque may
settle many deals.

**The per-line dedup keys are kept exactly as they are** —
`payroll:<runId>:item:<id>` and `payroll:<runId>:adj:<id>` from
`payroll/post-bookkeeping.ts`. They become the journal entry's
`(sourceType, sourceId)`, which is uniquely constrained, so re-posting a run
cannot double-book it. Keeping the existing spelling means already-posted runs
stay matched rather than posting a second time.

---

## Phase 1 — what was built, and the decisions taken while building it (2026-09-16)

### The shape

Six tables: `ledger_accounts`, `journal_entries`, `journal_lines`, `bank_accounts`,
`accounting_period_locks`, `finance_audit_events`. Four enums. One service —
`src/server/modules/books/posting.ts` — is the ONLY thing permitted to write the
ledger, and it enforces balance, the period lock, the duplicate guard and the
audit record in one place.

### Decisions taken during the build

**The vertical tag lives on `JournalLine`, not `JournalEntry`.** Registered
TAGGED with `projectId` as its provenance. One entry can then carry lines for
both departments — a single cheque paying a roofing sub and a solar sub — which
an entry-level tag could not express at all. Everything else (`LedgerAccount`,
`JournalEntry`, `BankAccount`, the audit tables) is SHARED: one legal entity,
one chart, one set of books.

**`debitCents` / `creditCents`, not one signed amount.** A debit and a credit
are different facts, not opposite signs of the same fact, and "balanced" has to
be expressible to be checkable. The single-entry `transactions` table could not
state the rule, so nothing enforced it.

**`projectId` and `vendorId` are real foreign keys.** Free text is how the old
ledger made "expenses by vendor" and the 1099 unanswerable: `Acme Roofing LLC`
and `Acme Roofing` were two payees, and renaming a vendor orphaned their
history — sometimes dropping a total below the $600 filing threshold, which
does not produce a wrong form, it produces no form.

**`JournalLine.account` cascades on delete.** Found by a test teardown failing on
`journal_lines_accountId_fkey`: the FK defaults to Restrict, so deleting a
company cascaded into `ledger_accounts` while lines still referenced them and
Postgres refused the whole delete. It would have failed the same way in
production. Accounts with postings are still never deleted — they are
deactivated, and the posting service refuses an inactive account.

**Voiding writes a reversing entry.** Nothing is ever deleted. The original stays
marked `void`, the two point at each other, and the pair nets to zero.

**Commissions seed at 6000 (operating), subcontractor labour at 5000 (job cost).**
Preserved from the existing payroll posting, where it was already right: a rep's
commission is paid out of the job's profit, so costing it to the job makes every
deal look worse the better it was sold.

**The fake bank connection is deleted** — `setBookkeepingConnectionAction`, the
dialog, and `CompanySettings.bookkeepingProvider` / `bookkeepingApiKey`. Nothing
ever read either value; no sync ran and no transaction was ever fetched, while
the page told the owner "Connected · plaid". Checked read-only against
production first: one `company_settings` row, both columns NULL, so the drop
destroys nothing.

**Encryption keys are versioned** — `v1.<keyId>:iv:tag:ct`, with `FINANCE_ENC_KEY`
preferred for new writes. Legacy 3-part blobs are tried against every configured
key, which reverses the old behaviour where introducing a higher-priority key
silently orphaned everything sealed under a lower-priority one.

### An operational note for future sessions

`globalSetup` runs `prisma migrate deploy` against the shared `vertical_test`
schema. **Never run two integration processes at once**: two concurrent
`migrate deploy` calls on that schema destroyed `_prisma_migrations` and several
tables, which then presents as P3005 and "table does not exist" in suites that
have nothing to do with the change being tested. Repair is to drop and recreate
`vertical_test` and deploy once, in a single process.

### Phase 1 closing decisions (2026-09-16)

**Payroll reaches the journal on TWO events, not one.** Approving a run accrues
it (expense against a payable, per line); marking it paid settles it (payables
down, bank down, one entry for the whole run because one transfer leaves the
account and the bank statement will show one line). The old ledger wrote a
single negative row at payment time, which meant an approved-but-unpaid run —
money genuinely owed — existed nowhere in the books.

**The bank account is resolved, never guessed.** `payPayrollRun` needs the
account the money left, and a payroll run has never carried one. It resolves to
the company's single active non-card account; where that is ambiguous or absent
the run is left **accrued but unsettled**, to be settled from the Books screen.
Guessing would understate one real balance and overstate another, and both read
as ordinary until a reconciliation fails months later. A payable still sitting
open is visible and explains itself. *Open question for the owner: whether to
put a designated payroll bank account on the company record instead.*

**The legacy ledger is dual-written, not cut over.** `postRunToBookkeeping` and
the `transactions` table still feed `/portal/bookkeeping`, so both are written
until that page moves onto the journal. Retiring the table is its own slice.

**The Books screen is new and additive** at `/portal/books` — chart of accounts,
journal register with drill-down, bank accounts and transfers, period close.
`/portal/bookkeeping` is untouched. The trial balance sits above every tab
rather than on one of them: it is the only figure on the page that checks the
ledger instead of describing it, and a disagreement there is a bug, not a
bookkeeping mistake.

**The inversion now pinned by test:** a rep's commission is an EXPENSE, a
subcontractor's invoice is a JOB COST. Both lines are deal-tagged, so the tag is
not what separates them — the account class is. Swap them and every job looks
worse the better it was sold, gross margin moves untraceably, and every
individual entry still balances perfectly. `payroll-posting.itest.ts` asserts
the account types directly, because nothing else catches it.

Gates at the end of Phase 1: tsc 0 errors; lint clean on the changed files;
unit 2497/2497; integration 72 files / 941 tests, 0 failures, 0 deadlocks
(baseline was 71 / 927).

## Phase 2 decisions — bank feeds (2026-09-16)

**Every provider sits behind `BankFeedProvider`, chosen by `BANK_FEED_PROVIDER`,
defaulting to the fixture.** A deployment with no bank credentials runs a
working feed against seeded data rather than crashing or half-working. Plaid is
imported lazily, because its client reads credentials in the constructor and
would otherwise make every test depend on Plaid configuration merely for being
in the import graph.

**The sign convention is the dangerous part.** Our interface is signed from the
account holder's view: negative means money left. Plaid reports the opposite for
depository accounts, so the adapter flips it in exactly one place. A flip books
every expense as income — nothing throws, nothing fails to balance, and the
review queue looks normal. The fixture carries both directions so a test fails
if it is ever wrong.

**The fixture is a real implementation, not a stub.** It pages with a cursor,
settles a pending row as a modification, and contains a genuine transfer pair
plus a same-merchant same-amount pair with distinct ids. A tidy stub would let
the cursor loop, the dedupe and the sign handling all be wrong while the suite
stayed green.

**Dedupe is on the provider's transaction id and nothing else.** Two purchases
at the same shop for the same amount on different days are two purchases;
matching on amount and merchant would quietly delete real spend.

**A connected account gets NO opening balance.** The provider's current balance
is what the bank thinks today, which already includes everything the feed is
about to deliver. Booking it as an opening balance and then ingesting the
history counts the same money twice.

**Evidence under a posted entry is immutable.** When the provider replays a
revised version of a transaction already booked, only its pending flag settles.
Rewriting the row would leave the books saying one number and the bank row
saying another, with nothing recording that they ever agreed.

**A retraction is a reversal.** If the bank takes back a transaction we posted,
the entry is voided by reversing entry — the same rule as every other void.

**The webhook records; the cron syncs.** The receiver verifies over the raw
bytes, dedupes on `(provider, eventId)`, writes one row and returns. Syncing
inline would put a multi-page network loop inside a delivery expected to be
acknowledged in seconds, and a slow 200 reads as a dead host. Missed deliveries
are never replayed by the provider, so the sweep has to be the guarantee
regardless — the webhook only makes the next sweep worth running sooner.

**Plaid webhooks are ES256 JWTs, not HMACs**, and Plaid sends no event id.
The dedupe key is derived from the body hash that verification has already
proven authentic.

**`syncConnection` accepts an injected provider.** A seam, not a convenience:
the retraction branch is the most consequential in the file and the fixture
never reports removals, so without injection it could only be tested by mocking
the module graph — which tests the mock. Production never passes it.

### A cross-tenant hole found in Phase 1's work, and closed

Worth recording because it corrects something Phase 1 got wrong, and because the
way it surfaced is the useful part.

`postJournalEntry` resolved **accounts** against the company and then wrote the
caller's `projectId` and `vendorId` straight onto the line. Both arrive from a
browser. A bookkeeper at one company could therefore cost a line to **another
company's job**, and nothing about the result would look wrong — it balances, it
posts, and the cost lands on a deal whose owner cannot see it.

It surfaced because the `row-scope-boundary` CI guard flagged
`acceptFeedTransactionAction`. The guard offers two remedies: scope the id, or
add an `ALLOWED` entry saying the id cannot cross a boundary there. The second
is one line and would have been accepted by review. It would also have been
false — and `postManualEntryAction` already carried exactly such an entry from
Phase 1, sitting on this same hole, so a second one would have compounded it.

Two fixes, because they answer different questions:

- **Tenancy, at the door.** `postJournalEntry` now verifies every `projectId`
  and `vendorId` belongs to the company, covering every caller present and
  future rather than the one action the guard happened to notice.
- **Per-viewer scope, at the action.** `acceptFeedTransactionAction` asks
  `projectAccessible`, because that question needs a user and there is one
  there.

The tenancy check runs **unscoped by vertical**. `Project` is SCOPED, so an
ordinary read would be filtered to the active workspace and would reject a valid
roofing job merely because the poster had solar open — and one entry may
legitimately carry lines for both departments, which is the entire reason the
tag sits on the line. The error never echoes the id, since whether a row exists
elsewhere is not something that message should confirm.

**The lesson to keep:** a CI guard firing on new code is worth reading as a
question about the existing code, not only as an obstacle to the new. The guard
was right, and it was right about something written a phase earlier.

---

## Not decided yet

These decisions leave some questions open. Settle each one before the phase that
needs it, and record the answer here.

The four questions this section opened with — accounting basis, fiscal year
start, chart numbering, and how payroll maps onto journal entries — were all
settled above under "Decisions settled before Phase 1" and have been built on
since. What remains genuinely open:

- **Which bank account payroll pays from.** Currently inferred when exactly one
  active non-card account exists (see Phase 1 closing decisions). A designated
  account on the company record would remove the inference. Owner's call.
- **When to retire the legacy `transactions` table** and move
  `/portal/bookkeeping` onto the journal. Needs a data migration for any rows
  written between now and then.
- **Plaid credentials and the ACH provider.** Both are owner decisions with
  costs attached; Phase 2 and Phase 5 build against a fixture provider behind an
  env-selected interface so neither blocks the work.
- **What exactly `accountant_readonly` may export.** Read-only is settled; the
  export surface is not, and it interacts with the row-scope boundary note on
  `postManualEntryAction`.
