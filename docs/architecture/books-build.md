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

**Run in a schema of your own instead — the config already supports it.** That
warning is not enough, because you cannot stop another session from starting.
`global-setup.ts` reads `VERTICAL_TEST_DATABASE_URL` and falls back to
`vertical_test`, and `vitest.integration.config.ts` feeds the same constant into
`env.DATABASE_URL`, so the app client follows it too. No code change is needed:

```bash
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -c 'CREATE SCHEMA IF NOT EXISTS vertical_books;'
export VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_books"
pnpm exec vitest run --config vitest.integration.config.ts
```

**A second presentation of the same contention, seen during Phase 3.** The suite
came back 202 failed across 16 files, every one a `40P01 deadlock detected`,
in suites the change could not reach (`payroll-ledger`, `pricing-stage1`,
`review`). The tell is in the deadlock detail: *"waits for RowShareLock … blocked
by … waits for AccessExclusiveLock"*. `RowShareLock` is an ordinary foreign-key
read; **`AccessExclusiveLock` is a DDL lock** — CREATE / ALTER / DROP / TRUNCATE
— and ordinary test code never takes one. Its presence is proof that something
outside the suite was changing the schema mid-run. The identical commit then
passed **981/981 with zero deadlocks** on a private schema. Before debugging
application code, check `select nspname from pg_namespace` for other sessions'
schemas; `pg_stat_activity` shows only the current instant, so an empty result
there does not mean nothing ran during the test run.

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

### Bank rules

**A rule suggests; it posts only if asked.** `autoPost` is off by default. A
wrong rule that suggests is a wrong suggestion; a wrong rule that posts has
already written to the books, and undoing it means a reversing entry for every
row it touched.

**Suggestions are computed on read, never stored.** There is deliberately no
`suggestedRuleId` column — a stored suggestion goes stale the moment the rule is
edited, and the queue would then show a category no rule would produce.

**Direction is matched on the sign**, which stops a `money_out` rule for "SHELL"
catching a refund *from* Shell and booking a credit as fuel expense. Amount
bounds compare the absolute value, so "under fifty" means what a person means.

**Rule order is total** — priority, then `createdAt`, then `id`. Priority alone
leaves equal-priority rules applying in whatever order the database returns, so
the same row categorises differently between runs and neither result looks wrong.

**A failed auto-post leaves the row in the queue.** Marking it otherwise would
make an unhandled transaction look handled.

**A rule applies the whole amount.** A split is a judgement about one particular
row, which is precisely what a standing instruction cannot make.

### A flaky test in the pipeline suite, diagnosed and fixed

`stage-history.itest.ts` — "never writes a span that closes before it opened" —
failed once during Phase 2 and passed on a re-run. Worth recording because
"re-run it and it passed" is how a real intermittent bug gets ignored.

It was not pollution from the new fixtures: `events()` filters by `leadId`, so
no other suite can reach it. The cause is a tie created by *the very clamp the
test verifies*. `recordStageEntry` clamps a backdated write forward, so entering
at day(2) against a span opened at day(10) leaves the closed span's `exitedAt`
and the new span's `enteredAt` both at day(10). `events()` orders by
`enteredAt` alone; the rows tie; Postgres may return either first. When the
still-open span won, `rows[0].exitedAt` was null and the test died on a
TypeError — intermittently, and only under full-suite timing.

Fixed by asserting the property across every closed span rather than `rows[0]`.
The property was never about the first row.

This is the same class as the `generalLedger` ordering bug fixed in Phase 1,
where a reversal shares its original's date and needed a `createdAt` tiebreak.
**Any `orderBy` whose key can tie is a non-deterministic read**, and in a test it
surfaces as a flake rather than as a wrong number — which is luckier than it
deserves.

### What Phase 2 shipped

Provider interface with a real fixture bank and a Plaid adapter; connections,
feed rows and webhook receipts in the schema; cursor-paged ingest with a cron
sweep; a webhook that verifies and records; the review queue (add, split, match,
transfer, exclude, undo); transfer-pair suggestion; user-defined rules; CSV and
OFX/QFX import; and the Banking screen at `/portal/banking`.

Gates at the end of Phase 2: tsc 0 errors; lint clean on the changed files;
unit 168 files / 2527 tests; integration 75 files / 981 tests, 0 failures,
0 deadlocks (Phase 1 closed at 72 / 941).

**The one thing that does NOT work end to end, and why.** Connecting a real bank
needs Plaid's Link widget, which takes the customer's banking credentials in a
browser context we never see and hands back a public token. Loading it requires
live Plaid credentials, so the Connect button stops at the token and says so
rather than appearing to work. Everything behind that point — exchange,
encryption, account mapping, sync, webhook verification — is built and tested
against the fixture, and `docs/plaid-security-answers.md` lists what the owner
must supply. **File import needs none of this** and is a complete path into the
books today.

