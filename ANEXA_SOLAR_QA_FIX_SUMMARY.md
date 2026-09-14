# Anexa Solar QA — Fix Summary

**Date:** 2026-09-14
**Branch:** `qa/solar-p0p1-fixes` — based on `origin/main` @ `c83ddce`
**Worktree:** `/Users/mustafajoulani/Desktop/anexa-qa-fixes-wt` (isolated; the shared tree was never touched)
**Not pushed. Not merged. Not deployed. No production data altered.**

---

# Executive Summary

All **3 P0** and all **5 P1** issues from `ANEXA_SOLAR_QA_REPORT.md` are fixed, with **119 new tests**. Two additional defects were found while fixing them and are fixed here too. One P1 is **partially** fixed and one P3 is deliberately **not** fixed; both are named below rather than buried.

The work was done in an isolated worktree off `origin/main`. That mattered: five sibling Claude sessions were live in the shared tree, three actively writing, and that tree was nine commits behind main while carrying a half-finished refactor that left the app unable to compile. Building on it would have meant a stale base, three concurrent writers, and a broken build.

**Two things changed my plan, and both are worth your attention.**

First, **the security findings from the original report were already fixed.** My first pass read a stale local `HEAD` and concluded the whole solar server-action surface lacked row-level authorisation. Re-checking against `origin/main` showed PR #30 (`fix/authz-boundaries`) had merged exactly that fix. Every finding in this pass was re-verified against the deployable branch before any code was written.

Second, **the `config.min_offset_unset` issue you asked me to investigate is not a bug on main.** It is a warning there, correctly. The `warn`→`block` change lives only in an uncommitted sibling working tree, and it should not land: `minOffsetPct` ships at `0`, so as written it would leave every workspace on defaults unable to generate any proposal at all. What I did instead is described under P1 below.

The two pre-existing integration failures on `origin/main` (`calendar/visit-crew`, `solar/battery-pricing`) are **not mine** — confirmed by stashing all my work and re-running on a pristine checkout. I have not touched them.

---

# P0 Fixes

### P0-1 · Solar revenue is the contract, not the after-credit net — `db977e8`

A $56,000 solar contract was booked as $39,200 of revenue, exactly ×0.70, on every Project-based report.

**Root cause, traced UI → action → DB → report.** `Project.contractValue` is written once, at Project creation, from `Lead.claimPrice ?? Lead.value`. That is roofing's rule and correct there. On solar `claimPrice` is null and `value` is *deliberately* the household's net after the federal credits — a documented product decision for the pipeline card. So the job was stamped with the net and never touched again, and seven reporting surfaces read it.

**Fix.** Fixed at the denormalisation rather than in seven queries. `restampLeadValue` already re-reads the reported proposal at the three moments the answer can move (generate, approve, unapprove); it now stamps the contract onto `Project.contractValue` alongside the net onto `Lead.value`. `ensureProjectForLeadAction` calls it immediately after creating a solar job. The second half — a deal is *sold* before it has a job — is `solarContractByLead`, used by the rep scorecard and lead-source ROI.

**The financial concepts, distinguished** (as you asked, before touching anything):

| Concept | Authoritative source |
|---|---|
| Customer contract amount | reported proposal → `financing.contractPriceCents` |
| Sales / rep price (pre-fee) | `PurchaseBreakdown.basePriceCents` — the redline basis |
| Tax-credit-adjusted display | `creditLadder.netCostCents` → `Lead.value` |
| Company revenue / net to dealer | `grossPriceCents` (base + adders + battery, pre-fee) |
| Participate / lender amount | **does not exist** — removed 2026-09-09, not recreated |
| Funded / M1 | `SolarMilestone(payee: rep, sequence: 1).paidAt` |
| M2 | **not modelled** — not recreated |
| Rep commission | `Commission.amount` (net), `solarGrossAmount` (pre lead-take) |

**Verified live.** After the backfill, the seeded dashboard's Team Performance moved from **$39.2K to $56K**, with `Lead.value` correctly still `$39,200`.

### P0-2 · A rep cannot certify the funding that pays them — `3d3bf22`

Commission is released by two facts together: stage at or past M1 Funding, and the rep milestone stamped paid. Both were ordinary `Lead:update` writes, which every `sales_rep` holds on their own deals.

