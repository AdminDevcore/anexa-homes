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
| P1-6 | Cached contract price drift | **PARTIALLY FIXED** — `db977e8`; see Remaining Risks |
| P1-8 | Deal-page estimate vs payroll | **NOT FIXED** — out of scope, one-line fix documented |
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
- **11 commits, 46 files, 119 new tests. Nothing pushed, merged or deployed.**
