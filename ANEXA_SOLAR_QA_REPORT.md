# Anexa Solar Portal QA Report

**Audit date:** 2026-09-13
**Auditor:** read-only QA pass — no application code was modified.
**Baseline audited:** `origin/main` @ `7852569` (the deployable branch), cross-checked against the local working tree on `feat/solar-commission-payroll`.
**Environment:** local Postgres `127.0.0.1:5544` (seeded demo data, 1 company, 22 leads / 11 solar), own dev server on `:3411` with an isolated dist dir.

---

> ## ⚑ FIX PASS — 2026-09-14
>
> The P0 and P1 findings below have been worked. **Nothing in this report has
> been deleted or reworded**; each fixed issue carries a `**STATUS**` block
> underneath it naming the commit, the files and the tests.
>
> - Branch `qa/solar-p0p1-fixes`, based on `origin/main` @ `c83ddce`.
> - 11 commits, 46 files, 119 new tests. Not pushed, not merged, not deployed.
> - Full detail: **ANEXA_SOLAR_QA_FIX_SUMMARY.md**. Working log:
>   **ANEXA_SOLAR_QA_FIX_PROGRESS.md**.
> - §35 and §36, reported below as *not tested*, are now **done** — see the
>   summary. Their result is recorded at the bottom of this file too.

---

## How to read this report

Two things about the audit conditions matter for every finding below, so they are stated once here.

**1. The working tree was being edited by other sessions throughout.** This repository is shared by concurrent Claude sessions. During the audit, `origin/main` advanced by 8 commits (including a merged PR, `#30 fix/authz-boundaries`), and files were added and deleted under me. **Every finding in this report was therefore re-verified against `origin/main` before being written down**, and each one says which branch it was confirmed on. Findings that exist only in the uncommitted working tree are labelled as such and are *not* counted as production defects.

This mattered: my first pass, reading a stale local `HEAD`, concluded that the entire solar server-action surface was missing row-level authorisation. Re-checking against `origin/main` showed PR #30 had already closed it. That finding is now in **Verified Working**, not in Critical.

**2. Dynamic UI testing was cut short.** Roughly two-thirds of the way through, a sibling session deleted `src/components/portal/solar-system-info.tsx` while `src/app/portal/leads/[id]/page.tsx` still imported it. Turbopack fails the whole compilation on that, so from that point every route on my dev server returned HTTP 500 — deal pages, report exports, cron endpoints, all of them. This is **not a product defect**; it is a transient artefact of somebody else's in-flight refactor. Where I could not finish a live test because of it, the report says so rather than guessing. Everything already captured before that point stands, and everything after it was verified from source, from the database, or by executing the pure functions directly.

Where a section of your test matrix describes a capability the system does not have, that is called out under **Scope Gaps** rather than filed as a bug.

---

## Executive Summary

**Overall health: good, with a specific and serious weak spot.**

This is an unusually disciplined codebase. The financial core — pricing ladder, dealer-fee arithmetic, lender caps, redline and flat compensation, company-lead splits, manager overrides, loan amortisation — is **pure, well-factored, heavily commented and correct**. I re-derived 27 money figures independently from your stated business rules and compared them against what the application computes. **All 27 matched to the cent**, including your two worked examples (the 40% company-lead take, and the 2×$5,000 battery sold at $30,000). The payroll ledger, chargeback, and adjustment logic is among the better-tested code I have reviewed: 2,129 unit and integration tests across 183 files, plus 66 Playwright specs.

Row-level authorisation, which was genuinely broken, was fixed and merged during this audit.

The weak spot is not arithmetic. **It is that almost nothing downstream of the proposal reads the numbers the proposal computes.** Three separate caches of "what this deal is worth" exist — `SolarFinance.contractPriceCents`, `Lead.value`, and `Project.contractValue` — they are written at different moments by different code, and they disagree. On the one fully-priced solar deal in the database they disagree by **$44,000, $30,695 and $39,200 for a deal whose live contract price is $74,695**. Every revenue report, dashboard KPI and rep scorecard reads the stalest of the three.

The second theme is **financial controls, as distinct from financial arithmetic**. The maths cannot be tricked; the *workflow around it* can. A sales rep can move their own deal to the "M1 Funding" stage and tick the rep-commission milestone as paid — and those two facts together are the entire gate that makes a deal commission-eligible. Nothing locks a deal's price after the customer signs it. Payroll adjustments never reach the general ledger, so the books cannot be reconciled against the bank.

**Nothing here suggests money has been paid incorrectly.** The compensation *rates* are properly frozen at signature and cannot be retroactively changed — that part is airtight, and I confirmed it. What is missing is the segregation of duties around the gate, and the consistency of the figures that management reports read.

### Counts

| Severity | Count |
|---|---|
| P0 — Critical | 3 |
| P1 — High | 8 |
| P2 — Medium | 11 |
| P3 — Low | 7 |
| Scope gaps (requested, not built) | 5 |

---

## Critical — P0

### P0-1 · Solar revenue is understated in every report, dashboard and scorecard

**Issue.** All revenue reporting reads `Project.contractValue`. On a solar deal that column holds the **after-tax-credit net**, snapshotted once when the Project row was created, and never updated again. It is not the contract price, and it does not follow the proposal.

**Exact location.**
- `src/server/modules/projects/actions.ts:521` — `contractValue: lead.claimPrice ?? lead.value` (the only write; one-time, at Project creation)
- `src/lib/solar-deal-value.ts:78` — `if (src.netAfterCreditsCents != null) return { kind: "total", cents: src.netAfterCreditsCents }` (what `Lead.value` becomes on solar)
- `src/server/modules/solar/deal-value.ts:26` — `restampLeadValue` updates `Lead.value` but **never** `Project.contractValue`
- Readers: `src/server/modules/reports/rep-scorecard.ts:65`, `src/server/modules/reports/queries.ts:218,229`, `src/server/modules/reports/lead-sources.ts:41`, `src/server/modules/reports/builders.ts:289,305,310`, `src/server/modules/dashboard/queries.ts:94`, `src/server/modules/dashboard/team-performance.ts:147`

**Steps to reproduce.**
1. Open the only fully-priced solar deal in the seeded database, "Elena Vasquez" (`5eb8fef0-d2f3-4952-9cd1-e1248a95b337`).
2. Query the three stores:
   ```sql
   SELECT p."contractValue", l.value, f."contractPriceCents"
   FROM projects p JOIN leads l ON l.id = p."leadId"
   LEFT JOIN solar_finance f ON f."leadId" = l.id
   WHERE l."firstName" = 'Elena';
   ```
3. Run the Rep Scorecard for the period containing that deal.

**Expected.** Revenue reflects the $56,000 contract the customer signed.

**Actual.** `Project.contractValue = 3920000` ($39,200) — exactly `$56,000 × 0.70`, the contract less the 30% ITC. The scorecard reports $39,200. Ten of the eleven solar leads have no `Project` row at all and contribute **$0**.

**Business impact.** Solar revenue in management reporting is understated by the full value of the federal credit — 30% on a base-ITC deal, up to 50% where the energy-community and domestic-content bonuses are claimed. Any commission plan, forecast, board pack or bank submission built on these reports is wrong by that margin. Because the understatement is a clean multiple it looks plausible, which is why it has not been caught.

**Root cause.** Two decisions that are individually defensible and jointly wrong. `Lead.value` was deliberately redefined for solar as the household's net after credits (documented at length in `src/lib/solar-deal-value.ts` — the reasoning is sound for a *pipeline card*). `Project.contractValue` then copies `lead.value` at creation, and the reporting layer, written for roofing, treats `Project.contractValue` as "the contract". Nobody re-pointed the reports.

**Recommended fix.** Give the reports a solar-aware revenue resolver rather than re-pointing `Project.contractValue` (which roofing legitimately owns). Add `contractValueCents` to the sale-line resolver in `src/server/modules/pipeline/sale-line.ts` so a solar deal resolves through `resolveReportedSystem` to the approved proposal's `contractPriceCents`, and have `rep-scorecard.ts`, `reports/queries.ts`, `reports/builders.ts` and `dashboard/queries.ts` call it. Keep `Lead.value` as the net — it is right for the pipeline card and the customer conversation.

> **STATUS: FIXED** — `db977e8`
>
> Fixed at the denormalisation rather than in seven report queries, which is
> both smaller and repairs every surface at once. `restampLeadValue` already
> re-reads the reported proposal at the three moments the answer can move; it
> now stamps the contract onto `Project.contractValue` alongside the net onto
> `Lead.value`, and `ensureProjectForLeadAction` calls it right after creating
> a solar job. The two answers are now distinct rather than one overwriting
> the other.
>
> The second half — a deal is sold before it has a job — is
> `solarContractByLead`, used by the rep scorecard and lead-source ROI.
>
> Files: `src/lib/solar-deal-value.ts`, `src/server/modules/solar/deal-value.ts`,
> `src/server/modules/projects/actions.ts`,
> `src/server/modules/reports/solar-contract.ts` (new),
> `reports/rep-scorecard.ts`, `reports/lead-sources.ts`,
> `scripts/backfill-solar-deal-value.ts`.
>
> Tests: 6 unit + 11 integration. **Verified live**: the seeded dashboard's
> Team Performance moved from `$39.2K` to `$56K` after the backfill, with
> `Lead.value` correctly still `$39,200`.

---

### P0-2 · A sales rep can single-handedly satisfy the entire M1 commission gate on their own deal

**Issue.** Commission generation for a solar deal requires exactly two conditions. A `sales_rep` can set both of them, on their own deal, with no second person involved.

**Exact location.**
- Gate definition: `src/server/modules/payroll/actions.ts:58-70` — requires (a) the lead's stage at or past M1 Funding, and (b) `SolarMilestone(payee: "rep", sequence: 1).paidAt IS NOT NULL`
- Condition (a) is settable by the rep: `src/server/modules/leads/actions.ts` → `moveLeadStage`, guarded only by `can(user, "update", "Lead")` + row scope. There is **no** stage-order enforcement and no requirement gate on `main`.
- Condition (b) is settable by the rep: `src/server/modules/solar/cockpit-actions.ts` → `upsertSolarCommissionAction`, guarded only by `can(user, "update", "Lead")` + row scope, and its input schema accepts `paid: boolean`.
- `sales_rep` holds `Lead: ["create","read","update"]` — `src/server/rbac/matrix.ts:196`

