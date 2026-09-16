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

## Not decided yet

These decisions leave some questions open. Settle each one before the phase that
needs it, and record the answer here.

- **Accounting basis** for reports: cash, accrual, or both. This is needed by
  Phase 3, and by Phase 1 if invoices and bills post to A/R and A/P.
- **Fiscal year start.** Needed by Phase 1 for periods.
- **Chart of accounts numbering scheme** and the starting accounts. Needed by
  Phase 1.
- **How payroll posting maps onto journal entries**, including the per-line
  `externalId` keys. Needed by Phase 1.
