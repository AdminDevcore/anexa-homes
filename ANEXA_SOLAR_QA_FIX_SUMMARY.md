# Anexa Solar QA — Fix Summary

**Date:** 2026-09-14
**Branch:** `qa/solar-p0p1-fixes` — based on `origin/main` @ `c83ddce`
**Worktree:** `/Users/mustafajoulani/Desktop/anexa-qa-fixes-wt` (isolated; the shared tree was never touched)
**Not pushed. Not merged. Not deployed. No production data altered.**

---

# Executive Summary

All **3 P0** and all **8 P1** issues from `ANEXA_SOLAR_QA_REPORT.md` are fixed. Two additional defects were found while fixing them and are fixed here too. **Nothing is left partially fixed.**

The last pass closed 8 of 10 and named the two it left open. This pass closed both, on your business decisions: **P1-6** (cached price drift), **P1-8** (deal-page estimate vs payroll), and the signed-lock's missing **UI gating and required reason**.

Both remaining items turned out to have the same root cause, and it is worth stating plainly because it shaped the fix: *a calculation existed in two places.* P1-6 was the deal's price derived inline inside one save action, so the seven other ways of changing a deal left the cache stale. P1-8 was the pay-terms precedence chain written out twice, once for the deal page and once for payroll, which had drifted apart on the case that matters most. In both, the fix was to **extract the existing implementation into one shared function** and call it from both sides — not to write a second implementation that agrees. You asked me not to create competing sources of truth; the way to honour that was to remove the ones already there.

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

### P1-6 · One deal, one price — `2cc3f92`

**The defect.** The block of code that decides what a solar deal costs lived *inside* `saveSolarFinanceAction`. That made saving the Financing step the only event in the entire product that refreshed the cached price columns. Seven other things move a deal's price — the equipment picker, the layout designer, the design save, the live re-price, an adder edit, a lender switch, a system-type switch — and every one of them left the cache holding the old number.

**The fix.** I extracted the block verbatim into `solar/deal-money.ts` and had the save call it. `recomputeDealMoney` then re-runs that same derivation from the stored inputs, and is wired into `recompute.ts` — the chokepoint every design path already passes through — plus `adderGrandTotal`, the lender switch and the system-type switch.

**On not creating competing sources of truth.** `priceStoredPurchase` was and remains the authority on what a deal costs; the stored columns are a cache of *its* answer. The temptation here was to write a fresh "recompute" that agrees with the save — which is two implementations and a promise. Extracting the one that already existed means there is nothing to keep in sync. `recomputeDealMoney` writes only the seven derived columns, only when one actually changed, and never creates a finance row that does not exist.

One thing it deliberately does **not** cache: a lender-*row* price ceiling. That is applied on read by `priceStoredPurchase` and written back only at generation, because publishing a rate sheet must not silently rewrite every saved deal in the company. I found this while writing the tests, and pinned the distinction rather than "fixing" it.

**Tests:** 9 integration cases. Each derives the expected figure independently through `priceStoredPurchase` and asserts the stored columns equal it — so the test cannot pass by agreeing with the same mistake.

### P1-8 · The rep's estimate is the payroll calculation — `f10dfe4`

**The defect, and why it was bigger than reported.** The report described a symptom: on a signed deal with no frozen terms, the deal page quotes a number payroll refuses. The cause was that `estimatedSolarCommission` and `computeSolarCommissionsForProject` each held their **own copy** of the pay-terms precedence chain. Two copies of a calculation drift, and these had.

**The fix.** One exported `resolveDealPayTerms`, called by both. The precedence is unchanged — `SolarDealComp` snapshot, then an existing commission line, then the rep's live profile **on unsigned deals only** — it is now written once. A signed deal with no snapshot returns `unavailable` carrying *the same reason string* payroll refuses with, so the rep reads what payroll will say instead of a confident figure it will never honour.

**What sharing recovered that patching would not.** Layer 2 — reading terms off an existing pending commission line — was only ever in the payroll copy. A deal whose line predates `SolarDealComp` carries its terms there and nowhere else, so the deal page had been quoting the rep's *current* profile against a line already generated at a different rate. Nobody had reported it. Mirroring one branch, as the report suggested, would have left it.

**Tests:** 8 integration cases, every one asserting the two answers are *the same answer* rather than checking each against a number I chose.

