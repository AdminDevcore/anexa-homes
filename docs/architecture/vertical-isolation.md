# Vertical isolation — how it works

Anexa runs two lines of business out of one portal: **Roofing** and **Solar**.
They share a company, an employee roster and a general ledger. They share nothing
else.

This note explains how that separation is enforced, and why it is enforced where
it is.

---

## The problem with scoping in queries

The obvious way to isolate two workspaces is to add `where: { vertical }` to
every query. The codebase has **~930 `prisma.*` call sites**. That approach fails
the moment someone writes the 931st and forgets — and the failure is silent: a
solar rep sees roofing deals, and nothing errors.

Isolation here is treated as a **correctness property**, not a UI filter. The
rule is: *a query cannot forget the filter, because it never applies the filter
itself.*

## Where it is enforced

A single **Prisma client extension** (`src/server/vertical/extension.ts`) wraps
the model API in `src/server/db/client.ts`. Every `prisma.<model>.<op>()` in the
app passes through it, including calls written in future.

For a vertical-scoped model it:

| | behaviour |
|---|---|
| reads (`findMany`, `findUnique`, `count`, `aggregate`, `groupBy`, …) | injects `where.vertical = <active>` |
| writes (`create`, `createMany`, `update`, `upsert`, …) | stamps `data.vertical = <active>` |
| nested writes (`{ project: { create: … } }`) | walks the payload via the DMMF relation graph and stamps each scoped child |
| an explicit disagreeing `vertical` in `where` or `data` | throws `CrossVerticalAccessError` |
| no resolvable vertical | throws `MissingVerticalContextError` |

The extension inherits into `$transaction()` — both the array and interactive
forms — which is asserted directly in the test suite rather than assumed.

### What it deliberately does not cover

`$queryRaw` / `$executeRaw` bypass the model API entirely. There is **one** raw
statement in the repo (a `TRUNCATE` in the seed) and it is not a scoped query.
Two guards keep it that way:

* an eslint rule (`no-restricted-syntax`) over `src/**`
* `src/lib/__tests__/no-raw-sql.test.ts`, which also scans `prisma/`, `scripts/`
  and `e2e/` — directories eslint does not lint — against a reviewed allowlist

Both have been verified to fail on a planted violation.

## How the active vertical is resolved

`src/server/vertical/context.ts`, in priority order:

1. **An explicit override** — `runInVertical(v, fn)` / `runUnscoped(reason, fn)`.
   This is how code with no HTTP request declares intent: cron jobs, the website
   intake action, public token pages (`/sign`, `/present`, `/bid`), seeds and
   tests.
2. **The request's session + workspace cookie** — covers every portal server
   component, server action and route handler, i.e. the vast majority of call
   sites, with no code change at all.

If neither resolves, a scoped model throws rather than guessing. Guessing is how
data crosses workspaces.

> **The `await` in `runInVertical` is load-bearing.** Prisma promises are lazy —
> they do not touch the database until subscribed to. Returning `fn()` without
> awaiting it would let `AsyncLocalStorage.run()` exit before the query ran, and
> the query would execute with an empty context: silently unscoped. This was a
> real bug, caught by the `$transaction` tests.

AsyncLocalStorage is used **only** for the explicit override, never as the
primary path, so nothing depends on ALS propagating across React Server
Component boundaries.

## The isolation boundary

Defined in one place: `src/server/vertical/models.ts`.

**SCOPED** (24 models) — reads filtered, writes stamped, cross-vertical is a hard
error. Deals, projects, claims, pipelines, tasks, every config table, the scope
catalog, proposals, contracts, territories and knocks.

**TAGGED** (4 models) — writes stamped, reads *never* filtered: `Transaction`,
`Commission`, `Invoice`, `ProjectCost`. One company, one general ledger. Every
row carries its vertical so the P&L, commissions and reports break out by
department and still reconcile to a consolidated total. The column is nullable
because genuinely company-level rows (office rent) belong to no vertical.

**SHARED** (everything else) — one employee roster, one login per person, one
chat, one payroll run, one set of website reviews.

Child tables are absent by design: they carry no `companyId` and are always
reached through a scoped parent (`PipelineStage` via `Pipeline`, `ClaimLineItem`
via `Claim`, `FileAsset`/`Note` via `Lead`). Scoping the parent scopes them.

`CompanySettings.isolateBooks` / `.isolateTeam` are the documented extension
point for splitting books or roster fully later — promote the TAGGED models to
SCOPED. Nothing reads them yet, by design.

## Config isolation

Three `CompanySettings` JSON columns (appointment outcomes, inspection outcomes,
the production QC checklist) were single shared blobs — exactly the shared
mutable config the isolation work exists to prevent.

`src/lib/vertical-config.ts` namespaces them per vertical, backwards
compatibly, so no data migration was needed:

```
legacy   [ "Damage confirmed", … ]           → that IS roofing's list
scoped   { roofing: [ … ], solar: [ … ] }    → per-vertical
```

A legacy bare array reads as roofing's config and as *absent* for any other
vertical, so Solar starts from its own defaults instead of inheriting roofing's.
Writes replace only the active vertical's slice; every other vertical is carried
through untouched.

## Naming: `vertical` in code, `industry` in Postgres

The schema already had a half-built `Industry` enum from an earlier
three-workspace build. Rather than run rename DDL against a live database, the
rename is expressed entirely through Prisma `@map`:

```prisma
enum Vertical { roofing solar others  @@map("Industry") }
model Lead    { vertical Vertical @default(roofing) @map("industry") }
```

Verified with `prisma migrate diff`: the enum rename, all seven column renames
and all six index renames emit **zero DDL**. Old and new code read the same
physical columns, so the migration never has to be sequenced against a deploy,
and a rollback is safe to take at any moment.

`others` is retired. It remains in the Postgres type so historical rows validate,
but it is excluded from `VERTICALS`, rejected by `isActiveVertical()`, stripped
from grant lists by `allowedVerticals()`, rejected by the team-grant zod schema,
and absent from the switcher. It cannot be selected, switched to, or written.

## Adding a third vertical

1. Add the value to `enum Vertical` and to `VERTICALS` in `src/lib/vertical.ts`.
2. Seed its pipeline and config.

No schema rework, no new columns, no call-site changes.

## The feature flag

`SOLAR_VERTICAL_ENABLED` (see `.env.example`).

**Off (default):** the extension returns every query untouched, the switcher does
not render, Solar is unreachable. The roofing code path is byte-for-byte the one
that shipped before this work — which is what makes "provably regression-free" a
claim that can be demonstrated by running the suite with the flag off and
matching the recorded baseline, rather than merely asserted.

**On:** scoping is enforced; users granted Solar see the switcher.

Reversible at any time. It changes no data at rest — only whether scoping is
enforced.

## Tests

* `pnpm test` — unit suite, includes the raw-SQL guard and the retired-vertical
  and config-namespacing contracts.
* `pnpm test:integration` — DB-backed isolation suite against an isolated
  `vertical_test` schema. Proves read filtering, write stamping, cross-vertical
  rejection, `$transaction` (both forms, including rollback on violation),
  nested writes, tagged-model consolidation, the escape hatches, and the
  flag-off inert path.