**Steps to reproduce.**
1. Sign in as `rep@anexahomes.com`.
2. Open one of their own solar deals and drag it on the pipeline board from "Qualified" straight to **M1 Funding** (position 20 of 27). It moves; nothing objects.
3. On the deal, set the rep commission amount and tick it as paid → `upsertSolarCommissionAction({ leadId, amountCents, paid: true })` writes `SolarMilestone.paidAt`.
4. The deal now satisfies both arms of the gate in `generateCommissionsAction`.

**Expected.** M1 funding is an assertion that the lender's first milestone payment actually landed in the company's bank account. Recording it should require the funding desk (accounting) or an admin, and moving a deal to a funding stage should not be a rep's unilateral act.

**Actual.** Both are ordinary `Lead:update` operations. The next legitimate press of "Generate commissions" by an admin or accounting will produce a real, payable commission line for a deal that was never funded.

**Business impact.** This is the segregation-of-duties hole in the pay run. It does not let a rep pay themselves — `Commission:approve` and `Payroll:update` are correctly withheld from reps (verified) — but it lets a rep present a fabricated or premature deal as fully funded and commission-ready, in a queue an approver is expected to work through in bulk. Combined with P1-2 (no post-signature price lock), a rep can also choose *how much* that commission is worth.

**Root cause.** `upsertSolarCommissionAction` was written as a deal-page convenience field ("what is the rep owed on this job") and later became load-bearing for the payroll gate, without its permission being re-examined. Its own docblock describes it as a figure a person types — it does not mention that `paidAt` is the funding gate.

**Recommended fix.** Two changes, both small:
1. Split the authority in `upsertSolarCommissionAction`: keep `amountCents`/`trigger`/`expectedAt` on `Lead:update`, but require `can(user, "approve", "Commission")` to set or clear `paid`. That grant is held by `super_admin`, `admin` and `accounting` only.
2. Gate movement *into* the M1 Funding stage (and ideally any stage past it) behind the same permission, using the `keyPattern`/`namePattern` matcher already written in `src/server/modules/payroll/gate.ts` so a renamed or Settings-created stage is still recognised. The new `solarStageRequirementError` hook in the working tree is the right place; see P2-3 about its key matching.

> **STATUS: FIXED** — `3d3bf22`
>
> Both changes made, as recommended. The authority is `Commission:approve`
> (`super_admin`, `admin`, `accounting`) and lives in
> `payroll/funding-authority.ts`. Stage moves to or past the gate need the same
> grant **unless funding is already recorded**, which keeps Inspection and PTO
> open to whoever works the board. Matched through `findGateStage`, so live's
> renamed `partial_funding_26` key is recognised; `isLost` stages are exempt so
> a rep can still cancel a dead deal.
>
> **A second defect surfaced while fixing this**: `paidAt: d.paid ? new Date()
> : null` cleared the funding stamp on every save that did not resend the flag,
> so a rep editing the expected amount silently reversed a confirmation the
> desk had made. The column is now touched only on a real transition, and every
> transition writes an attributed ActivityLog line.
>
> **A design constraint worth knowing**: `accounting` holds no `Lead` grant at
> all, so requiring both permissions would have locked the funding desk out of
> the row it exists to write. The action admits either authority and checks
> each field separately.
>
> Automations are deliberately **not** gated — see the summary.
>
> Tests: 11 unit + 17 integration, driving the server actions directly for
> every role.

---

### P0-3 · The Profit & Loss silently truncates at 1,000 transactions

**Issue.** `getBookkeepingData` fetches the 1,000 most recent transactions and then applies the reporting period **in memory**. Once a company has more than 1,000 transactions, any period that falls outside that window reports partial or zero figures, with nothing on screen saying so.

**Exact location.**
- `src/server/modules/bookkeeping/queries.ts:113-121` — `prisma.transaction.findMany({ where: { companyId }, orderBy: { date: "desc" }, take: 1000 })`. The `period` argument is not used in the query.
- `src/server/modules/bookkeeping/queries.ts:208` — `computeReports(transactions, period)`
- `src/lib/bookkeeping-reports.ts:74-95` — the period filter, applied to the already-truncated array
- Same pattern: `take: 300` on projects (line 127), `take: 100` on reconciliations (line 131)

**Steps to reproduce.** Requires >1,000 transactions, so not reproducible on the seeded database — this is a latent defect, verified by reading the query. With 1,500 transactions on the books, request the P&L for a quarter that sits entirely below row 1,000 in date-descending order. The income and expense rows come back empty and the report renders `$0` totals.

**Expected.** The P&L for a period sums every transaction in that period.

**Actual.** It sums only those that happen to fall inside the newest 1,000 rows company-wide. The Balance Sheet is worse: `cashThroughEnd` (`bookkeeping-reports.ts:77`) accumulates cash over the same truncated set, so retained earnings is wrong by everything older than row 1,000 — permanently, and increasingly, as the company grows.

**Business impact.** Financial statements that are quietly wrong are more dangerous than ones that fail. This will start biting soon: `postRunToBookkeeping` writes **one transaction per payroll line**, so a company running weekly payroll for a dozen people crosses 1,000 transactions inside two years, and faster once contractor invoices are included.

**Root cause.** `take: 1000` is a sensible cap for the *transactions table view* the same function feeds. The P&L and Balance Sheet were later derived from the same payload without giving them their own, period-bounded query.

**Recommended fix.** Give the reports their own query. Push `period` into the `where` clause as a `date` range and drop `take` for the reporting path (or aggregate in SQL with `groupBy` on `categoryId`). Keep the capped fetch for the transactions list, and page it. For the Balance Sheet's cumulative cash, use a separate `aggregate({ _sum: { amountCents } , where: { date: { lte: end } } })` rather than summing the page.

> **STATUS: FIXED** — `d31b039`
>
> Done as recommended, in `src/server/modules/bookkeeping/reports-db.ts`.
> **Four** figures came off that page, not one: the P&L, the balance sheet, the
> top cards and the per-job rollup. All four now aggregate in Postgres with the
> period in the `where` clause. The transactions list keeps its cap because it
> is a table view; nothing derives a total from it any more.
>
> Also fixed here: the **client period picker** recomputed locally over the
> same capped page, so the screen could disagree with the PDF it links to. It
> recomputes locally only while the page IS the whole ledger and fetches
> `/api/bookkeeping/reports` when it is not (`ledgerComplete` says which).
>
> Tests: 15 integration cases over a **1,300-row** ledger, including a control
> that reproduces the old understatement, millisecond-exact period bounds,
> company isolation, and the two implementations agreeing below the cap.

---

## High — P1

### P1-1 · Payroll adjustments and chargeback recoveries never reach the general ledger

**Location.** `src/server/modules/payroll/post-bookkeeping.ts:95-135` — the posting loop iterates `run.items` (commission and contractor lines) only. The file contains **zero** references to `payrollAdjustment` (verified on `origin/main`).

**Reproduce.** Create a payroll run; add a −$1,000 trenching deduction via `addPayrollAdjustmentAction`; mark the run paid. Inspect `transactions` for `source = 'payroll:<runId>'`.

**Expected.** The ledger records what actually left the bank.
**Actual.** The ledger records the gross commission total. The $1,000 deduction is nowhere in it.

**Impact.** Bank reconciliation cannot succeed: the books say the company paid $10,000, the statement says $9,000. Commission expense in the P&L is overstated by every deduction and understated by every bonus. The `reconciliations` module — which exists and is used — will never balance on a run carrying adjustments.

**Fix.** Extend `postRunToBookkeeping` to post one transaction per `PayrollAdjustment` on the run, using the existing per-kind treatment: `bonus` and `deduction` to the same job-cost-excluded "Sales Commissions" category (a deduction being a positive `amountCents`, i.e. a credit), and `chargeback_recovery` to its own category so clawbacks are separable in the P&L. The `payStubBreakdown` function already computes exactly the right numbers — reuse it rather than re-deriving.

> **STATUS: FIXED** — `74365c9`
>
> Done as recommended. The asserted invariant is now
> `SUM(transactions for the run) === -SUM(payStubBreakdown().finalCents)` over
> every recipient.
>
> **Idempotency was also wrong** and is fixed here: the guard was "any
> transaction stamped with this run? then stop", which is right for a re-post
> and wrong for a post that died half way — three lines written, the rest
> abandoned, every later attempt refused. Each transaction now carries a
> per-line key in `externalId`, so a partial post resumes and a complete one
> writes nothing.
>
> Tests: 12 integration cases — positive, negative, multiple, chargeback,
> multi-person, adjustment-only payee, re-post, resumed partial post, a late
> adjustment picked up without duplication, and an empty run creating no
> category.

### P1-2 · Nothing locks a solar deal's money after the customer signs

**Location.** `src/server/modules/solar/actions.ts` contains **zero** references to `signedAt` (verified on `origin/main`). `saveSolarFinanceAction`, `saveSolarDesignAction`, `setSolarDealLenderAction`, `setSolarSystemTypeAction`, and every action in `adder-actions.ts` / `equipment-actions.ts` are guarded by `can(user, "update", "Lead")` and row scope, and by nothing else.

The one path that *is* guarded is `src/server/modules/solar/proposal-reprice-actions.ts:117` — `if (proposal.signedAt) return fail("This proposal has been accepted and can no longer be re-priced.")`. So the customer-facing re-price is locked while the rep-facing builder save is not.

**Reproduce.** Sign a proposal as the customer. Return to the builder → Financing, raise `Base $/W`, Save. It saves.

**Expected.** After signature, price, system size, lender and adders are protected; only a Super Admin override changes them.
**Actual.** Any user with `Lead:update` on that deal can change all of them.

**Impact.** This is directly load-bearing on pay. `SolarDealComp` correctly freezes the *rates* at signature — that part works and I verified it — but the redline basis is `basePriceCents`, which is recomputed live from `SolarFinance` on every payroll run (`src/server/modules/payroll/solar-engine.ts:105-140`). So raising `grossPpwCents` after signature raises the rep's own commission, on their own deal, with no lock and no audit entry. It also means the signed snapshot and the live deal can quote two different prices to two different readers.

Note this is *partly* deliberate: the engine's comment says "a design that grows between contract and install should move the number", which is a real business case. The problem is that the same door is open to the rep who benefits.