### Plus · The signed lock stops lying to the user — `e3687f2`

The server has refused protected writes on a signed contract since `04e7be3`. The screen did not know: it still rendered editable price, design and lender controls that failed on save. A control that looks editable and then refuses is worse than no control, because it teaches people the app is broken rather than that the contract is final.

The builder now goes read-only behind a banner saying the contract is signed, what is frozen, and that quoting something different means issuing a new proposal — and for a super admin, the banner is the door through. See the Decisions section for the reason workflow and the two places I went stricter than the brief.

**Tests:** the signed-lock suite grew 15 → 22 cases, adding the unlock lifecycle: refused without one, allowed with one, refused again after expiry, reason recorded on the audit line, and non-super-admins refused throughout.

### Plus · The unset minimum-offset guard rail — `b8f3441`

Investigated as instructed, **after** the P0/P1 work. Answering your questions directly:

- **What does 0 mean?** "No minimum configured." The code says so explicitly. It is a sentinel, not a business value.
- **Is the default tenant configuration valid?** Yes. Generation works; the deal carries a warning.
- **Should generation block?** **No.** Blocking on an unconfigured *guard rail* punishes a tenant for not having configured a guard rail, and would leave a brand-new workspace unable to quote anything.
- **Should validation require it earlier?** Yes — and that is the actual gap. A deal-level warning is read by a rep, who cannot change a company setting.

So it becomes a **workspace setup gap**, the mechanism this codebase already has for exactly this: a `silent`-severity item on the Settings hub beside lenders and per-battery rep pay. No business value invented, no generation blocked.

---

# Files Changed

60 files. Full list in `git diff --stat c83ddce`.

**New (19)** — `payroll/funding-authority.ts`, `solar/signed-lock.ts`, `solar/deal-money.ts`, `solar/unlock-actions.ts`, `components/portal/solar/signed-contract-lock.tsx`, `reports/solar-contract.ts`, `bookkeeping/reports-db.ts`, `api/bookkeeping/reports/route.ts`, `api/cron/file-signed-proposals/route.ts`, two migrations, and 9 test files + 1 e2e spec.

**Modified, by area** — reports (`rep-scorecard`, `lead-sources`), dashboard/bookkeeping (`queries`, `bookkeeping-client`, `paystub`, `post-bookkeeping`, `payroll/actions`), solar (`actions`, `adder-actions`, `equipment-actions`, `cockpit-actions`, `deal-value`, `vpp-credits`, `proposal-file-copy`, `providers`), leads/projects (`leads/actions`, `projects/actions`), settings (`workspace-health`), libs (`solar-deal-value`, `solar-provider-terms`), UI (`solar-cockpit`, `solar-provider-manager`, `leads/[id]/page`, `settings/solar-providers/page`), plus `solar/recompute.ts`, `payroll/solar-engine.ts`, `solar-proposal-builder.tsx`, `leads/[id]/solar-proposal/page.tsx`, `schema.prisma`, `vercel.json` and the backfill script.

---

# Database Migrations Added

**Two. Both additive. Nothing dropped, nothing rewritten, no backfill.**

**1 · `20260914000000_vpp_max_batteries`**

```sql
ALTER TABLE "solar_providers" ADD COLUMN "vppMaxBatteries" INTEGER;
```

Nullable — null means the house rule of six, the same convention every other optional rule on that table follows.

**2 · `20260914120000_solar_contract_unlock`**

```sql
CREATE TABLE "solar_contract_unlocks" ( ... );   -- + 1 index, 2 FKs, ON DELETE CASCADE
```

A new table; it touches nothing existing. Note the column is `"vertical"`, **not** `"industry"` — the solar tables use the literal name, which I verified against `solar_lenders` in the database rather than inferring from the `@@map` on the enum.

Both applied to the local dev and test schemas only. **Neither has been applied to production.**

---

# Authorization Changes

| Action | Before | After |
|---|---|---|
| `upsertSolarCommissionAction` — `paid` flag | `Lead:update` | `Commission:approve` |
| `upsertSolarCommissionAction` — amount/trigger/date | `Lead:update` | `Lead:update` (unchanged) |
| `upsertSolarCommissionAction` — entry | `Lead:update` | `Lead:update` **or** `Commission:approve` |
| `moveLeadStage` into/past the solar funding gate | `Lead:update` | `Commission:approve`, unless already funded |
| 8 solar economic actions, after signature | `Lead:update` | `super_admin` **with a live, reasoned unlock**, audited |
| `unlockSignedContractAction` (new) | — | `super_admin` only, reason ≥ 8 chars, 30-min window |
| `/api/bookkeeping/reports` (new) | — | `Bookkeeping:read` |
| `/api/cron/file-signed-proposals` (new) | — | `CRON_SECRET`, fails closed |

