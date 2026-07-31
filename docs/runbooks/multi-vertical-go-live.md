# Go-live runbook — Multi-vertical (Roofing + Solar)

Staged rollout for `feat/multi-vertical`. Every step is copy-pasteable.

**The whole design is that nothing changes for Roofing until you deliberately
flip one environment variable.** Steps 1–5 put the code and schema in
production with Solar switched off and Roofing behaving exactly as it does
today. Step 7 is the only step that changes what anyone sees.

| Step | What it does | Reversible? | User-visible change |
|---|---|---|---|
| 1 | Back up the database | — | none |
| 2 | Run migrations (deploy-safe) | yes | none |
| 3 | Deploy code, flag OFF | yes | none |
| 4 | Verify Roofing unchanged | — | none |
| 5 | Review who gets Solar | — | none |
| 6 | Drop legacy uniques | yes* | none |
| 7 | **Flip the flag on** | yes | Solar appears |

\* see [Rollback](#rollback) for what changes once the flag has been on.

---

## Why deploying with the flag OFF leaves Roofing byte-for-byte unchanged

Three independent reasons, all verifiable:

1. **The isolation extension short-circuits.** The first line of the query
   handler is `if (!solarVerticalEnabled()) return query(args)` — the query is
   handed back untouched, so no filter is added and no write is stamped.
   (`src/server/vertical/extension.ts`)

2. **The rename emitted no DDL.** `Vertical` is `@@map("Industry")` and every
   `vertical` field is `@map("industry")`. The enum, all 7 column renames and
   all 6 index renames produce **zero SQL** — verified with `prisma migrate
   diff`. Old and new code read the same physical columns.

3. **The suite proves it.** A full Playwright run with the flag off matches the
   recorded pre-work baseline **spec for spec**:

   | | flag OFF | flag ON |
   |---|---|---|
   | passed | 65 | 70 |
   | failed | 24 | 24 |
   | failure set | identical to baseline | identical to flag-off |

   The 24 failures are all pre-existing on `main` before any of this work — see
   `docs/` notes and the PR description. No test that passed before now fails.

---

## Step 1 — Back up production BEFORE anything

```bash
# Pull production env (writes .env.production.local — do not commit it)
vercel env pull --environment=production .env.production.local

# Take the migration/session-pooler URL (port 5432, NOT the 6543 txn pooler),
# strip the query string, and add sslmode=require.
#   ...@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require
export PROD_MIGRATE_URL='postgresql://postgres.<ref>:<pw>@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require'

# Sanity: you are pointed at production and it responds.
psql "$PROD_MIGRATE_URL" -tAc "select current_database(), now();"

# Logical backup.
pg_dump "$PROD_MIGRATE_URL" --no-owner --no-acl -Fc \
  -f "anexa-prod-$(date +%Y%m%d-%H%M).dump"
ls -lh anexa-prod-*.dump      # confirm it is a sensible size, not 0 bytes
```

**Also take a Supabase PITR snapshot** (Dashboard → Database → Backups) so you
have a point-in-time restore independent of the dump file.

> The transaction pooler on **:6543** will fail or silently no-op DDL. Migrations
> and `pg_dump` must use the **session pooler on :5432**, with the query string
> stripped and `?sslmode=require` added. A malformed URL makes `migrate deploy`
> report success while doing nothing — always verify with Step 2's check query.

---

## Step 2 — Run the migrations

**This is safe to run while the current production code is still serving.** The
five migrations are additive: new columns all carry defaults, new tables are
unreferenced by the running build, and the old narrow unique indexes are
deliberately left in place because the currently-deployed code still upserts
against them.

```bash
cd anexa-homes
DATABASE_URL="$PROD_MIGRATE_URL" npx prisma migrate status
```

You should see 5 pending:

```
20260730120000_multi_vertical_foundation
20260730130000_isolation_boundary_flags
20260730150000_solar_pipeline_sla
20260730170000_solar_domain
20260730190000_solar_proposal
```

`20260730200000_drop_legacy_uniques` is **also pending and must NOT run yet** —
see Step 6. Hold it back:

```bash
mkdir -p /tmp/hold
mv prisma/migrations/20260730200000_drop_legacy_uniques /tmp/hold/

DATABASE_URL="$PROD_MIGRATE_URL" npx prisma migrate deploy

mv /tmp/hold/20260730200000_drop_legacy_uniques prisma/migrations/
```

### Verify the migration actually applied

`migrate deploy` can report success against a malformed URL. Check the database
itself:

```bash
psql "$PROD_MIGRATE_URL" -tAc "
select count(*) || ' tables have a vertical column (expect 21)'
from information_schema.columns
where column_name='vertical' and table_schema='public';"

psql "$PROD_MIGRATE_URL" -tAc "
select string_agg(table_name, ', ' order by table_name) as new_tables
from information_schema.tables
where table_schema='public'
  and table_name in ('solar_settings','solar_equipment','solar_designs',
                     'solar_finance','credit_applications','solar_proposals',
                     'solar_proposal_events');"

-- Both old AND new uniques must be present at this point.
psql "$PROD_MIGRATE_URL" -tAc "
select indexname from pg_indexes
where schemaname='public' and indexname like 'lead_sources_companyId%'
order by 1;"
-- expect BOTH:
--   lead_sources_companyId_name_key            <- old code uses this
--   lead_sources_companyId_vertical_name_key   <- new code uses this

psql "$PROD_MIGRATE_URL" -tAc "
select migration_name from _prisma_migrations
where migration_name like '202607301%' or migration_name like '202607309%'
order by migration_name;"
```

If the `vertical` column count is 0, the URL was wrong. Fix it and re-run —
nothing was applied.

---

## Step 3 — Deploy the code, flag OFF

**Do not set `SOLAR_VERTICAL_ENABLED`.** Unset is off.

```bash
# Confirm it is not already set anywhere.
vercel env ls production | grep -i solar_vertical || echo "not set — correct"
```

Then merge the PR (or push `feat/multi-vertical` to `main`, which is the Vercel
production branch). Watch the deployment to "Ready".

While you are there, note two env vars that are intentionally inert:

- `LENDER_WEBHOOK_SECRET` — unset means the lender webhook **401s every
  request**. It fails closed on purpose; set it only when you are ready to give
  the value to a lender.
- The federal tax-credit percentage is **not** an env var. It lives in Solar
  Settings and is unset by default, so no proposal shows a credit until your CPA
  enters one.

---

## Step 4 — Verify Roofing is unchanged

Log in as `admin@anexahomes.com` and walk these. Every one should look and
behave exactly as it did before the deploy.

| Check | Expected |
|---|---|
| Top bar | **No workspace switcher.** No accent strip under the header. |
| `/portal/dashboard` | Header reads "… · Roofing workspace". Counts match yesterday's. |
| `/portal/leads` | All roofing appointments present, same count as before. |
| `/portal/pipeline` | Roofing stages only (Adjuster Meeting, Scope Received, Supplement Needed…). No solar stages. |
| Open any deal | Tabs are Overview · Scope of Work · Production · Financials · Documents. **No** System Design / Proposal / Financing tabs. |
| Deal → Overview | Claim card present. No "Operations" / blocker card. |
| Deal → Production | "Aerial roof measurements" + Build Roof Report present. |
| `/portal/settings` | **No** "Solar Settings" or "Solar Equipment" cards. |
| `/portal/settings/pipeline` | Day-limit boxes on every stage (no "chase Nd" pills). |
| `/portal/bookkeeping` → Profit & Loss | No "By department" table (it only renders with >1 department). |
| `/portal/reports` | Loads; figures match yesterday. |
| Canvassing → convert a knock to a lead | **Works.** This is the path that would break if the legacy uniques had been dropped early. |
| `/portal/commissions`, `/portal/payroll` | Unchanged. |

Spot-check the database is still coherent:

```bash
psql "$PROD_MIGRATE_URL" -tAc "
select industry, count(*) from leads group by 1 order by 1;"
-- expect: roofing = your full lead count, and NO other rows
```

**If anything here differs, stop and go to [Rollback](#rollback).** You have
changed nothing user-visible yet, so rolling back is cheap.

---

## Step 5 — Review who would get Solar access

Run this **read-only** query and decide, per person, whether the grant is
intentional. Accounts created under the old default inherited Solar; that is a
business decision, not a code one.

```sql
-- Who currently has 'solar' in their grants?
SELECT
  email,
  role,
  status,
  industries        AS grants,
  "employeeNo",
  "lastLoginAt"
FROM users
WHERE 'solar' = ANY(industries)
  AND "deletedAt" IS NULL
ORDER BY role, email;
```

```sql
-- The whole roster, for context.
SELECT
  industries AS grants,
  count(*)   AS people,
  string_agg(email, ', ' ORDER BY email) AS who
FROM users
WHERE "deletedAt" IS NULL
GROUP BY industries
ORDER BY people DESC;
```

To remove Solar from someone before flag-on:

```sql
UPDATE users
   SET industries = array_remove(industries, 'solar'::"Industry")
 WHERE email = 'person@anexahomes.com';
```

Notes:
- The **super admin always sees every vertical** regardless of grants, by
  design — an owner locked out by a stale grant list is a support incident.
- New users default to **Roofing only**.
- The retired `others` value was already stripped from every grant by migration
  1 and can never be selected.

---

## Step 6 — Drop the legacy unique indexes

Only after Step 4 passes and the new code is live.

```bash
DATABASE_URL="$PROD_MIGRATE_URL" npx prisma migrate deploy   # applies 20260730200000

psql "$PROD_MIGRATE_URL" -tAc "
select indexname from pg_indexes
where schemaname='public' and indexname like 'lead_sources_companyId%';"
-- expect ONLY: lead_sources_companyId_vertical_name_key
```

This is required before Solar can have a lead source, custom field or pipeline
sharing a name with a Roofing one. Until it runs, Roofing is unaffected either
way.

---

## Step 7 — Flip the flag on

Nothing before this point changes what anyone sees. This does.

```bash
# Set it, then redeploy so the new env is picked up.
vercel env add SOLAR_VERTICAL_ENABLED production
# paste when prompted:  1

vercel --prod
```

Or in the dashboard: Project → Settings → Environment Variables → Add
`SOLAR_VERTICAL_ENABLED = 1` (Production) → then Redeploy.

### Immediately after flipping

1. Log in as the owner. The **workspace switcher** appears top-right with an
   accent strip under the header.
2. Stay in **Roofing** and re-run the Step 4 checks. Roofing must still be
   correct with the flag on — this is the real test.
3. Switch to **Solar**: empty deal list, the 25-stage NTP→PTO pipeline, and
   Solar Settings / Solar Equipment in Settings.
4. Set the federal credit percentage (Settings → Solar Settings) once your CPA
   has confirmed it. Until then no proposal shows a credit line at all.
5. Seed the Solar pipeline for real use — the canonical stages are created for
   new companies by the seed, but an existing production company needs its Solar
   pipeline created once. If `/portal/pipeline` in Solar is empty, create it in
   Settings → Pipeline Stages while in the Solar workspace.

### Turning it back off

```bash
vercel env rm SOLAR_VERTICAL_ENABLED production
vercel --prod
```

Instant and safe. It changes no data — only whether scoping is enforced and
whether Solar is reachable. Any solar rows already created simply become
invisible; they are not deleted.

---

## Rollback

### Before the flag has been on

Fully reversible.

```bash
# 1. Revert the code: redeploy the previous production deployment in Vercel,
#    or revert the merge commit and push.

# 2. Then unwind the schema, newest first.
cd anexa-homes
for m in 20260730200000_drop_legacy_uniques \
         20260730190000_solar_proposal \
         20260730170000_solar_domain \
         20260730150000_solar_pipeline_sla \
         20260730130000_isolation_boundary_flags \
         20260730120000_multi_vertical_foundation; do
  echo "== $m"
  psql "$PROD_MIGRATE_URL" -f "prisma/migrations/$m/down.sql"
  psql "$PROD_MIGRATE_URL" -c \
    "DELETE FROM _prisma_migrations WHERE migration_name = '$m';"
done
```

**Deploy the old code FIRST, then run the down migrations.** The renames emitted
no DDL, so pre-change code reads these tables correctly the moment it is live.

You can also stop after step 1: the old code runs perfectly against the migrated
schema (that is exactly the Step 2–3 window), so reverting the code alone is a
complete and sufficient rollback. Unwinding the schema is optional tidying.

### After the flag has been on

| Safe to roll back | Not safe |
|---|---|
| The flag itself — off is instant, loses nothing | `20260730200000_drop_legacy_uniques`, once Solar has a lead source / custom field / pipeline sharing a Roofing name. Recreating the narrow index will fail on the duplicate. |
| The code deploy | Dropping the solar tables, once real solar deals exist — that is data loss, not a rollback. |
| `20260730130000_isolation_boundary_flags` | `20260730120000_multi_vertical_foundation`, once any row has `vertical='solar'`. Dropping the column silently merges those rows into Roofing. |

**Rule of thumb: once a real solar deal exists, roll _forward_.** Turn the flag
off to hide Solar, fix the problem, turn it back on. The flag is the rollback.

The `others` values removed from `users.industries` in migration 1 are not
restored by its `down.sql` — the value is retired and the old code filtered it
out anyway, so restoring it would grant access to a workspace that no longer
exists.

---

## Quick reference

| Thing | Value |
|---|---|
| Feature flag | `SOLAR_VERTICAL_ENABLED` (unset/`0` = off, `1` = on) |
| Lender webhook secret | `LENDER_WEBHOOK_SECRET` (unset = endpoint 401s everything) |
| Federal tax credit | **Not** an env var — Solar Settings, unset by default |
| Migration URL | session pooler **:5432**, query string stripped, `?sslmode=require` |
| App `DATABASE_URL` | txn pooler **:6543**, `?pgbouncer=true&connection_limit=10&pool_timeout=20` |
| Architecture note | `docs/architecture/vertical-isolation.md` |