**Fix.** Add a `dealMoneyLocked(leadId)` predicate (signed proposal exists AND no `Super Admin` override flag) and apply it in the four money-writing solar actions. Where a genuine post-signature change is needed — a design that grew — require `can(user, "approve", "Commission")` or `super_admin`, and write an `ActivityLog` entry naming the old and new figures. The `establishHistoricalCompAction` pattern in `comp-actions.ts` is the right model: demand a written reason, log it, attribute it.

> **STATUS: FIXED** — `04e7be3`
>
> `src/server/modules/solar/signed-lock.ts`, applied to eight actions: finance,
> design, equipment, lender, system type, adders, credit claims and the
> sign-today credit. Signed means **any** proposal on the deal carrying a
> `signedAt`.
>
> The override is **super admin only** — not admin, who runs the sales floor —
> and every override writes an attributed ActivityLog line naming the field;
> the price carries both figures.
>
> Everything operational stays editable by design: AHJ, permit, interconnection,
> PTO, survey, plan set, notes, tasks, photos, documents, stage moves, crew and
> install dates. A lock that stopped the job would be worse than the defect.
>
> **Reason now collected** — `e3687f2`, on your instruction.
>
> Rather than add a required argument to eight actions, the reason is collected
> **once, before the edit**, and covers the sitting. A super admin opens a
> `SolarContractUnlock` — who, when, why, and a 30-minute expiry — and every
> protected write made under it cites that reason on the deal's own history
> beside the old and the new value. The row is *expired*, never deleted, on the
> way out: it is the record that an exception was made, which is exactly the
> thing the reason was collected for.
>
> A reason gathered afterwards is a justification, not a decision; asking first
> is why this is a door rather than a key the super admin simply carries. The
> four reasons you named are offered as editable suggestions, not a fixed menu,
> because the useful ones are specific — "lender corrected the fee to 22%" tells
> a later reader something "Pricing correction" does not. Minimum 8 characters,
> enforced server-side.
>
> **The UI no longer lies.** The server always refused these writes; the screen
> still rendered editable controls that failed on save, which is worse than no
> control. The builder now goes read-only behind a banner that says the contract
> is signed, what is frozen, and that quoting something different means issuing a
> new proposal. `super_admin` additionally requires a live unlock — the role
> alone no longer bypasses the lock.
>
> Tests: 22 integration cases, up from 15, across six locked surfaces, four
> roles and the unlock lifecycle.

### P1-3 · The pay stub email states a "Net pay" that ignores every adjustment

**Location.** `src/server/modules/payroll/actions.ts:415-424` (`emailPayStubAction`) and `:454-463` (`emailAllPayStubsAction`). Both compute `const gross = data.items.reduce((s, i) => s + i.amount, 0)` and then write `` `... Net pay: ${formatCents(gross)}.` ``.

**Reproduce.** Add a −$1,000 deduction for a rep on a run, then email them their stub.

**Expected.** The email agrees with the attached PDF.
**Actual.** The email body says "Net pay: $10,000". The attached PDF — which correctly uses `payStubBreakdown(...).finalCents` via `getPayStubData` — says $9,000. The bank transfer is $9,000.

**Impact.** Every rep with a deduction receives a written statement from the company quoting the wrong net pay. This is the sort of discrepancy that becomes a wage dispute, and the email is the artefact the employee keeps.

**Fix.** One-line: use `data.breakdown.finalCents` instead of the locally-summed `gross` in both places. `getPayStubData` already returns `breakdown`.

> **STATUS: FIXED** — `74365c9` (with P1-1, same file family)

### P1-4 · A payroll run's stub list omits anyone whose only line is an adjustment

**Location.** `src/server/modules/payroll/paystub.ts:46` — `if (!run || run.items.length === 0) return null;` and `:74-76` — `getRunStubList` derives its recipient list from `payrollItem` rows only.

**Impact.** A rep whose commission was fully clawed back, or who is owed only a bonus this period, or who carries only a chargeback recovery, has no `PayrollItem` — so they get **no pay stub at all**, are omitted from "email all stubs", and are invisible in `postRunToBookkeeping`'s recipient loop. The money still moves; the paperwork does not exist.

**Fix.** Build the recipient set from the union of `PayrollItem.userId` and `PayrollAdjustment.userId` for the run, and drop the `items.length === 0` early return in favour of "no items *and* no adjustments".

> **STATUS: FIXED** — `74365c9`. Done as recommended, in both `getPayStubData`
> and `getRunStubList`. Not on your P1 list this round, but it is the same code
> path as P1-1 and the reconciliation cannot be complete without it.

### P1-5 · VPP battery credit has no maximum — the 6-battery / $1,200-a-year cap is not implemented

**Location.** `src/server/modules/solar/vpp-credits.ts:134-135`:
```ts
const annualCents = (p.vppAnnualCents ?? 0) * qty;
const upfrontCents = (p.vppUpfrontCents ?? 0) * qty;
```
No clamp on `qty`, and there is no `vppMaxBatteries` column anywhere in `prisma/schema.prisma` (verified by grep across `src/` and the schema).

**Reproduce (against your stated rule: $200/battery/year, max 6 batteries, max $1,200/year).**

| Batteries | Expected annual credit | Actual |
|---|---|---|
| 0 | $0 | $0 ✓ |
| 1 | $200 | $200 ✓ |
| 2 | $400 | $400 ✓ |
| 6 | $1,200 | $1,200 ✓ |
| **7** | **$1,200 (capped)** | **$1,400 ✗** |
| **10** | **$1,200 (capped)** | **$2,000 ✗** |
| negative `batteryQty` | $0 or rejected | **$200** — `qty = Math.max(1, batteryQty)` at line 47 floors a negative to **one** |

**Impact.** Any deal quoting more than six batteries overstates the household's annual saving, on the customer's own signed proposal, in a document that also carries a 25-year projection built on that figure. The rebate is a third party's money that will not arrive.

**Note.** The per-battery *rate* is correctly a per-provider setting (`vppAnnualCents`) rather than a hardcoded $200 — that is better than the spec asked for and should be kept. Only the ceiling is missing.

**Fix.** Add `vppMaxBatteries Int?` to `SolarProvider` beside `vppAnnualCents`, expose it on the provider form in `src/components/portal/solar-provider-manager.tsx`, and clamp: `const paid = Math.min(qty, p.vppMaxBatteries ?? qty)`. Separately, change `Math.max(1, args.batteryQty)` to reject a negative rather than floor it to one.

> **STATUS: FIXED** — `141da8b`
>
> Done as recommended, plus the normalisation. `vppMaxBatteries` is nullable and
> null means the standard six (`VPP_DEFAULT_MAX_BATTERIES`), which with the $200
> rate is the $1,200 ceiling. A column rather than a constant because the *rate*
> beside it is already the provider's own.
>
> The reported `batteryQty` is capped too, not just the money — the customer's
> card divides one by the other, so an uncapped count would have advertised
> $120/battery for a programme that publishes $200.
>
> Migration: `20260914000000_vpp_max_batteries`.
>
> Tests: 22 unit cases covering the full 0/1/2/3/4/5/6/7/10/100 table and every
> malformed input, plus 5 end-to-end cases.

### P1-6 · Three caches of "what this deal is worth" disagree by $44,000

**Location.** `SolarFinance.contractPriceCents` (cached at last save) vs. `priceStoredPurchase(...)` (recomputed live by every screen that prices a saved deal, `src/lib/solar-money.ts:855`).

**Reproduce.** I wrote a script that walks every `solar_finance` row, recomputes the contract exactly as `payroll/solar-engine.ts` does, and diffs:

```
DRIFT Priya Raman        stored=  $30,695.12  live=  $74,695.12  drift= $44,000.00   Lead.value=$21,847.56  batt=2×Powerwall 3
ok    Solar Test Workflow stored=     $36,400  live=     $36,400  drift=      $0
ok    Elena Vasquez       stored=     $56,000  live=     $56,000  drift=      $0
```

The $44,000 is the two Tesla Powerwall 3s at their catalogue price ($14,000 each = $28,000) plus a system-size change, neither of which was written back to the cached column.

**Impact.** For one deal, four different numbers are in circulation: $30,695 (the stored column), $74,695 (what the builder and payroll compute), $21,847 (`Lead.value`, driving the pipeline board and the funnel report), and $39,200-style figures on `Project.contractValue` for deals that have one. Which one a person sees depends on which screen they opened.

**Mitigation already present.** The builder *does* surface the drift — `src/components/portal/solar-panels.tsx:1459` computes `dirty` and renders "Saved at $X — this quote comes to $Y". But it is 11px muted text beside the Save button on one step of a five-step wizard, and no other surface mentions it.

> **STATUS: FIXED** — `db977e8`, then closed fully in `2cc3f92`
>
> The `Project.contractValue` leg was fixed first, re-stamped from the reported
> proposal at every moment the answer can move.
>
> The remaining leg — `SolarFinance.contractPriceCents` drifting from what
> `priceStoredPurchase` computes — is now closed too, by option (a) above.
>
> **Root cause.** The derivation that prices a deal lived *inline inside*
> `saveSolarFinanceAction`. Saving the Financing step was therefore the only
> event in the product that refreshed the cached columns. Every other way of
> changing what a deal costs — the equipment picker, the layout designer, the
> design save, the live re-price, an adder edit, a lender switch, a system-type
> switch — moved the price and left the cache behind.
>
> **Fix.** The block was *extracted*, not reimplemented: `solar/deal-money.ts`
> now holds the one derivation, `saveSolarFinanceAction` calls it, and
> `recomputeDealMoney` re-runs it from stored inputs. It is wired into
> `recompute.ts`, which is the chokepoint all four design paths already pass
> through, plus `adderGrandTotal`, the lender switch and the system-type switch.
> It writes only the seven derived columns and only when one actually changes,
> and it never creates a finance row that does not exist.
>
> **The authoritative source is unchanged and unduplicated:** `priceStoredPurchase`
> still decides what a deal costs. The stored columns are a cache of its answer,
> and are now refreshed by the same function that produces it — so there is one
> source of truth, not two. A lender-*row* ceiling is deliberately still applied
> on read rather than baked in, because publishing a rate sheet must not silently
> rewrite every saved deal; `price-drift.itest.ts` pins that distinction.
>
> 9 integration tests, each deriving the expected figure independently via
> `priceStoredPurchase` rather than asserting a number chosen by hand.