Verified by role: `sales_rep`, `canvasser`, `manager`, `admin`, `accounting`, `super_admin` — all driven through the server actions directly, not the UI.

---

# Financial Logic Changes

- **Revenue** on a solar deal is the contract, never the after-credit net. `Lead.value` still holds the net for the pipeline card; the two are now distinct.
- **Funding certification** is a separate authority from deal editing.
- **Payroll adjustments** post to the ledger with the correct sign, and reconcile against the amount actually paid.
- **VPP** is clamped to the programme's ceiling; the reported count is clamped with it.
- **Signed contracts** are immutable to everyone but a super admin who has opened a reasoned unlock, with a trail that names the reason, the actor, the time and both figures.
- **A deal's cached price** is refreshed by the same function that derives it, from every path that can move it — not only from the Financing step's Save.
- **The rep's estimated commission and payroll's** come from one resolver, so the deal page can no longer quote a figure payroll will refuse.

**No pricing formula was changed** — in this pass or the last. `priceStoredPurchase` is still the single authority on what a solar deal costs; what changed is how many places remember its answer, and how stale that memory is allowed to get. The 27 independent recalculations from the original audit still pass unchanged.

---

# Tests Added

**12 new test files.** The suite as a whole went from 2,126 unit / 527 integration at baseline to **2,165 unit / 628 integration**.

| File | Tests | Covers |
|---|---:|---|
| `lib/__tests__/solar-deal-value.test.ts` (extended) | 6 | contract vs net, ITC on/off, cash, lease, PPA, unpriced |
| `lib/__tests__/solar-vpp-cap.test.ts` | 22 | the full 0–100 table, negatives, NaN, strings, fractions |
| `payroll/__tests__/funding-authority.test.ts` | 11 | who may certify; the positional gate, on live's stage list |
| `reports/__tests__/solar-revenue.itest.ts` | 11 | job / no job, ITC, cash, lease, PPA, versions, roofing untouched |
| `payroll/__tests__/funding-gate.itest.ts` | 17 | every role, API bypass, un-funding by omission, cancel |
| `bookkeeping/__tests__/pnl-truncation.itest.ts` | 15 | 1,300-row ledger, bounds, isolation, segment reconciliation |
| `payroll/__tests__/ledger-posting.itest.ts` | 12 | all adjustment kinds, re-post, resumed partial post |
| `solar/__tests__/signed-lock.itest.ts` | 22 | six locked surfaces × four roles, unlock lifecycle + audit |
| `solar/__tests__/price-drift.itest.ts` | 9 | cache vs `priceStoredPurchase` on every path that moves a price |
| `payroll/__tests__/estimate-matches-payroll.itest.ts` | 8 | deal page and payroll agree, case by case |
| `solar/__tests__/deal-lifecycle.itest.ts` | 2 | one deal, proposal → ledger, in order |
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

P1-8 is **no longer open** — see the P1 section above.

---

# Remaining Risks

1. **Nothing has been applied to production.** Two migrations and one backfill are pending per environment:
   - `20260914000000_vpp_max_batteries` — additive, nullable; nothing breaks before it runs because the code reads `?? VPP_DEFAULT_MAX_BATTERIES`.
   - `20260914120000_solar_contract_unlock` — a new table; **the signed-lock override cannot be used until this runs**, and a super admin attempting to reopen a contract before then will hit a missing relation. Apply it with the deploy, not after.
   - `scripts/backfill-solar-deal-value.ts --apply` — every solar Project created before this work still holds the after-credit net. Dry-run by default, re-runnable, and the number to check afterwards is the dashboard's Team Performance against a known contract.

2. **The stage guard changes an operational workflow.** Pre-funding, a manager or coordinator can no longer move a solar deal to or past M1 Funding; the desk records M1 on the deal first, then the board moves. You confirmed this is what you want. It still matters that your coordinators hear it before the deploy rather than after, because to someone who has been dragging the card *as* the way of announcing that money arrived, a correct refusal is indistinguishable from a broken board.