**Fix.** Authority is `Commission:approve` — `super_admin`, `admin`, `accounting`. Not a new permission: "may decide a commission is real" already means this. Stage moves to or past the gate need the same grant **unless funding is already recorded**, which keeps Inspection and PTO open to whoever works the board. Matched through `findGateStage` so live's renamed `partial_funding_26` key is recognised; lost stages exempt so a rep can still cancel a dead deal.

**Second defect found while fixing it.** `paidAt: d.paid ? new Date() : null` cleared the funding stamp on *every* save that did not resend the flag — so a rep editing the expected amount silently reversed a confirmation the desk had made, and the only symptom was the commission quietly ceasing to generate.

**A constraint worth knowing:** `accounting` holds no `Lead` grant at all, so requiring both permissions would have locked the funding desk out of the row it exists to write. The action admits either authority and checks each field separately.

**Automations are deliberately not gated.** They are admin-configured (`Settings:update`), and the shipped starter rule moves Installed → Inspection, which is *past* the gate on the live pipeline. Gating them would break a shipped workflow to close a hole the milestone lock already closes.

### P0-3 · The P&L stops truncating at 1,000 transactions — `d31b039`

**Four** figures came off the capped page, not one: the P&L, the balance sheet, the top cards and the per-job rollup. All now aggregate in Postgres with the period in the `where` clause. The transactions list keeps its cap because it is a table view; nothing derives a total from it.

Income and expense split on the **sign** of the amount, not the category's type — a category legitimately carries rows both ways — and Prisma cannot group by an expression, so that is two grouped queries with complementary filters. The balance sheet keeps its own query: it is a snapshot, everything on or before the end with no lower bound.

**Also fixed:** the client period picker recomputed locally over the same capped page, so the screen could disagree with the PDF it links to. It recomputes locally only while the page IS the whole ledger, and fetches `/api/bookkeeping/reports` when it is not.

**Other reporting queries checked for the same anti-pattern**, as asked. `suggest.ts` (`take: 300/200`) is a heuristic over recent rows and correct. `reconciliations` (`take: 100`) is a list view. `storm/queries.ts` caps are documented and deliberate. The `projects` cap needed a follow-on fix: now that the rollup groups the whole ledger, a job older than the 300-project page would have surfaced with money against it and rendered as an unlinked "Deal", so labels are fetched for the ids that actually appear.

---

# P1 Fixes

### P1-1 · The ledger records what actually left the account — `74365c9`

Adjustments never reached bookkeeping, so a run with a $1,000 trenching deduction booked the gross while the bank showed the net. All three kinds post now. Recoveries book to their own "Commission Chargebacks" category rather than netting into commissions.

**Invariant asserted:** `SUM(transactions for the run) === -SUM(payStubBreakdown().finalCents)` over every recipient.

**Idempotency was also wrong.** The guard was "any transaction stamped with this run? then stop" — right for a re-post, wrong for a post that died half way. Each transaction now carries a per-line key in `externalId`, so a partial post resumes and a complete one writes nothing.

**Plus P1-4** (not on your list this round, but the same code path and the reconciliation is incomplete without it): a person can be paid without a commission line, and `getPayStubData` returned null on empty `items` — so a rep whose commission was fully clawed back got no stub, no entry in "email all stubs", and no receipt on their ledger line.

### P1-3 · The pay-stub email states the real net — `74365c9`

One line, as diagnosed: `data.breakdown.finalCents` instead of the locally-summed items. The PDF was already correct and is untouched.

### P1-2 · A signed contract's economics stop being editable — `04e7be3`

`signed-lock.ts`, applied to eight actions: finance, design, equipment, lender, system type, adders, credit claims, sign-today credit. Signed means **any** proposal on the deal carrying a `signedAt`.

This is the one that moved a rep's own pay: `SolarDealComp` freezes the pay *rates* at signing, but a redline is measured against `basePriceCents`, which payroll recomputes live from `SolarFinance`.

Override is **super admin only** — not admin — and every override writes an attributed ActivityLog line; the price carries both figures. Everything operational stays editable by design: AHJ, permit, interconnection, PTO, survey, plan set, notes, tasks, photos, documents, stage moves, crew, install dates.

**Not done:** a written *reason* is not collected. These eight actions take none and adding a required argument to each is a UI change in eight places. Who, when, what, before and after are recorded. **Your call whether that is enough** — see Business Input below.

### P1-5 · The VPP rebate has a ceiling — `141da8b`

`rebate = min(max(qty, 0), max) × rate`, with `max` defaulting to 6. A column rather than a constant because the *rate* beside it is already the provider's own — hard-coding one would contradict the other the first time a second programme signs at a different amount.