## Phase 3 decisions — the CPA role, and what `Report` actually means (2026-09-16)

**`Report` is not the financial-statements permission, and granting it to the
outside CPA was a real hole.** The role shipped with
`Report: ["read", "export"]` on the reasonable-sounding grounds that an
accountant needs reports. But `Report` is the gate on the reports HUB, and the
hub is mostly the sales floor: Funnel, Lead Sources, Canvassing, Rep Scorecard,
Delinquency, Claims, A/R Aging, Production. Customer names, addresses, per-rep
performance — the exact exposure that refusing `Project: ["read"]` was meant to
prevent, re-opened by a side door.

Hiding the hub cards would not have closed it. **Every report page gates itself
on `can(user, "read", "Report")` independently** — ten pages and twenty
export/PDF routes — so the URLs stay openable with an empty hub, and each one is
a place a future page can forget. Withholding the resource denies all of them at
once, including routes nobody has written yet. The statements an accountant
actually needs are bookkeeping artifacts and already live under `Bookkeeping`,
which the role keeps; `/portal/books`, `/portal/banking` and
`/portal/bookkeeping` all gate on that, so the role still reaches everything it
exists for.

Two further guards, because the resource gate rests on an assumption:

- `allowedReportTypes` seeds EVERY role with `"operations"`. That was harmless
  only because a role without a `Report` grant never got past the gate — an
  assumption, not a guarantee. The CPA is now excluded explicitly as well.
- `getScopeOptions` treated anything that was not a rep, canvasser or manager as
  "finance / leadership" and offered **every rep and every manager by name** — a
  staff roster — while `resolveScope` would then honour a hand-typed `rep:` or
  `team:` value from the query string. Both now pin the CPA to company totals.

**The dashboard now enforces what the sidebar always claimed.** `PORTAL_NAV`
gates the Dashboard item on `Project:read`; the page itself checked nothing. That
cost nothing while every role held that grant. `accountant_readonly` is the first
that does not — and is the role every books and reports denial redirects *to*.
`listScope` already denied it leads and projects outright
(`{ ...base, id: "__none__" }`, policies.ts:116 and :140), so no customer name
was ever exposed; the page simply answered "you may not open that" with a screen
of zeros. It now sends them to the books instead.

**How this was found, because the method mattered more than the fix.** The
ratchet test was written first, asserting the intended behaviour, and run
expecting red. It also corrected a wrong reading of my own: `admin` holds no
`Report` grant at all and sees only the `jobs` card, gated on `Commission`.
There had been **no test anywhere** pinning who sees which report card, which is
why granting one role one resource could quietly widen eight reports. The card
list is now asserted as an exact list, so adding a card fails
`cpa-report-visibility.test.ts` until somebody decides whether the CPA gets it.

A prior session had already anticipated the constraint from the other side:
`row-scope-boundary.test.ts` permits `postManualEntryAction` to take an
unchecked `projectId` and notes *"IF `accountant_readonly` (Phase 3) IS EVER
GRANTED `Bookkeeping:create`, this entry stops being true — that role exists to
change nothing, so it must hold read/export only."* The grant is read/export
only, so that entry still holds.

### The statements, and what Phase 3 shipped

Four statements at `/portal/books/statements/<slug>` — trial balance, profit and
loss, balance sheet, general ledger — each with a CSV and a PDF route, all gated
on `Bookkeeping`.

**Cents, and why the house formatter could not be reused.** `makeMoney` uses
`maximumFractionDigits: 0` and every `usd()` in the reports modules is
`Math.round(cents / 100)`. That is right for a sales funnel and wrong for a
trial balance, whose entire purpose is that debits equal credits EXACTLY.
Rounded to dollars, a ledger that balances can print as though it does not —
and one that is out by a few cents can print as though it does. `money()` in
`statements.ts` is cent-exact and never divides, so no floating-point error can
reach the page.

**Cash basis is a derivation, and its limit is stated.** An entry counts when it
touched a cash account (subtype `bank` or `undeposited_funds`). A credit card is
deliberately NOT cash — paying by card is borrowing, not spending money you
have. The known limit: an entry that both settles an old payable and books a new
expense lands whole in the pay period, because the ENTRY is the unit. Keeping a
second ledger would be exact, and would also mean two things to keep in
agreement.

**Basis applies to the P&L only.** A cash-basis balance sheet is not well
defined: drop the receivables and payables the cash basis excludes and it stops
balancing, which is the one property a balance sheet has. The trial balance
takes no basis argument at all, so a caller cannot ask for something
meaningless.

