# Anexa Solar QA — Fix Progress

**Baseline:** `origin/main` @ `c83ddce` — "feat(solar): System info becomes Operations, one tab per step of the job"
**Working branch:** `qa/solar-p0p1-fixes`
**Worktree:** `/Users/mustafajoulani/Desktop/anexa-qa-fixes-wt` (isolated — the shared tree at `anexa-homes/` is untouched)
**Baseline test state:** 137 files / 2,126 tests, all passing.

## Why an isolated worktree

Five sibling Claude sessions are live in the shared tree and three were actively writing during Phase 0. That tree is also 9 commits behind `origin/main` while carrying a large uncommitted copy of work that has since been merged to main — including a half-finished refactor that leaves the app unable to compile (`page.tsx` importing the deleted `solar-system-info.tsx`).

Editing there would have meant building fixes on a stale base, racing three writers, and inheriting a broken build. A worktree off `origin/main` gives the exact deployable baseline the brief asks for and guarantees no sibling change is overwritten. Its own `node_modules` was installed rather than symlinked (a symlinked one inherits the sibling's Prisma client and 500s every page).

## Phase 0 — re-verification against `origin/main` @ `c83ddce`

Every issue re-checked in the clean tree. **None had been fixed by another session.**

| ID | Issue | Still present? | Evidence |
|---|---|---|---|
| P0-1 | Solar revenue reads `Project.contractValue` | ✅ yes | `reports/rep-scorecard.ts:33,65`; `dashboard/queries.ts:61,94` |
| P0-2 | Rep can self-satisfy the M1 commission gate | ✅ yes | gate `payroll/actions.ts:65`; setter `solar/cockpit-actions.ts:57` guarded only by `Lead:update` |
| P0-3 | P&L truncates at 1,000 transactions | ✅ yes | `bookkeeping/queries.ts:116` `take: 1000`, period applied at `:208` |
| P1-1 | Payroll adjustments never reach the ledger | ✅ yes | 0 adjustment references in `payroll/post-bookkeeping.ts` |
| P1-2 | No post-signature price lock | ✅ yes | 0 `signedAt` references in `solar/actions.ts` |
| P1-3 | Pay-stub email calls gross "Net pay" | ✅ yes | `payroll/actions.ts:423,462` |
| P1-5 | VPP has no 6-battery / $1,200 cap | ✅ yes | `solar/vpp-credits.ts:134`, no clamp; `:45` floors a negative to 1 |
| P1-7 | Two signed PDFs filed only when an admin opens the deal | ✅ yes | `proposal-public.ts:261` approves without filing |

## Status board

| ID | Issue | Status |
|---|---|---|
| P0-1 | Solar revenue reporting | **VERIFIED** — `db977e8` |
| P0-2 | M1 commission gate authority | **VERIFIED** — `3d3bf22` |
| P0-3 | P&L transaction truncation | **VERIFIED** — `d31b039` |
| P1-1 | Payroll adjustments → ledger | **VERIFIED** — `74365c9` |
| P1-2 | Post-signature price lock | **VERIFIED** — `04e7be3` |
| P1-3 | Pay-stub email net pay | **VERIFIED** — `74365c9` |
| P1-5 | VPP rebate cap | **VERIFIED** — `141da8b` |
| P1-7 | Signed PDFs filed at signing | **VERIFIED** — `ff46423` |
| P1-4 | Adjustment-only payee gets no stub *(found en route)* | **VERIFIED** — `74365c9` |
| P1-6 | Cached contract price drift | **VERIFIED** — `2cc3f92` |
| P1-8 | Deal-page estimate vs payroll | **VERIFIED** — `f10dfe4` |
| — | Signed lock: UI gating + super-admin reason workflow | **VERIFIED** — `e3687f2` |
| — | Whole-journey lifecycle regression | **VERIFIED** — `c3a7716` |
| — | `config.min_offset_unset` default | **VERIFIED** — `b8f3441`; not a bug on main |
| — | §35 client-side errors | **VERIFIED** — clean |
| — | §36 responsive UI | **VERIFIED** — clean at 4 widths, `33d569f` |

Legend: NOT STARTED → REPRODUCED → ROOT CAUSE CONFIRMED → FIXED → TESTED → VERIFIED

## Out of scope, by instruction

Not to be recreated — repository history shows deliberate removal:
- Participate global add-on / two-price model (removed 2026-09-09, `80bf7b2`)
- M2 funding (never modelled; `SolarMilestone` deliberately reduced to one row)
- Deal-level fraud flag (chargebacks cover the rep-caused cases)
- Reviews (removed 2026-09-12, migration `20260912090000_drop_reviews`)

## Log

- Phase 0 complete. Worktree created, deps installed, baseline green at 2,126 unit tests. All 8 issues reproduced as still-present.
- Integration baseline measured separately: **2 pre-existing failures** on pristine `origin/main`
  (`calendar/visit-crew.itest.ts`, `solar/battery-pricing.itest.ts`). Confirmed by stashing all my
  work and re-running. They are not mine and I have not touched them.
- P0-1 FIXED (`db977e8`) — 6 unit + 11 integration tests.
- P0-2 FIXED (`3d3bf22`) — 11 unit + 17 integration tests. Found a second defect while fixing it:
  an omitted `paid` flag silently un-funded the deal on every save.
- P0-3 FIXED (`d31b039`) — 15 integration tests over a 1,300-row ledger.
- P1-1 + P1-3 + P1-4 FIXED (`74365c9`) — 12 integration tests. Found that idempotency was
  per-run, which locked out recovery from a partial post.
- P1-5 FIXED (`141da8b`) — 22 unit + 5 integration. One migration.
- P1-2 FIXED (`04e7be3`) — 15 integration tests across six locked surfaces and four roles.
- P1-7 FIXED (`ff46423`) — 11 integration tests; cron sweep every 10 minutes.
- min-offset investigated (`b8f3441`) — NOT a bug on main; the block is sibling-tree-only and
  would break every default workspace. Surfaced as a Settings gap instead.
- §35 clean. §36 automated (`33d569f`) and green at 1440/1280/768/390, three consecutive runs.
- Final: 2,165 unit / 600 integration (2 pre-existing failures) / 5 e2e. Typecheck clean.
  Lint identical to base — zero regression.
- **Phase 3, on the business decisions given.**
- P1-6 FIXED (`2cc3f92`) — the derivation that priced a deal on save lived inline in
  `saveSolarFinanceAction`, so every OTHER way of changing a deal (equipment picker, layout
  designer, design save, live re-price, adder edit, lender switch, system-type switch) left the
  cached columns behind. Extracted verbatim to `solar/deal-money.ts` and called from the
  `recompute.ts` chokepoint. **Extracted, not reimplemented** — one derivation, not two.
  9 integration tests, each deriving the expected figure independently rather than asserting a
  number I chose.
- P1-8 FIXED (`f10dfe4`) — the deal page and payroll carried separate copies of the pay-terms
  precedence chain, and disagreed on the case that matters most: a signed deal with no frozen
  terms. Payroll refused it; the deal page quoted the rep's current profile and showed a confident
  figure payroll would never pay. Both now call `resolveDealPayTerms`. The estimate also gained
  layer 2 of the chain (an existing commission line), which it had never read. 8 integration
  tests, every one asserting the two answers are *the same answer*.
- Signed-lock UI FIXED (`e3687f2`) — the server already refused protected writes on a signed
  contract; the screen still showed editable controls that failed on save. The builder now goes
  read-only behind a banner that says why, and a super admin gets a real door: `SolarContractUnlock`
  records who reopened it, when, why, and until when, and every edit made under it cites the reason
  on the deal's history beside the old and new value. Reason required, minimum 8 characters,
  30-minute window. One migration. Suite grew 15 → 22 tests.
- Lifecycle regression added (`c3a7716`) — one deal walked from proposal to ledger in order.
  Pins the $56,000 contract through eleven steps, and pins that a rep is refused on both the stage
  move and the milestone while accounting succeeds.
- Lint cleanup (`1f6c02b`) — removed the seven imports the P1-6 extraction orphaned.
- **17 commits, 60 files, 12 new test files. Nothing pushed, merged or deployed.**
- Final sweep: **2,165 unit passing** (139 files), **626 integration passing** of 628 — the 2
  failures are `calendar/visit-crew` and `solar/battery-pricing`, re-proven pre-existing by
  re-running both on a detached checkout of the `c83ddce` baseline, where they fail on the same
  assertions with the same values. Typecheck clean. Lint: the only error I introduced was a
  `prefer-const` in my own fixture, now fixed; the one error in a file I touched
  (`bookkeeping-client.tsx`) is byte-identical to baseline and belongs to an effect I never
  edited.
- E2E run **three times** — once on `c83ddce`, twice on this branch, solar flag ON throughout.
  Baseline 220 passed / 31 failed; this branch 227 passed / 29 failed. **27 failures are common to
  all three runs** (the project's own backlog); 7 churn between runs. Six of the churning ones are
  pre-existing flakes. The seventh was mine — `responsive-solar` desktop, a null
  `document.documentElement` mid-navigation — fixed at cause in `0f6632a` and green 5/5 after.
- `solar-adders:180` was chased rather than dismissed, because it is exactly the code P1-6 touched:
  passes 3/3 in isolation, and `resolveAdderTotal`'s no-lines branch returns the stored figures
  `recomputeAdderTotal(force:true)` has already written, so the two cannot disagree.