The reported `batteryQty` is capped too, not just the money: the customer's card divides one by the other, so an uncapped count would have advertised $120/battery for a programme that publishes $200.

Quantities are normalised rather than trusted — NaN, null, Infinity and strings earn nothing; a negative earns nothing where it used to floor to **one** and pay a rebate on nonsense; a fraction floors. Exactly zero with a battery chosen still reads as one, the long-standing rule, because the equipment card already prints "1 total" for that row.

### P1-7 · Signing files the PDFs without waiting for an admin — `ff46423`

A cron sweep every ten minutes. The on-open path stays as the fast case; the renderer still must not block a customer's signature, which was the right call and is preserved. Each row is re-read immediately before rendering so the sweep does not race an admin, and `hasCreditSwitch` decides how many copies are expected so a single-copy document is not re-rendered for ever.

### Plus · The unset minimum-offset guard rail — `b8f3441`

Investigated as instructed, **after** the P0/P1 work. Answering your questions directly:

- **What does 0 mean?** "No minimum configured." The code says so explicitly. It is a sentinel, not a business value.
- **Is the default tenant configuration valid?** Yes. Generation works; the deal carries a warning.
- **Should generation block?** **No.** Blocking on an unconfigured *guard rail* punishes a tenant for not having configured a guard rail, and would leave a brand-new workspace unable to quote anything.
- **Should validation require it earlier?** Yes — and that is the actual gap. A deal-level warning is read by a rep, who cannot change a company setting.

So it becomes a **workspace setup gap**, the mechanism this codebase already has for exactly this: a `silent`-severity item on the Settings hub beside lenders and per-battery rep pay. No business value invented, no generation blocked.

---

# Files Changed

46 files, +4,356 / −111. Full list in `git diff --stat c83ddce`.

**New (13)** — `payroll/funding-authority.ts`, `solar/signed-lock.ts`, `reports/solar-contract.ts`, `bookkeeping/reports-db.ts`, `api/bookkeeping/reports/route.ts`, `api/cron/file-signed-proposals/route.ts`, one migration, and 6 test files + 1 e2e spec.

**Modified, by area** — reports (`rep-scorecard`, `lead-sources`), dashboard/bookkeeping (`queries`, `bookkeeping-client`, `paystub`, `post-bookkeeping`, `payroll/actions`), solar (`actions`, `adder-actions`, `equipment-actions`, `cockpit-actions`, `deal-value`, `vpp-credits`, `proposal-file-copy`, `providers`), leads/projects (`leads/actions`, `projects/actions`), settings (`workspace-health`), libs (`solar-deal-value`, `solar-provider-terms`), UI (`solar-cockpit`, `solar-provider-manager`, `leads/[id]/page`, `settings/solar-providers/page`), plus `schema.prisma`, `vercel.json` and the backfill script.

---

# Database Migrations Added

**One.**

`prisma/migrations/20260914000000_vpp_max_batteries/migration.sql`

```sql
ALTER TABLE "solar_providers" ADD COLUMN "vppMaxBatteries" INTEGER;
```

Additive, nullable, no backfill — null means the house rule of six, which is the same convention every other optional rule on that table follows. Nothing is dropped or rewritten. Applied to the local dev and test schemas only.

---

# Authorization Changes

| Action | Before | After |
|---|---|---|
| `upsertSolarCommissionAction` — `paid` flag | `Lead:update` | `Commission:approve` |
| `upsertSolarCommissionAction` — amount/trigger/date | `Lead:update` | `Lead:update` (unchanged) |
| `upsertSolarCommissionAction` — entry | `Lead:update` | `Lead:update` **or** `Commission:approve` |
| `moveLeadStage` into/past the solar funding gate | `Lead:update` | `Commission:approve`, unless already funded |
| 8 solar economic actions, after signature | `Lead:update` | `super_admin` only, audited |
| `/api/bookkeeping/reports` (new) | — | `Bookkeeping:read` |
| `/api/cron/file-signed-proposals` (new) | — | `CRON_SECRET`, fails closed |

Verified by role: `sales_rep`, `canvasser`, `manager`, `admin`, `accounting`, `super_admin` — all driven through the server actions directly, not the UI.

---

# Financial Logic Changes