**One reading of the request.** The reports under `/portal/reports` each parse
their parameters three times — page, export route, pdf route. With one `scope`
that is harmless duplication; a statement carries five (basis, comparison,
department, period, account), and three hand-kept copies guarantee the CSV will
eventually disagree with the screen. `statement-request.ts` resolves once, and
`buildStatement` is the only way to turn a request into a report, so the export
matches by construction rather than by care. It also normalises empty
parameters, after they diverged: a page's `searchParams` omits an unset key
while `URLSearchParams.get` returns `""`, so the same URL gave `preset: "ytd"`
on the page and `""` in the route — and preset feeds the download link.

**The year-end close is an entry, not a flag.** A real balanced journal entry
dated 31 December, idempotent on `("year_end_close", "close:<year>")`. So it
appears in the register and in each account's ledger, and it is undone by
reversal like anything else; a boolean on the company would have let the ledger
and the "closed" state disagree. Closing **leaves total equity exactly where it
was** — the balance sheet already reports current-year profit as its own equity
line, so the close moves a figure between equity lines. If total equity moves
when a year is closed, the close is double-counting, and the test asserts that
directly. Balances are not assumed positive: an income account can end a year
negative (more refunded than sold), which is how a naive close posts a negative
debit and is rejected.

Gates at the end of Phase 3: tsc 0 errors; lint 0 errors on the changed files
(53 pre-existing errors elsewhere, unchanged from `main`); unit 170 files /
2545 tests; integration 77 files / **1005** tests, 0 failures, 0 deadlocks
(Phase 2 closed at 75 / 981).

### XLSX — NOT shipped, and why not

The brief asked for CSV, XLSX and PDF. CSV and PDF are done. XLSX is not, and
the reason is worth recording rather than leaving as a gap.

There is no zip library in this repo (`pdf-lib` and `pdfjs-dist` only), and an
`.xlsx` is a zip of XML parts. But that is the smaller obstacle. The real one is
that `RenderableReport` rows are **formatted display strings** — the convention
every existing report follows, and what `RenderableReportView` prints verbatim.
An XLSX built on that would be a spreadsheet full of text, no more useful than
the CSV, while looking like it had solved the problem.

Doing it honestly needs one of:

1. a numeric channel through `ReportTable` (e.g. a parallel `values` array of
   raw cents) plus a small hand-written zip writer — no dependency, perhaps
   150 lines, and it changes a type shared by every report; or
2. a dependency (`exceljs`), which is a real addition to the bundle and to the
   supply chain, for one export format.

**Recommendation: (1), as its own slice, after Phases 4 and 5.** The statements
are usable today through CSV and PDF, and a CPA who wants to compute in a
spreadsheet can open the CSV. Shipping a text-only `.xlsx` would be worse than
shipping none.

---

## Phase 4 decisions — invoices, bills and lender funding (2026-09-16)

Phase 4 is the money the company is owed and owes: what we billed a customer,
what a vendor billed us, and what a lender still has to wire. Three modules
(`invoices.ts`, `bills.ts`, `funding.ts`), one shared helper (`aging.ts`), and
one defect found while building them that was older and wider than this phase.

### `Invoice.issuedAt` — a new column, because `createdAt` would not do

An invoice is revenue on the day it was ISSUED. `Invoice` had `createdAt`,
`dueAt` and `paidAt` but no issue date, and `reports/ar-aging.ts` was already
papering over the gap with `dueAt ?? createdAt`.

Prisma does let you set a `@default(now())` field explicitly, so `createdAt`
could technically have been pressed into service. It was not, because row
creation time and invoice date are different facts: an invoice for January
entered in February is January revenue, and dating it by when somebody typed it
in moves income into the wrong period and shifts two trial balances at once.

The migration is one `ADD COLUMN` plus `UPDATE invoices SET issuedAt =
createdAt`. The backfill writes to a column that did not exist one statement
earlier, so it cannot overwrite anything anybody entered. Re-diff reports an
empty migration.

### The money field keeps its name

`Invoice.amount` was NOT renamed to `amountCents`, despite the rest of the books
using that name. `bookkeeping/queries.ts` already normalises it at the boundary
(`amountCents: iv.amount` when building `BkInvoice`), which is a deliberate
existing convention. `invoices.ts` follows it: the column stays `amount`, every
books-facing type says `amountCents`. A Prisma rename emits DROP + ADD and loses
data; `@map` would have avoided that, but churning a column to win consistency
the boundary layer already provides is not worth any migration risk.

### Revenue follows the job's department, never the reader's workspace

Revenue is split (`roofing_revenue`, `solar_revenue`). The credit account is
derived from `Project.vertical`, which is non-null, on an invoice whose
`projectId` is required — so there is always an answer. A vertical with no
revenue account configured is an ERROR, not a guess, because quietly booking
solar revenue as roofing yields a P&L that splits wrongly and reconciles
perfectly. An explicit account or system key from the caller still wins.