**Fix.** Either (a) make the cached column authoritative by re-saving it whenever the design or adders change — `recomputeAdderTotal` already runs on every adder edit and is the natural hook — or (b) stop storing it and derive everywhere. (a) is less disruptive. Whichever, promote the `dirty` notice from muted text to a blocking condition on proposal generation, since generating from a stale row is how the drift reaches a customer.

### P1-7 · After a customer signs, the two PDFs are not filed until an admin happens to open the deal

**Location.** `src/server/modules/solar/proposal-public.ts:311-333` (`approveOnSignature`) deliberately leaves `approvedFileId` null — the renderer boots Chromium and must not block the signature, which is correct. The filing then happens only here: `src/components/portal/solar-panels.tsx:2020-2041`, a `useEffect` gated on `if (!canApprove || !approved || !incompleteCopies(approved)) return;`. `canApprove` maps to `can(user, "update", "Settings")` — `super_admin` and `admin` only.

**Impact.** Your requirement is "when a customer signs, verify the system generates TWO PDFs". It does not — not at signing, and not on any schedule. It generates them the first time a `Settings:update` holder opens that specific deal page. A sales rep opening their own signed deal triggers nothing. There is no cron, no queue and no retry sweep. Until an admin visits, the deal has a signed proposal and an **empty Proposal folder**, which is exactly the state that blocks assembling a lender packet.

**What is correct:** once filing does run, it is well built — both renders complete before anything is written (`proposal-file-copy.ts:76-85`, "either both land or neither does"), naming is `Proposal v{n} — {customer}.pdf` and `Proposal PAR v{n} — {customer}.pdf`, the credits-applied and par readings are chosen by `?credits=1` on the same print route so **both carry the same signature and the same certificate**, and `approvedFileId` / `approvedParFileId` are nulled and re-pointed atomically so a record can never point at a deleted file. I found no case where amounts could switch between the two PDFs.

**Fix.** Add a background sweep — a cron over `SolarProposal WHERE approvedAt IS NOT NULL AND (approvedFileId IS NULL OR (hasCreditSwitch AND approvedParFileId IS NULL))` calling the same `fileApprovedCopy` — so the guarantee does not depend on who opens a page. Keep the on-open path as the fast case.

> **STATUS: FIXED** — `ff46423`
>
> Done as recommended: `/api/cron/file-signed-proposals`, every ten minutes,
> registered in `vercel.json`. The on-open path stays as the fast case. Each
> row is re-read immediately before rendering so the sweep does not race an
> admin, and `hasCreditSwitch` decides how many copies are expected so a
> single-copy document is not re-rendered for ever.
>
> `fileApprovedCopy` now accepts a null `userId` — nobody performed this, and
> `FileAsset.uploadedById` is nullable for exactly that case.
>
> Tests: 11 integration cases — both readings from one signature, correct
> names, correct column-to-file mapping, one copy where there is nothing to
> claim, filing twice replacing rather than appending, a failed second render
> leaving **neither** copy and being recoverable, and the post-signature state
> being exactly what the sweep queries for.

### P1-8 · `estimatedSolarCommission` and the payroll engine disagree on a signed deal with no frozen terms

**Location.** `src/server/modules/payroll/solar-engine.ts:300-320` refuses to pay a signed deal with no `SolarDealComp` snapshot — correct, and well argued in the comments. But `estimatedSolarCommission` in the same file (`:560-585`) has no `isSigned` check: when `comp` is null it falls straight through to the rep's *current* profile and returns a confident `{ state: "estimate" }`.