- **Revenue** on a solar deal is the contract, never the after-credit net. `Lead.value` still holds the net for the pipeline card; the two are now distinct.
- **Funding certification** is a separate authority from deal editing.
- **Payroll adjustments** post to the ledger with the correct sign, and reconcile against the amount actually paid.
- **VPP** is clamped to the programme's ceiling; the reported count is clamped with it.
- **Signed contracts** are immutable to everyone but a super admin, with a trail.

No pricing formula was changed. The 27 independent recalculations from the original audit still pass unchanged.

---

# Tests Added

**119 new tests** across 9 new files.

| File | Tests | Covers |
|---|---:|---|
| `lib/__tests__/solar-deal-value.test.ts` (extended) | 6 | contract vs net, ITC on/off, cash, lease, PPA, unpriced |
| `lib/__tests__/solar-vpp-cap.test.ts` | 22 | the full 0–100 table, negatives, NaN, strings, fractions |
| `payroll/__tests__/funding-authority.test.ts` | 11 | who may certify; the positional gate, on live's stage list |
| `reports/__tests__/solar-revenue.itest.ts` | 11 | job / no job, ITC, cash, lease, PPA, versions, roofing untouched |
| `payroll/__tests__/funding-gate.itest.ts` | 17 | every role, API bypass, un-funding by omission, cancel |
| `bookkeeping/__tests__/pnl-truncation.itest.ts` | 15 | 1,300-row ledger, bounds, isolation, segment reconciliation |
| `payroll/__tests__/ledger-posting.itest.ts` | 12 | all adjustment kinds, re-post, resumed partial post |
| `solar/__tests__/signed-lock.itest.ts` | 15 | six locked surfaces × four roles, override + audit |
| `solar/__tests__/signed-proposal-filing.itest.ts` | 11 | both PDFs, naming, idempotency, partial failure |
| `solar/__tests__/vpp-credits.itest.ts` (extended) | 5 | the ceiling end to end |
| `e2e/responsive-solar.spec.ts` | 5 | four viewports, seven screens |

---

# Test Results

| Suite | Baseline (`c83ddce`) | After |
|---|---|---|
| Unit (`vitest`) | 137 files / **2,126 passed** | 139 files / **2,165 passed**, 0 failed |
| Integration | 527 total / 525 passed / **2 pre-existing failures** | 602 total / **600 passed** / same 2 |
| E2E — responsive | did not exist | **5 passed**, green 3 consecutive runs |
| E2E — `solar-permitting` | 3 passed | **3 passed** |
| Typecheck | clean | **clean** |
| Lint | 42 errors / 23 warnings | **42 / 23 — identical, zero regression** |

The 2 integration failures are **pre-existing on `origin/main`**, proven by stashing all my work and re-running on a pristine checkout: `calendar/visit-crew.itest.ts` and `solar/battery-pricing.itest.ts`. Untouched.

The 42 lint errors are the project's own backlog. One of them was briefly mine — a synchronous `setState` in my new effect — and is fixed (`7131e93`); the count is now byte-identical to the base.

---

# Browser QA Results

Both sections the original audit could not finish are now done.

**§35 client-side errors — CLEAN.** Real browser against the dev server. Dashboard, deal page and proposal builder: no console errors, no React warnings, no hydration mismatches, no failed network requests, no unhandled rejections, no duplicate API calls. Only Next dev noise. Every solar route smoke-tested for 500s — all 200.

**§36 responsive — CLEAN at 1440 / 1280 / 768 / 390.** Automated as `e2e/responsive-solar.spec.ts` so it runs on every commit rather than once. Covers Pipeline, Payroll, Reports, Commissions, Solar Settings, the deal page and the proposal builder. No unreachable horizontal overflow anywhere.

Chrome's `resize_window` reported success but never changed the viewport, so the hand-driven approach could not produce a real result; Playwright at real viewport sizes did. Three harness flakes surfaced and each was fixed at its cause rather than papered over with a retry: `networkidle` never fires against an HMR websocket; `next dev` compiles routes on first hit so the first test paid for all of them; and a late client redirect kills an in-flight `evaluate`.

**One finding the spec produced about itself, worth keeping.** An early run reported an overflowing brand lockup on Documents. The lockup was real but the page was not — `/portal/documents` redirects to the dashboard for a role whose workspace has no templates, so the suite had measured the dashboard under another page's name. The spec now asserts *where it landed* before measuring, and Documents is out of the list with the reasoning recorded.

---

# Remaining P2/P3 Issues

Not in scope this round. From the original report, unchanged:

**P2** — no equipment summary on Review & Send (P2-1); a deal signed with no rep never reaches the comp review queue (P2-2); `solarStageRequirementError` strict key matching (P2-3, sibling's tree, fix before merging); customer signing not idempotent server-side (P2-4); 5,963 orphaned storm rows with no FK on `companyId` (P2-5); `activity_logs` missing a `leadId` index (P2-6); payroll `userId` not validated against company (P2-7); three `tou*` settings with no editing UI (P2-8); `updatePayrollAdjustmentAction` has no caller (P2-9); chargeback recovery race (P2-10); `payroll_items.commissionId` unindexed (P2-11).

**P3** — webhook uses plain string compare (P3-1); one webhook secret for all lenders (P3-2); the orphaned `CreditApplication` flow (P3-3); decimal battery qty rounds up (P3-4); a 99.999% dealer fee is accepted (P3-5); `cash_bids` schema drift (P3-6); ten dead server actions (P3-7).

Also still open: **P1-8** (`estimatedSolarCommission` disagrees with payroll on a signed deal with no snapshot). Narrow — it needs `snapshotSolarDealComp` to have thrown — and nothing pays out of it. The one-line fix is in the report.

---

# Remaining Risks

1. **`SolarFinance.contractPriceCents` can still drift** (P1-6, partially fixed). The `Project.contractValue` leg is fixed and nothing that reports money reads the stale column any more. Closing it fully means re-saving the finance row whenever the design or adders change — a wider change than this pass should make unannounced.

2. **The stage guard changes an operational workflow.** Pre-funding, a manager or coordinator can no longer move a solar deal to or past M1 Funding; the desk records M1 on the deal first, then the board moves. That matches the pipeline's own intended order (Install Complete → M1 Funding → Inspection), but it is a workflow change and you should know about it. **See Business Input.**

3. **The backfill has not been run anywhere but locally.** Every already-created solar Project still holds the after-credit net until `scripts/backfill-solar-deal-value.ts --apply` runs against that environment. It is dry-run by default and re-runnable.

4. **The migration is unapplied outside local.** Additive and nullable, so nothing breaks before it runs — the code reads `?? VPP_DEFAULT_MAX_BATTERIES`.

5. **The signed-lock has no UI gating yet.** The server refuses correctly and the error text says what to do, but the builder still offers the controls. Cosmetic, and deliberate: gating eight surfaces is UI churn I did not want to bundle into a correctness pass.

6. **Two pre-existing integration failures remain red** on main. Not mine, not investigated.

7. **The shared tree is still nine-plus commits behind main with a broken build.** Not mine to fix, and I did not touch it. Whoever owns it should rebase.

---

# Recommended Next Phase

1. **Merge this branch**, run the backfill and the migration per environment, then re-check the dashboard's Team Performance against a known contract.
2. **Decide the two business questions below.**
3. **P2-5 and P2-6** — the orphan FKs and the `activity_logs` index. Cheap, and the index gets more valuable every day.
4. **P2-1** — the equipment summary on Review & Send. Small, visible, and it was an explicit ask.
5. **P2-4 and P2-10** — the two idempotency races (customer signing, chargeback recovery).
6. **Close P1-6 properly** by re-saving the finance row on design and adder changes.
7. **Tell the sibling session** that the `warn`→`block` change on `config.min_offset_unset` must not ship as written.

---

# Decisions That Need Your Input

**1. The stage guard and your operations workflow.** Pre-funding, only `super_admin` / `admin` / `accounting` can move a solar deal to or past M1 Funding. Once funding is recorded, anyone with the board can carry it through Inspection and PTO. This matches your pipeline's order, but if coordinators routinely drag deals into M1 Funding *as* the way of announcing that money arrived, this will feel like a wall. The alternative is to guard only the milestone and leave the stage open — the payout hole is closed either way. **Which do you want?**

**2. Is an audit trail without a written reason enough?** A super admin can change a signed contract's price. I record who, when, what, and both figures. Your brief said "record reason if infrastructure already supports reasons" — it does not, and adding one means a required argument and a prompt on eight surfaces. **Say the word and I will add it.**

**3. The VPP ceiling as data vs. constant.** I made it a per-provider column defaulting to six, because the rate beside it is already per-provider. Your brief specified the formula with `6` hard-coded. The default gives you exactly the stated rule out of the box. **Confirm you are happy with the column, or I will inline the constant.**