### The receivables schedule exists twice, on purpose

`reports/ar-aging.ts` (whole dollars, gated on `Report`) is the sales-floor
view and is deliberately untouched. `invoices.ts#arAging` (cent-exact, gated on
`Bookkeeping`) is the accountant's. They are not duplicates: Phase 3 removed
`Report` from `accountant_readonly` precisely so an outside CPA cannot reach the
sales pipeline, and a CPA who cannot see who owes the company money is useless.
Only the bucket arithmetic is shared, via `aging.ts`, so A/R and A/P can never
disagree about where "31–60" ends.

### SHARED vs TAGGED for the new models

`Bill` is TAGGED with `projectId` provenance — a bill is departmental spend for
the same reason an invoice is. `LenderFunding` is deliberately ABSENT from
`TAGGED_PROVENANCE`: it hangs off a LEAD, not a job, and that lookup resolves
project ids, so registering `leadId` would resolve nothing while appearing
configured. Its `vertical` column is non-null with a solar default instead.

### The defect: a ledger line's department, which nothing was setting

Found while testing invoice tagging; it predates this phase and reached
everything that posts.

`schema.prisma` promises "every line is tagged so the P&L breaks out by
department", and `reports.ts` filters the LINE by `vertical` — that filter is
what makes a departmental P&L possible. The tag was never being set.

Two individually correct decisions produced it, and the gap is only visible
holding both at once:

1. `postJournalEntry` creates lines NESTED, as `lines: { create: [...] }` under
   `journalEntry.create`.
2. The vertical extension therefore sees a **JournalEntry** write. JournalEntry
   is deliberately not tagged, because one entry may legitimately span
   departments, so `classify()` returns `"shared"` and the extension returns at
   its first branch — never inspecting the nested line rows.

So `JournalLine`'s TAGGED `projectId` provenance never fired on the posting
path, and a line's department was only ever whatever the caller passed. No
caller passed one. A vendor bill entered against a solar job was written with no
department, vanished from the solar P&L, and still appeared in the company
totals. Every report balanced, so nothing could look wrong. The test that
proves it reads `expected +0 to be 125000`.

There is a second, related trap: a TAGGED row created with NO ambient workspace
is also written untagged, because `resolveVertical()` returns unscoped and the
extension returns before provenance resolution. The books normally run with no
workspace at all, so this is their default state, not an edge case.

**Fixed at the door rather than at each caller.** `postJournalEntry` is the only
way into the ledger, and `resolveReferences` already reads these very jobs to
check they belong to the company; adding `vertical` to that existing `select`
resolves every line's department in the same query, at no extra round trip, for
every caller present and future. Precedence follows the extension's own
documented rule minus ambient: explicit wins, then the line's job, then nothing
(a bank fee, office rent and a transfer between our own accounts belong to no
department). **Ambient is deliberately not a fallback** — stamping whichever
workspace the reader happened to have toggled is exactly how a solar cost lands
in roofing. `createBill` and `createInvoice` tag their own rows from the job for
the same reason.

Seven integration tests, written first and watched to fail 4/7 with the
predicted signature. No existing test regressed, which is itself evidence that
nothing had been relying on lines being untagged.

### What Phase 4 shipped

- `books/invoices.ts` — issue, post to A/R, collect, void, cent-exact A/R aging.
- `books/bills.ts` — enter, accrue, pay, void, A/P aging.
- `books/funding.ts` — expected lender funding per milestone, recognition, and
  variance routed to Dealer Fees or Funding Variance by lender configuration.
- `books/aging.ts` — the shared bucket definition.
- Two migrations, both additive, both proven by re-diff: bills + lender funding,
  and `invoice_issued_at`.
- 60 new integration tests (30 invoices, 23 funding, 7 department). Full suite
  1084 passed, up from a 981 baseline at the start of Phase 3.

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
- ~~**What exactly `accountant_readonly` may export.**~~ **Settled 2026-09-16**
  (commit `cd40a20`): `Bookkeeping` and `Report`, `read` + `export`, and nothing
  else. Export is included deliberately — a year-end handover is a set of files,
  not a screen share. `Payroll` and `ContractorInvoice` are deliberately
  excluded: they name individual people and what they were paid, and the reports
  already carry the totals an accountant needs. `Project: ["read"]` was refused
  for the same reason — it would hand an outside party the whole pipeline, with
  customer names and addresses, to answer questions the reports already answer.
  `create` is withheld partly because the role is read-only and partly because
  `row-scope-boundary.test.ts` permits `postManualEntryAction` to take a
  `projectId` unchecked *on the stated grounds that everyone holding
  `Bookkeeping:create` sees every job in the company*; granting create here would
  have made that entry quietly false. Assignment is super-admin-only.