**How you get there.** `snapshotSolarDealComp` is best-effort and swallows its own errors (`deal-comp.ts:148-153`, deliberately — a customer's signature must never fail). If it throws, the deal is signed with no comp row.

**Impact.** The deal page shows the rep an estimated commission that payroll will refuse to pay, with no indication of the conflict.

**Fix.** Mirror the engine's precedence: in `estimatedSolarCommission`, if a signed proposal exists and no snapshot does, return `{ state: "needs_review" }` rather than falling through to the live profile.

> **STATUS: FIXED** — `f10dfe4`
>
> Fixed wider than the one-line suggestion above, because the one line treated a
> symptom. The real defect was that `estimatedSolarCommission` and
> `computeSolarCommissionsForProject` each carried their **own copy** of the
> pay-terms precedence chain. Two copies drift; these had.
>
> **Fix.** Both now call one exported `resolveDealPayTerms`. The signed-with-no-
> snapshot case returns `unavailable` with *the same reason string* payroll
> refuses with, so the rep is told what payroll will say rather than being shown
> a confident figure it will never honour.
>
> Fixing it by sharing rather than by patching also recovered a second, quieter
> disagreement: layer 2 of the chain — reading terms off an **existing pending
> commission line** — was only ever in the payroll copy. A deal whose line
> predates `SolarDealComp` carries its terms there and nowhere else, so the deal
> page had been quoting the rep's current profile against a line already
> generated at a different rate.
>
> 8 integration tests, every one asserting the two answers are *the same
> answer* rather than checking each separately against a figure I picked.

---

## Medium — P2

### P2-1 · The "Review & send" step has no equipment summary
Your requirement is explicit: panels + brand, inverters + brand, batteries + brand, on the final step. **Not present.** `src/components/portal/solar-proposal-builder.tsx` renders exactly three figures above the Review step (verified on `origin/main`, lines 505/540/541): `Storage` (kWh, storage deals only), `System` (kW), `Year one` (kWh). `SolarProposalGate` below it shows validation findings, the version list and the share panel — no equipment. Battery *count* appears only on storage-only deals; on a `pv_storage` deal it is not shown at all. Panel brand, inverter brand and inverter count appear nowhere on the step.
The data exists and is correct — `equip()` in `proposal-generate.ts:152` freezes manufacturer, model, rating and qty into the snapshot, and the customer's PDF renders it. It is only the rep's final check that is missing. **Fix:** add an equipment block to `SystemBanner` for the `generate` step, reading the design's module/inverter/battery relations.

### P2-2 · A deal signed with no assigned rep never reaches the compensation review queue
`snapshotSolarDealComp` (`src/server/modules/solar/deal-comp.ts:96-109`) returns early without writing a row when `lead.assignedRepId` is null. `dealsNeedingCompReview` queries `SolarDealComp WHERE needsReview = true`. No row means the deal is invisible to the queue that exists to catch exactly this. The only trace is one `ActivityLog` line. **Fix:** write the row with `repId` nullable (or a sentinel) and `needsReview = true`, or add a second query for signed solar leads with no comp row.

### P2-3 · The new contract-signed requirement is bypassed by a renamed stage
Working-tree file `src/server/modules/pipeline/solar-stage-requirements.ts:20` tests `args.stage.key !== "contract_signed"` with strict equality. Your own `payroll/gate.ts` documents at length why that is unsafe: stages created or renamed through Settings get an auto-suffixed key, and the live M1 stage is `partial_funding_26` for precisely this reason. A "Contract Signed" stage created in Settings would key as `contract_signed_12` and silently skip every requirement. **Fix:** use the `keyPattern`/`namePattern` matcher shape from `gate.ts`. (Not yet on `main` — fix before merging.)

### P2-4 · Customer signing is not idempotent server-side
`src/server/modules/solar/proposal-public.ts:157` checks `if (proposal.signedAt) return ...` and then `:184` performs an unconditional `prisma.solarProposal.update`. Two concurrent requests both pass the check and both write; the second overwrites the first's signature, timestamp and IP, two `signed` events land on the certificate audit trail, and `approveOnSignature` runs twice. The client is guarded (`disabled={busy}`, `accept.tsx:203`), so this needs a replayed request or two devices — but the certificate is a legal record and should not be racy. Note the *view* path gets this right (`:88`, `updateMany({ where: { id, status: "sent" }})`). **Fix:** make the write conditional — `updateMany({ where: { id, signedAt: null }, data: {...} })` — and treat a zero count as "already signed".

### P2-5 · 5,963 orphaned rows, because two storm tables have no foreign key on `companyId`
`storm_events.companyId` (620 rows) and `property_storm_matches.companyId` (5,343 rows) all point at company `85d9766b-…`, which no longer exists — the only company is `906798b7-…`. Neither column has an FK constraint, so re-seeding did not cascade them. A further 8 `property_storm_matches.leadId` values point at deleted leads. These tables grow forever and are never cleaned. More importantly, the missing constraint is what let the row-scope bug in `getStormMatches` (since fixed) be a cross-tenant risk rather than a mere bug. **Fix:** add the FK with `onDelete: Cascade` in a migration, after cleaning the orphans. Do not delete anything until you have confirmed against production.

### P2-6 · `activity_logs` has no index on `leadId`
Indexes present: `(companyId, industry, createdAt)`, `(companyId, projectId)`, `(companyId, createdAt)`. The deal page loads its timeline by `leadId`, and `activity_logs` is the fastest-growing table in the schema — every stage move, signature, approval, commission event and webhook writes one. Every deal page open is a sequential scan. **Fix:** `@@index([companyId, leadId, createdAt])`.

### P2-7 · Payroll adjustments and chargebacks accept a `userId` from another company
`addPayrollAdjustment` (`payroll/adjustments.ts:79`) and `requestChargeback` (`payroll/chargebacks.ts:91`) both write `userId: args.userId` without checking it belongs to `args.companyId`. The `payrollRunId` *is* validated (via `assertRunOpen`) and `commissionId` *is* validated; the payee is not. Single-tenant today, so the practical impact is a typo creating an unreachable payroll line — but it is a tenancy gap in the money path. **Fix:** `prisma.user.findFirst({ where: { id: args.userId, companyId } })` before the write in both.

### P2-8 · Three storage assumptions drive customer quotes but have no editing UI
`touPeakSharePct` (30%), `touCyclesPerDay` (1), `touRoundTripEfficiency` (90%) are read by `proposal-generate.ts:723-724` and feed the time-of-use battery savings printed on the customer's proposal. Grepping `src/components/` and `src/app/portal/settings/` returns **no hits** for any of the three — they are editable nowhere. The schema comment argues they must be "a company decision on a settings screen rather than a constant in the sizing code"; in practice they are constants. **Fix:** add them to `solar-settings-form.tsx` beside `backupOutageDrawFactor`, which is already there.

### P2-9 · Payroll adjustments can be added and deleted, but never edited
`updatePayrollAdjustmentAction` exists, validates correctly, respects the finalisation lock, and stamps `updatedById`/`updatedAt` — and **nothing calls it**. `src/components/portal/payroll-ledger.tsx` wires up add, delete, finalise and recover, but no edit. Your matrix asks to test editing an adjustment; the only route is delete-and-re-add, which loses the `updatedById` audit trail the column was added for. **Fix:** add the edit affordance, or remove the action.

### P2-10 · Chargeback recovery is a read-then-write with no transaction
`recordChargebackRecovery` (`payroll/chargebacks.ts:210-260`) reads the balance, then creates the `ChargebackRecovery`, then writes the adjustment, then conditionally settles — none of it in a transaction. Two concurrent recoveries each clamp against the same stale balance and can jointly over-recover. Low likelihood (one admin, one screen), real consequence (taking more from a rep than is owed). **Fix:** wrap in `prisma.$transaction` and re-read the balance inside it, or add a DB-level check constraint.

### P2-11 · `payroll_items` has no index on `commissionId`
`payableWhere` (`payroll/payables.ts:41`) uses `payrollItems: { none: {} }`, which Prisma compiles to a `NOT EXISTS` against `payroll_items.commissionId`. Indexes exist on `payrollRunId` and `contractorPayId` but not `commissionId`. Every payroll run creation scans the table. Cheap now, quadratic later. **Fix:** `@@index([commissionId])`.

---

## Low — P3

1. **Lender webhook uses a plain string comparison for its secret.** `src/app/api/webhooks/lenders/[lender]/route.ts:60` — `req.headers.get("authorization") !== \`Bearer ${secret}\``. Your own `assertCronRequest` (`src/server/auth/cron.ts:38`) uses `timingSafeEqual` and explains why. Make them consistent.
2. **One webhook secret for all lenders.** The `[lender]` path segment is not part of authentication. Any partner holding `LENDER_WEBHOOK_SECRET` could post a decision against another partner's application (given its `externalId`). Consider a per-lender secret on `SolarLender`.
3. **The whole `CreditApplication` flow is orphaned.** `submitCreditApplicationAction` is the only writer of the table and has **no UI caller** (verified by grep across `src/components/` and `src/app/`). So the inbound lender webhook can never match an application created through the product, and the `credit_submitted` / `credit_approved` pipeline stages have nothing feeding them. The live path is `SolarLenderSubmission` (the Amos API), a parallel model for the same concept. Decide which one is real.
4. **Decimal battery quantities round up.** `priceUnits` (`solar-money.ts:170`) does `Math.round(input.units)`, so 2.6 batteries prices as 3. Defensible, but the input should reject a fraction rather than silently round.
5. **A dealer fee of 99.999% is accepted.** `pricePurchase` stands down only at ≥100%. At 99.999% a $35,000 contract leaves the company **$0.35**. Validation catches the realistic cases; the guard rail itself could floor at something sane.
6. **`cash_bids` is a permanent schema/DB divergence.** The table exists in Postgres with 4 rows and is absent from `schema.prisma`; the drop migration is marked resolved-not-run. Well documented in the migration comments, and it is why `prisma migrate dev` wants to reset the local database. Worth closing properly.
7. **Ten dead server actions are live public RPC endpoints.** `submitCreditApplicationAction`, `ensureProposalAction`, `ensureScopeAction`, `ensureEstimateAction`, `ensurePhotoTemplateAction`, `addProjectCostAction`, `createKnockAction`, `updateTerritoryAction`, `addChannelMemberAction`, `leaveChannelAction`, plus the claim-line-item trio and `setDealBlockerAction`/`logFollowUpAction`. Each is reachable by any authenticated user with the matching grant. They are guarded, so this is attack surface without benefit rather than a vulnerability.

---

## Scope Gaps — requested in the test matrix, not present in the system

These are not defects. They are places where your test matrix describes behaviour the product does not have, and you should know before you plan around them.

**1. The Participate / lender add-on two-price model was deleted on 2026-09-09.** Your section 7 asks me to verify that a rep-facing price and a Participate/lender-facing amount stay separate, and that a global add-on configured in Settings flows into lender calculations. **None of it exists.** I verified: no `contractAdjustment*` columns in `prisma/schema.prisma`, no `src/lib/solar-contract-adjustment.ts`, no `/proposal/submission/[sig]` route, no `lenderAdjustment` anywhere in `src/`. It was removed at your own request (commit `80bf7b2`, prod columns dropped by migration `20260909030000_drop_lender_disclosures`), on the reasoning that no lender was ever configured to run a programme.

What survived, and is working, is the **federal credit ladder** — contract → ITC + bonuses → derived incentive → what the household pays — which reads like the deleted feature but is a different thing. `SolarSubmissionAmountBasis.customer_obligation` also survives as an enum value but resolves to the contract value (`lender-submit.ts:995`).

If you want a genuine two-price capability back, that is a rebuild, not a fix. Say so and I will scope it.

**2. There is no M2 funding anywhere.** Your section 4 lists it as an operational stage and section 10 states "M2 money belongs to the company, no rep split from M2". There is no M2 stage in the 27-stage solar pipeline, and `SolarMilestone` was deliberately reduced to a single row (`payee: rep, sequence: 1`) — the schema comment says the old four-slot M1/M2 schedule "described a payment schedule the business does not run". Your M2 rule is therefore satisfied vacuously: nothing models M2, so nothing can pay a rep from it. That is the right outcome but not for the reason the rule assumes; if M2 ever needs tracking, it needs building.

**3. There is no fraud-flagging module.** Section 20 asks for flagging, a review queue, reason, resolution, permissions and audit trail on *deals*. What exists is (a) the **compensation** review queue (`SolarDealComp.needsReview` → `comp-review-queue.tsx`), which is about unresolvable pay terms, not fraud, and (b) the **chargeback** flow, which does carry `fraud`, `fabricated_deal`, `misrepresentation` and `rep_misconduct` reasons with pending/approved/rejected states, requester and approver attribution, and an `ActivityLog` entry. The chargeback flow is the closest thing and it is well built. There is no way to flag a *deal* as suspect before money has moved.

**4. The Reviews module is gone.** Deleted 2026-09-12 (migration `20260912090000_drop_reviews`); site, portal and table. The only remnant is a comment in `src/components/marketing/structured-data.tsx` explaining why there is no `aggregateRating`. Nothing to test.

**5. "Users cannot skip required stages" is not enforced.** Section 4 asks me to verify that stages cannot be skipped without Super Admin permission. On `origin/main`, `moveLeadStage` performs **no** ordering check and **no** requirement check of any kind — any `Lead:update` holder can move any deal in their scope to any stage in the company. The only stage requirement in existence is the working-tree `solarStageRequirementError`, which covers `contract_signed` alone and is not yet merged. See P0-2.

---

## Security Findings

**Fixed during this audit — now verified working.** PR #30 (`fix/authz-boundaries`, merged to `main` as `121a2b4`) closed a genuine and serious set of gaps that my first pass found against a stale local `HEAD`. I re-verified all of it against `origin/main`:

- **Row-level authorisation on every solar server action.** All 45 exported actions across `actions.ts`, `adder-actions.ts`, `energy-actions.ts`, `equipment-actions.ts`, `layout-actions.ts`, `proposal-actions.ts`, `proposal-reprice-actions.ts`, `comp-actions.ts` and `cockpit-actions.ts` now resolve the deal through `leadAccessible` / `listScope` rather than `companyId` alone. Before the fix, a `sales_rep` could edit any other rep's pricing, lender, design and adders by changing one character of a `leadId`.
- **The solar proposal builder pages.** `/portal/leads/[id]/solar-proposal`, `/design` and `/preview` now call `leadAccessible`, plus a new `layout.tsx` guard covering the whole segment. Confirmed live: `rep2` requesting `rep`'s deal gets the not-found shell on all four routes.
- **Export routes use the `export` verb, not `read`.** Notably `/portal/storm-intelligence/export`, where `read` is granted to `sales_rep` and `canvasser` — so before the fix a canvasser could download 5,000 storm-matched customer names and full addresses as a CSV.
- **`getStormMatches` is row-scoped** and now takes the viewer rather than a `companyId`, dropping any match whose subject the viewer cannot see rather than rendering it anonymously (which would still have leaked the address, since the match row carries lat/lng).

**Verified sound.**

- **Cron authentication fails closed and is well built.** `src/server/auth/cron.ts` refuses with 503 when `CRON_SECRET` is unset — "a misconfigured server is a server that refuses" — uses `timingSafeEqual`, and never echoes the secret or its length. All ten cron routes use it.
- **Route access matches the RBAC matrix.** I probed 31 portal routes × 8 roles live (248 checks) by diffing rendered content, not status codes (every route returns 200 with a client-side redirect payload, so status codes are useless here). Results matched the matrix exactly: Payroll → owner/admin/accounting; Reports and Bookkeeping → owner/accounting only; all Settings → owner/admin; Team → owner/admin/manager; Commissions → everyone except canvasser/marketing/installer.
- **Export routes are correctly gated.** 13 export routes × 8 roles: every unauthorised combination returned a clean 403.
- **The public proposal token is not sufficient on its own.** `getPublicSolarProposal` additionally requires `status ∈ {sent, viewed, signed}` *and* `sentAt` — so a leaked or guessed token on an unsent draft resolves to nothing, and a 404 is returned for both a bad token and an unsent proposal so probing cannot distinguish them. Tokens are 24 CSPRNG bytes and are minted on send, not on generate.
- **Signature payloads are validated server-side as hostile input.** `isSignatureImage` rejects anything that is not a raster data URL — the comment correctly notes an SVG would be a script tag rendered into the rep's portal and the lender's PDF. Consent timestamps are clamped against the server clock.
- **Lender API keys are encrypted at rest** and masked to the last four characters in the settings UI.
- **Standard security headers are set** on every response: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS with preload, and a `Permissions-Policy` denying camera and microphone.

**Open.** P0-2 (segregation of duties on the M1 gate), P2-7 (cross-company `userId` in the money path), P3-1 and P3-2 (webhook secret handling).

---

## Financial Calculation Findings

I re-derived every figure independently from your stated rules and compared against the application. **All 27 matched to the cent.** The full harness output:

| # | Scenario | Independent | Application |
|---|---|---|---|
| A | Loan, 10 kW @ $3.50/W, 18% fee, $5,000 adders — base | $28,700.00 | ✓ |
| A | …adders grossed up by the same fee | $6,097.56 | ✓ |
| A | …contract | $41,097.56 | ✓ |
| A | …company keeps (gross) | $33,700.00 | ✓ |
| A | …dealer fee | $7,397.56 | ✓ |
| A | invariant `gross + fee == contract` | exact | ✓ |
| A | invariant `baseSticker + adderSticker + battery == contract` | exact | ✓ |
| B | Cash deal ignores a dealer fee passed in error | $40,000 / fee $0 | ✓ |
| C | Amos flat $5.50/W @ 65% fee, 10 kW + $7,000 roof on top | $62,000 | ✓ |
| C | …company keeps | $26,250.00 | ✓ |
| C | …base $/W the rep is redlined on | $1.9250/W | ✓ |
| D | Redline $2.00/W on a $28,700 base | $8,700 | ✓ |
| D | …adders excluded from the redline basis | basis = base | ✓ |
| E | Flat per-watt $0.40/W × 10 kW | $4,000 | ✓ |
| F | Company lead take 40% of $10,000 | co $4,000 / rep $6,000 | ✓ |
| F | Flat take $1,500 | co $1,500 / rep $8,500 | ✓ |
| F | Self-generated | rep keeps $10,000 | ✓ |
| F | `mode=flat` ignores a stale 40% left on the profile | $1,500 | ✓ |
| G | **Your worked example** — 2 batteries, cost $5,000 ea, sold $30,000 | gross profit $20,000 | ✓ |
| G | …40% company-lead split applied to the **rep profit** | co $8,000 / rep $12,000 | ✓ |
| H | Battery flat $500 × 3 | $1,500 | ✓ |
| H | 0 batteries pays $0, not the whole base price | $0 | ✓ |
| I | Solar + battery: 2 × $14,000 catalogue rides on top at face | contract $65,000 | ✓ |
| I | …battery adds nothing to the dealer fee | fee unchanged | ✓ |
| I | …rep not paid overage on the battery | $8,700 | ✓ |
| J | Manager override: 10% of rep **net** $6,000 | $600 | ✓ |
| J | …$/W override $0.05 × 10,000 W | $500 | ✓ |
| K | Loan payment $50,000 @ 5.99% / 300 mo | $321.85 | ✓ |
| K | …0% APR = principal ÷ term | $166.67 | ✓ |

Edge cases behaved correctly: negative kW → 0 watts / $0; a fee ≥ 100% stands the fee down rather than dividing by zero; `grossPpwFromNet(200, 100)` → `null`; `basePpwFromSticker(550, 65)` → 193¢/W (the correct "what actually survives an Amos cap"); a null loan term and a negative APR both → `null` rather than `NaN`.

Three properties are worth calling out as *specifically right*, because each is a mistake this file explicitly avoids:

- **The dealer fee is a percentage of FINAL, not a markup on gross** — `gross / (1 − f)`, never `gross × (1 + f)`. Getting this backwards under-prices an 18% programme by about 3¢/W on every deal.
- **The company-lead percentage is the COMPANY's take, not the rep's share** — the opposite convention to roofing's `providedLeadSplitPct`, and the two are never read into one another.
- **A manager's percentage override is a share of the rep's NET commission**, computed after the company-lead take, and is never subtracted from the rep.

**Findings:** P1-5 (VPP cap), P1-6 (cache drift), P3-4, P3-5.

---

## Participate / Lender Findings

The two-price model this section asks about **does not exist** — see Scope Gap 1. What does exist, and works:

- **Per-lender final $/W as either a ceiling or a fixed price** (`SolarFinalPpwMode`). The cap is correctly applied to the **contract**, not the sticker, and the system price is solved backwards out of it — so extra work comes out of the company's margin and the homeowner's number does not move. A `cap` rounds down (never quote a partner more than they fund); a `flat` rounds to nearest (land on $5.50, not $5.49). Verified: solving $5.50/W flat at a 65% fee from a $3.00 typed base returns exactly 550¢ and reports `capped: true`.
- **`financedOnTop` adders sit outside the ceiling on both sides**, at face value, exactly as Amos's re-roof rule requires. Verified in scenario C.
- **Per-lender minimum base $/W**, measured against what actually survives the cap (`basePpwFromSticker`), not against the typed figure — which is the only reading that means anything on a capped partner.
- **`priceStoredPurchase` / `priceStorageStored`** re-apply the ceiling on every read, so publishing a rate sheet after quoting does not leave old deals showing an uncapped contract on one screen and a capped one on another.
- **Lender submission mapping** — 5 basis settings and 18 hand-mappable fields, with the amount basis, saving basis, saving horizon, rep-name basis and delivery mode all defaulting to prior behaviour so enabling them re-maps nothing.
- **Submission idempotency.** The lender reference is `design.id`, and `lenderSubmissionAttempt` can only be bumped by a person, only after a failure, and never once a `qualify_submitted` event exists — so a second tap cannot open a second credit file in a household's name. The reasoning (an Amos incident on 2026-09-05) is documented on the column.

---

## Proposal Findings

**Working.** The snapshot model is the strongest part of the feature. Every figure is frozen at generation; versions supersede rather than overwrite; `showComparison` and `showPaymentOptions` are deliberately columns *outside* the snapshot so a rep can change what is shown without renumbering the document. `reconciliationProblem` (`proposal-generate.ts:68`) refuses to generate a document that contradicts itself, checking the credit ladder and the monthly payment **on every option in the frozen menu**, not just the quoted one — including the credits-applied reading the document now opens on. Generation is built entirely from server-stored, validated rows, so the guard rails cannot be bypassed by posting different numbers.

The validation layer is thorough: 47 distinct blocking and warning rules covering offset bounds, zero system size, zero production, TSRF plausibility, cash-with-a-dealer-fee, loan-without-APR, TPO-with-a-down-payment, PPA-with-a-monthly, lease-with-a-per-kWh-rate, escalator range, and implausible retail rates.

The signature record is properly built for ESIGN/UETA: consent captured as its own affirmative act *before* the signature, server-clamped timestamp, IP and user-agent taken from the request and never the payload, remote vs in-person distinguished and named on the certificate, and a SHA-256 fingerprint over **canonicalised** JSON (keys sorted at every level) — because `JSON.stringify` preserves insertion order and Prisma does not guarantee it, so an uncanonicalised fingerprint would prove nothing.

**Findings:** P1-7 (deferred PDF filing), P2-1 (no equipment summary on Review & send), P2-4 (non-idempotent signing).

---

## ITC / Tax Credit Findings

Verified working. `hasCreditSwitch` is the single definition of "this document has two honest readings", shared by the folder-filing logic and the version row so they can never disagree — including about the battery-only deck, which has no switch and would otherwise file the same PDF twice. A deal with nothing to claim files one copy. `copiesFor` reads the **frozen snapshot**, not the live deal, so a rate-sheet edit cannot change how many copies a signed proposal has. Both renders complete before anything is written. `approvedFileId` and `approvedParFileId` are nulled on re-approval so a version cannot inherit a pointer to a deleted row.

I found no path by which amounts could switch between the two PDFs: both are rendered from the same proposal id through the same print route, differing only by `?credits=1`, and the signature is read from the row in both cases.

The credit percentages (`creditItcPct` 30%, `creditEnergyCommunityPct` 10%, `creditDomesticContentPct` 10%) are company settings with a UI, correctly treated as statute rather than constants, and `claimItc` / `claimEnergyCommunity` / `claimDomesticContent` are per-deal with only the base credit defaulting on.

**Finding:** P1-7 — the two PDFs are not produced at signing time.

---

## Commission Findings

Your rules, tested against the implementation:

| Rule | Status | Evidence |
|---|---|---|
| Rep commission paid 100% at M1 funding | ✅ | `generateCommissionsAction` requires the M1 milestone; no partial logic exists anywhere |
| No partial M1 commission | ✅ | The milestone is paid or not; nothing reads a fraction |
| M2 money belongs to the company | ✅ (vacuously) | M2 is not modelled — see Scope Gap 2 |
| No rep split from M2 | ✅ (vacuously) | Same |
| Cancelled before NTP/M1 = no commission | ✅ | `eligibleStageIds` cuts lost stages out regardless of position — the comment notes a Cancelled stage usually sits at the *end* of the pipeline, so "at or past the gate" would otherwise sweep it up |
| Failed installation = no commission | ✅ | Never reaches the M1 milestone |
| Backed M1 enters the next eligible payroll | ✅ | `payableWhere` has **no lower bound** — a run pays everything approved and unbatched, however old. This is what makes a Saturday M1 (inside no Mon–Fri period) safe |
| Comp does not change retroactively when a rep's settings change | ✅ | Three-layer freeze: `SolarDealComp` at signature, `Commission.solar*` at generation, and the engine refuses to fall back to the live profile on a signed deal |

The precedence chain is the best-designed part of the compensation code: **(1)** terms frozen at signing, **(2)** terms on the existing commission row, **(3)** the rep's current profile — *and (3) is unreachable on a signed deal*. A signed deal with no usable terms fails safe: no commission, `needsReview = true`, and an admin must establish the terms through `establishHistoricalCompAction`, which demands a written reason, refuses to overwrite terms that resolved correctly, and writes an attributed `ActivityLog` entry.

Both compensation modes verified: **redline** (base minus rep redline × watts, adders excluded) and **flat** (`millsPerWatt / 10 × watts`). Battery-only pay is a separate enum from per-watt pay for the correct reason — every per-watt value is denominated in watts and a storage job has none. Both battery bases are guarded on the *count*, not merely clamped at zero: without that guard a zero-battery deal on `battery_redline` would pay `max(0, basePrice − redline × 0)` — the entire system price.

**Manager overrides (section 18):** verified. `manager` holds `Commission: ["read"]` only — no update, no approve. Managers cannot modify deal compensation. Multiple overrides on one rep coexist and do not compete. A blocked deal pays nobody, including override holders, so a manager cannot be paid ahead of the rep whose sale it rides on. Override types `job_cost` and `margin` are roofing-era values and are refused loudly on solar rather than paying zero.

**Findings:** P0-2, P1-2, P1-8.

---

## Payroll Findings

**Working.** The schedule is exactly as specified: pay day Thursday, period the prior Monday–Friday, the three constants isolated in `schedule.ts`. The weekend deliberately falls in no period, and the no-lower-bound sweep is what makes that safe. Finalisation is one-way with no re-open action anywhere — "an unlock button is the same thing as no lock at all" — and a finalised run refuses new adjustments, edits, deletions, chargeback recoveries and deletion of the run itself. Duplicate runs are prevented structurally: `payableWhere` requires `payrollItems: { none: {} }`, so a second run over the same period finds nothing and fails with a clear message. Deleting an unpaid run releases its lines back to the pool rather than destroying them. Paid runs cannot be deleted.

Chargebacks are correctly never automatic — nothing in the funding path, the pipeline or any cron calls them; the reason enum *is* the whitelist and an installation failure or a lender problem cannot be selected. An approved chargeback creates a **balance**, not a deduction, and how much comes off any run is an admin's decision each time, clamped to the remaining balance. The original commission is never edited.

This is all well covered by `payroll-ledger.itest.ts` — 30 integration tests including the exact trenching-deduction scenario from your matrix.

**Findings:** P1-1 (adjustments never posted to the ledger), P1-3 (email net pay), P1-4 (adjustment-only payees get no stub), P2-7, P2-9, P2-10, P2-11.

---

## Database Findings

| Check | Result |
|---|---|
| Abandoned tables | `cash_bids` — in Postgres with 4 rows, absent from the schema, drop migration resolved-not-run (P3-6) |
| Orphan records | 5,963: `storm_events` 620 + `property_storm_matches` 5,343 pointing at a deleted company; 8 `property_storm_matches.leadId` pointing at deleted leads (P2-5) |
| Missing foreign keys | `companyId` has no FK on `storm_events`, `property_storm_matches`, `document_events`, `document_signers`, `knock_events`, `knowledge_items`, `project_costs`, `reconciliations`, `storm_canvassing_zones`, `scope_cost_template_items`, `scope_supplement_template_items`. Also `territory_reps.userId`, `transactions.projectId`, `transactions.invoiceId`, `proposals.projectId` |
| Referential integrity elsewhere | Clean. I checked 14 nullable file/project/user pointers (`solar_proposals.approvedFileId`, `approvedParFileId`, `solar_designs.layoutImageFileId`, `planSetFileId`, `scopes_of_work.pdfFileId`, `knowledge_items.fileId`, `project_costs.fileAssetId`, and others) — **zero orphans** in every one |
| Duplicate records | None. Catalogue identity is enforced by a functional unique index (`lower()` + `COALESCE` over the nullable columns) precisely because Postgres treats NULLs as distinct |
| Invalid enums / inconsistent status names | None found. `Vertical.others` and `Role.customer` are retired-but-retained so historical rows keep validating, and both are excluded at the application layer (`allowedVerticals()`, `LEGACY_ROLES` + `auth/config.ts` refusing to authenticate them) |
| Dead columns | `SolarSettings.targetOffsetPct`, `federalItcPct`, `stateIncentiveNote`, `incentiveDisclaimer`, `minPpwCents`, `maxPpwCents` — all read by nothing, all documented as retired with the reasoning for keeping them |
| Missing indexes | `activity_logs.leadId` (P2-6), `payroll_items.commissionId` (P2-11). Otherwise well covered — `leads`, `files` and `commissions` all carry appropriate composite indexes |
| Broken indexes | None |
| Partial unique indexes | Correctly used where Prisma cannot express them: one approved proposal per lead, one active default per (company, equipment kind) |
| RLS | **Not used.** See below |

**On RLS specifically.** There are no Postgres row-level security policies. Tenant and vertical isolation is enforced entirely in the application, through a Prisma client extension (`src/server/vertical/`) plus `listScope`. That is a legitimate architecture and it is implemented carefully — but it means the database is not a backstop, and the row-scope gaps that PR #30 just fixed would have been contained by RLS had it existed. Worth a deliberate decision rather than an accident. Note also the documented trap that `runInVertical` silently no-ops under `next dev` because Next duplicates the module holding the AsyncLocalStorage — so isolation behaviour must be verified on a production build.

---

## Permission / RLS Findings

The role matrix (`src/server/rbac/matrix.ts`) is a genuine single source of truth, with per-user overrides layered on top (`{"Lead:delete": true}`) and deny-by-default for any role with no entry. Row scoping lives separately in `policies.ts`. The split is clean.

Live-verified: 31 routes × 8 roles, plus 13 export routes × 8 roles. All matched the matrix.

Two structural notes:

- **The `AND` vs spread trap is real and is documented but not universally applied.** `listScope` returns fragments carrying their own `OR` for every non-privileged role. Spread into a `where` beside another `OR`, the second key wins and the scope silently evaporates. `leadAccessible` correctly uses `{ AND: [...] }`. But `cockpit-actions.ts:18` still uses `{ ...scope, companyId, id: leadId }`. It happens to be safe today because nothing else in that object carries an `OR` — but it is one edit away from not being. Convert it to `AND`.
- **`Report` is granted to `super_admin` and `accounting` only** — not `admin`, not `manager`. Verified live. That is deliberate (managers get their numbers through the dashboard instead), but it is unusual enough to be worth confirming it is still what you want.

---

## Performance Findings

1. **`activity_logs` scans on every deal page open** — no `leadId` index, on the fastest-growing table (P2-6).
2. **The P&L truncates rather than paginates** (P0-3), and `getBookkeepingData` issues eight queries and fetches up to 1,000 transactions with all their attachments for every bookkeeping page view.
3. **`payroll_items` anti-join is unindexed** (P2-11).
4. **`getRunStubList` is N+1** — `paystub.ts:74-80` loops recipients and calls `getPayStubData` per user, each of which runs its own run query with full includes plus a YTD aggregate. On a 30-person run that is ~90 queries to render one page, and `postRunToBookkeeping` then renders a PDF per recipient inside the same request.
5. **`computeCommissionsForProject` is sequential** — `generateCommissionsAction` loops eligible projects one at a time, and each does 6–10 queries. Fine at current scale; a "generate" over several hundred funded deals will time out on a serverless function.
6. **Chromium in a serverless function** is correctly isolated to one route with `maxDuration = 60` and is explicitly acknowledged as the least reliable thing in the feature — which is why approval is allowed to commit without it. Good design; just be aware the PDF path is the fragile one.

---

## UI / Responsive Findings

**Not tested.** I could not complete this section honestly. The dev server was serving HTTP 500 on every route from the point a sibling session deleted `solar-system-info.tsx`, and the responsive checks you asked for (sidebar, tables, modals, proposal builder, deal pages, payroll, pipeline, calendar at desktop / laptop / tablet / mobile) require a working render at four viewports. Reading Tailwind classes out of source would tell you what the author intended, not what a tablet does with it, and I am not going to present the former as the latter.

What I can say from source: the codebase uses Tailwind v4 with consistent responsive prefixes, the proposal document is landscape-native with a container-query layout and a documented 816px sheet budget that is measured in `e2e/solar-proposal-print.spec.ts` with 8px of tolerance, and print CSS carries `print-color-adjust` and a zero-margin `@page` box (both hard-won — see the memory on Chrome dropping backgrounds by default).

**To finish this section** I need the working tree to compile. It is a 20-minute pass once it does: four viewports × eight screens with screenshots, plus a console-error and hydration-warning sweep, which is the other section I could not complete (#35).

---

## Dead Code / Cleanup Candidates

**Do not delete any of this without checking production first.** Listed as candidates, per your instruction.

- **78 exported functions with no reference anywhere in `src/`**, including tests. The meaningful subset is the ten dead server actions in P3-7 — each is a live RPC endpoint.
- **Dead report machinery:** `buildMasterReport`, `buildMasterReportPdf`, `getReportData`, `allowedReportTypes`, `visibleReportCards`.
- **Dead solar helpers:** `perBatteryPriceCents` (superseded by `batteryChargeCents` at its call sites), `perBatteryLabel`, `solarPayExplanation`, `validateCustomer`, `validateSolarDeal`, `isAdderBasis`, `optimalSouthFacing`, `hasVppRestrictions`, `signatureFrom`/`hostNameFor` (both now only reached via `certificateFor`), `adderUsageAdjustmentKwh`, `sourcesFor`.
- **Dead layout helpers:** `smallestPanelRectM`, `cellLocalXY`, `loosePanelCorners`, `parseRoofFace`.
- **Six retired `SolarSettings` columns** (listed under Database Findings) — all documented, all safe to leave.
- **The orphaned `CreditApplication` flow** (P3-3) — a whole model, an enum, two pipeline stages and a webhook, with no way to create a row from the product.
- **`cash_bids`** (P3-6).
- **`MilestonePayee.financier`** — the enum value survives; nothing creates one.
- **`Role.customer` and `Vertical.others`** — deliberately retained for historical rows; leave them.

---

## Missing Automated Tests

Existing coverage is strong: **183 test files, 2,129 tests, 66 Playwright specs.** Of 2,129 tests, 2,124 pass. The 5 failures are all in the working tree, not on `main` — see below.

**Modules with zero tests:** `bookkeeping`, `canvassing`, `chat`, `contractor-pay`, `estimates`, `files`, `knowledge`, `notifications`, `onboarding`, `photos`, `property`, `scope`, `settings`, `vertical`.

**Critical flows with no test, ranked by what they would have caught:**

1. **Solar revenue in reports** — nothing asserts what a solar deal contributes to Rep Scorecard, Financial Summary or the dashboard. Would have caught P0-1.
2. **`postRunToBookkeeping` completeness** — nothing asserts that what is posted to the ledger equals what was paid. Would have caught P1-1.
3. **Pay stub email content** — `payStubBreakdown` is well tested; the email that quotes it is not. Would have caught P1-3.
4. **VPP quantity boundaries** — `vpp-credits.itest.ts` exists but has no case above the cap. Would have caught P1-5.
5. **Cached-vs-live price drift** — nothing asserts `SolarFinance.contractPriceCents` still equals what `priceStoredPurchase` computes. Would have caught P1-6. *(Closed — `price-drift.itest.ts`, 9 cases, each deriving the expected figure independently.)*
6. **The M1 gate as an authorisation boundary** — `commission-gate.test.ts` tests the stage matching thoroughly, but nothing asserts *who may set the milestone*. Would have caught P0-2.
7. **Post-signature immutability** — nothing asserts a signed deal's price cannot move. Would have caught P1-2.
8. **Bookkeeping period correctness above the row cap.** Would have caught P0-3.

**Two misleading tests.** `solar-money.test.ts` → "accepts a sane design" and `solar-lender-battery-rule.test.ts` → "`warn` flags it and still generates" both currently fail in the working tree, because the `warn`→`block` change to `config.min_offset_unset` was made without updating them. They are not wrong tests; they are correct tests catching an unintended behaviour change. That is the suite working. But five red tests sitting in a working tree train people to ignore red.

---

## Recommended Test Suite

Using your existing stack only — Vitest for unit and integration, Playwright for browser. No new framework needed.

**Unit (Vitest, `src/lib/__tests__/`)**
- `solar-vpp-cap.test.ts` — the quantity table in P1-5, including 7, 10, 0 and negative.
- Extend `solar-money.test.ts` with a decimal-unit case and a fee-approaching-100% case.

**Integration (Vitest, `vitest.integration.config.ts`, real database)**
- `reports/__tests__/solar-revenue.itest.ts` — seed a solar deal with a known contract, assert Rep Scorecard, Financial Summary and dashboard revenue all equal the contract, not the net.
- `payroll/__tests__/ledger-posting.itest.ts` — run with a bonus, a deduction and a chargeback recovery; assert `SUM(transactions.amountCents WHERE source = 'payroll:<id>')` equals `payStubBreakdown().finalCents` summed over recipients. This is the invariant that makes reconciliation possible.
- `payroll/__tests__/paystub-completeness.itest.ts` — a recipient with only an adjustment appears in `getRunStubList` and gets a stub.
- `bookkeeping/__tests__/pnl-period.itest.ts` — insert 1,200 transactions, request a period below the cap, assert the total is right. This is the test that fails today.
- `solar/__tests__/price-drift.itest.ts` — save a deal, change the design, assert either the stored contract follows or generation is blocked.
- `solar/__tests__/post-signature-lock.itest.ts` — sign, then attempt each money-writing action; assert refusal without an override and an `ActivityLog` entry with one.
- Extend `payroll/__tests__/commission-gate.test.ts` with an authorisation dimension: a `sales_rep` cannot set `SolarMilestone.paidAt`, and cannot move a deal into or past the gate stage.

**API / RBAC (Vitest, extending `src/server/rbac/__tests__/`)**
- `payroll-tenancy.test.ts` — `addPayrollAdjustment` and `requestChargeback` reject a `userId` from another company.
- Extend `row-scope-boundary.test.ts` (already in the working tree — good) to assert `cockpit-actions.assertLead` uses `AND`, not spread.

**Database (Vitest integration)**
- `db-integrity.itest.ts` — assert zero orphans across the `companyId` columns that lack an FK. Cheap, and it turns P2-5 into something that cannot silently recur.

**Browser (Playwright, `e2e/`)**
- `solar-review-step.spec.ts` — assert the Review & send step names panel count + brand, inverter count + brand, battery count + brand (P2-1). Write it now; it fails until the fix lands.
- `solar-signed-lock.spec.ts` — the UI half of the post-signature lock.
- `responsive-solar.spec.ts` — the four viewports across the eight screens in your section 36, with screenshot assertions. This is the section I could not complete manually and is a better candidate for automation than for a human pass anyway.

---

## Verified Working Features

Explicitly tested and confirmed sound.

**Authentication and access**
- Login for all 9 seeded accounts; session cookie issued; `/portal` correctly redirects to `/login?next=…` when unauthenticated.
- 248 route × role checks matched the RBAC matrix exactly.
- 104 export-route × role checks: every unauthorised combination returned 403.
- Row-level deal access: a rep opening another rep's deal, builder, designer or preview gets the not-found shell on all four routes.
- Cron endpoints fail closed with 503 when unconfigured, 401 on a bad secret, and use `timingSafeEqual`.
- Retired roles cannot authenticate; `customer` has no grants and resolves to an impossible filter.
- Security headers present on every response.

**Financial arithmetic** — 27 of 27 independent recalculations matched to the cent. See the table above.

**Compensation**
- Both modes (redline, flat) correct.
- Battery-only, solar+battery, and your exact 2×$5,000 → $30,000 worked example.
- Company-lead splits: percentage, flat, self-generated, and the stale-column guard.
- Manager overrides: percentage of the rep's net, flat, and $/W; never subtracted from the rep; multiple overrides coexist.
- Terms frozen at signature and unchangeable by a later profile edit — the three-layer freeze, verified.
- A signed deal with unresolvable terms fails safe rather than guessing.

**Payroll** — Thursday/Mon–Fri schedule; no-lower-bound sweep so a late or weekend M1 lands on the next run; duplicate runs structurally impossible; one-way finalisation with all five mutation paths blocked; paid runs undeletable; unpaid deletion releases lines back to the pool; chargebacks never automatic, reason-whitelisted, balance-not-deduction, clamped, never editing the original commission.

**Proposals** — snapshot immutability; `reconciliationProblem` refusing self-contradicting documents across every frozen option; 47 validation rules; ESIGN/UETA record with pre-signature consent, server-clamped timestamps, request-derived IP/UA, and a canonicalised SHA-256 fingerprint; public token insufficient without `sent` status; SVG signature payloads rejected.

**ITC / PAR** — one signature, two PDFs, correct naming, correct file-record pointers, both-or-neither filing, decided from the frozen snapshot.

**Lender pricing** — cap vs flat modes; cap applied to the contract not the sticker; correct rounding direction per mode; on-top adders outside the ceiling; margin floor measured against what survives the cap; submission idempotency.

**Equipment governance** — soft retire via `isActive`; hard delete refused when any design references the item, with a message naming the count and directing to retire instead; `onDelete: SetNull` so history survives; `avlYear` tagging; per-lender approved-vendor lists that narrow the selectors; at most one active default per kind, enforced by a partial unique index.

**Database** — zero orphans across 14 nullable pointer columns; no duplicate catalogue rows; functional unique index handling the NULL-distinctness problem correctly; partial unique indexes where Prisma cannot express them.

**Test suite** — 2,124 of 2,129 passing on `main`; the 5 failures are working-tree-only and are the suite correctly catching an unintended behaviour change.

---

## Working-Tree Observations (not production defects)

Uncommitted or unmerged at the time of audit. Flagged so they are not lost.

1. **`config.min_offset_unset` was changed from `warn` to `block`** in `src/lib/solar-validation.ts`, and `SolarSettings.minOffsetPct` defaults to **0**. As written, a company on defaults can never generate any solar proposal. Your production company is at 80, so live is unaffected — but a new tenant would be dead on arrival. `utility.provider_missing` was upgraded the same way; 1 of 10 seeded designs has no utility provider and would now be blocked. Both changes broke 5 tests that were not updated.
2. **`solar-stage-requirements.ts` uses strict key equality** — see P2-3. Fix before merging.
3. **`src/app/portal/leads/[id]/page.tsx` imports a deleted module** (`@/components/portal/solar-system-info`), so the whole app fails to compile. Transient, mid-refactor, already flagged to the session that owns it.

---

## What I Did Not Test

> **UPDATE, 2026-09-14 — §35 and §36 are now done.** Both were blocked by the
> compile failure described below, which does not exist on `origin/main`. The
> results:
>
> **§35 client-side errors — CLEAN.** Dashboard, deal page and proposal builder
> in a real browser: no console errors, no React warnings, no hydration
> mismatches, no failed requests, no unhandled rejections. Only Next dev noise
> (HMR, Fast Refresh, the React DevTools banner). Every solar route smoke-tested
> for 500s — all 200.
>
> **§36 responsive — CLEAN at all four widths.** Automated as
> `e2e/responsive-solar.spec.ts` rather than done by hand, so it runs on every
> commit. 1440 / 1280 / 768 / 390 across Pipeline, Payroll, Reports, Commissions
> and Solar Settings, plus the deal page and the proposal builder at phone
> width. No unreachable horizontal overflow anywhere. Green three consecutive
> runs.
>
> One thing the spec caught about itself, worth recording: an early run reported
> an overflowing brand lockup on Documents. The lockup was real but the page was
> not — `/portal/documents` redirects to the dashboard for a role whose
> workspace has no templates, so the suite had measured the dashboard under
> another page's name. The spec now asserts *where it landed* before measuring.

Stated plainly rather than left as a gap.

- **UI / responsive (§36)** and **client-side error testing (§35)** — blocked by the compile failure above.
- **Live report and dashboard values** — verified from source and the database, not by rendering, for the same reason. The P0-1 arithmetic is confirmed from `Project.contractValue` in the database against `solar_finance`.
- **Appointments (§3), Tasks (§23), Calendar (§24), Field Map (§25), Chat (§26), Knowledge Base (§27)** — route-level access was verified for all of them across all 8 roles, but I did not exercise their create/edit/delete flows. They are outside the solar money path and I prioritised the areas where an error costs money.
- **Anything against production.** Every test ran against the local seeded database. No production data was read or written, nothing was deployed, no branch was pushed or merged, no commission was marked paid, no lender submission was sent, no customer email or SMS was triggered.

---

## Cleanup performed

- My dev server on `:3411` stopped; `.next-qa-3411/` removed.
- The two `include` lines Next appended to `tsconfig.json` for my dist dir reverted. Another session's `.next-verify-3311` lines were left untouched.
- `.qa-scratch/` (throwaway scripts) removed.
- No application file was modified. The only file this audit added is this report.

---

## Recommended order of work

If you want a sequence rather than a list:

1. **P1-3** — one line, wrong number in an employee's hands today.
2. **P0-2** — the segregation-of-duties hole. Two permission checks.
3. **P1-1** — the ledger cannot reconcile without it.
4. **P0-1** — management reporting is wrong by 30–50% on solar.
5. **P1-2** — post-signature lock.
6. **P1-5** — the VPP cap, before a >6-battery deal is quoted.
7. **P0-3** — before the transaction count crosses 1,000.
8. Everything else.

I have not changed any code. Tell me which items to take and I will start.