3. **The 30-minute unlock window is a judgement, not a requirement you gave me.** Long enough to make a correction, short enough that a contract does not sit quietly editable for a day. A super admin can close it early, and it expires by itself. If your corrections routinely involve a phone call to the lender, say so and I will lengthen it — it is one constant.

4. **`recomputeDealMoney` now runs on every design change.** It is one indexed read plus a conditional write, and it writes nothing when nothing moved, so the cost is a read on the paths that already do several. But it is new work on a hot path, and the honest statement is that I have measured it as correct rather than as fast.

5. **Automations are deliberately NOT gated by the funding authority.** The starter automation set moves Installed → Inspection, which crosses the M1 gate. A rule engine acting as the company is not a rep acting as themselves, so this is intentional — but it does mean an automation could carry a deal past the gate. If you ever add a rule that a rep can trigger on demand, that reasoning stops holding.

6. **Two pre-existing integration failures remain red** on main — `calendar/visit-crew`, `solar/battery-pricing`. Re-proven not mine by running both on a detached checkout of the `c83ddce` baseline, where they fail on the same assertions with the same values. Not investigated; they were out of scope both passes.

7. **The shared tree is still behind main with a broken build.** Not mine to fix, and I did not touch it. Whoever owns it should rebase. Related: the `warn`→`block` change on `config.min_offset_unset` sitting uncommitted in a sibling tree must not ship as written — `minOffsetPct` ships at `0`, so it would leave every default workspace unable to generate any proposal.

8. **`origin/main` has advanced 21 commits since `c83ddce`.** I stayed on my baseline deliberately so every before/after claim in these documents is measured against one fixed point. Rebasing onto current main before merge is a real step with a real chance of conflict, and it has not been done.

---

# Recommended Next Phase

1. **Rebase onto current `origin/main`** (21 commits ahead of my baseline) and re-run the sweep.
2. **Merge**, apply *both* migrations, run the backfill per environment, then re-check the dashboard's Team Performance against a known contract.
3. **P2-5 and P2-6** — the orphan FKs and the `activity_logs` index. Cheap, and the index gets more valuable every day.
4. **P2-1** — the equipment summary on Review & Send. Small, visible, and it was an explicit ask.
5. **P2-4 and P2-10** — the two idempotency races (customer signing, chargeback recovery).
6. **Tell the sibling session** that the `warn`→`block` change on `config.min_offset_unset` must not ship as written.

---

# Decisions You Made, and What I Did With Them

All three questions from the last pass are answered and implemented. Recorded here so the reasoning survives the conversation.

**1 · The stage guard — you said keep it strict.** Reps and ordinary coordinators cannot declare M1 funding; `super_admin`, `admin` and `accounting` can. Implemented exactly, and with the part you added: once funding is legitimately recorded, the gate stops applying, so ops users carry the deal through Inspection and PTO as before. `crossesFundingGate` returns false for a deal already funded, which is what makes the guard a gate rather than a wall. The lifecycle test pins both halves — the rep refused on *both* the stage move and the milestone, their manager refused too, accounting succeeding, and the board moving freely afterwards.

**2 · Changes after signature — you said keep the lock, but require a reason.** Done, and done once per sitting rather than once per field. A super admin opens a `SolarContractUnlock` carrying the reason; every protected write under it cites that reason on the deal's history beside the old and new value, and the unlock row is expired rather than deleted on the way out. Your four example reasons are offered as editable suggestions rather than a fixed menu, because the useful reasons are specific — "lender corrected the fee to 22%" tells a later reader something "Pricing correction" does not.

Two details worth flagging because they are stricter than what you asked for. First, `super_admin` alone no longer bypasses the lock — the role plus a live unlock does. A permanent key held by a role is not an exception anyone can later audit. Second, the reason is collected **before** the edit, not after; a reason gathered afterwards is a justification rather than a decision.

**3 · VPP — you said keep it provider-level, default 6.** Unchanged from the last pass, which is the answer: `vppMaxBatteries` is a nullable per-provider column and null means six. The standard rule works out of the box with no provider configured, and a provider that publishes different terms is data rather than a code change. `solar-vpp-cap.test.ts` pins your three figures exactly — 2 batteries → $400, 6 → $1,200, 7 → $1,200 — inside a table that walks 0 through 100.
