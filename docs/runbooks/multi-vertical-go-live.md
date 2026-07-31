# Go-live runbook — Multi-vertical (Roofing + Solar)

Staged rollout for `feat/multi-vertical`. Every step is copy-pasteable.

**The whole design is that nothing changes for Roofing until you deliberately
flip one environment variable.** Steps 1–3 rehearse the whole thing without
touching production at all. Steps 4–8 then put the code and schema into
production with Solar switched off and Roofing behaving exactly as it does
today. **Step 9 is the only step that changes what anyone sees.**

| Step | What it does | Gate | Touches prod? | User-visible change |
|---|---|---|---|---|
| 1 | Back up production | | read only | none |
| 2 | **Prove the backup restores** | **required** | no | none |
| 3 | **Human smoke test on staging, flag ON** | **required** | no | none |
| 4 | Run migrations (deploy-safe) | | yes | none |
| 5 | Deploy code, flag OFF | | yes | none |
| 6 | **Verify Roofing unchanged** | **required** | yes | none |
| 7 | **Review AND clean Solar grants** | **required** | yes (targeted UPDATE) | none |
| 8 | Drop legacy uniques | | yes | none |
| 9 | **Flip the flag on** | | yes | Solar appears |

Steps 2, 3, 6 and 7 are **gates, not checks** — do not proceed past a failing
one. Step 7 is the last gate before the flip: **the flag does not go on until
grants are clean and re-verified.** Steps 1–3 touch no production infrastructure at all: you learn whether the
whole Solar flow works before production is modified in any way.

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
have a point-in-time restore independent of the dump file. Confirm it exists and
note the timestamp:

```bash
# Requires the Supabase CLI, logged in and linked to the project.
supabase projects list                       # confirm the ref you expect
supabase db dumps list --project-ref <ref>   # newest entry should be from today
```

If the CLI is not set up, take the screenshot route: Dashboard → Database →
Backups, confirm today's date appears, and note the exact timestamp here:

```
PITR snapshot taken at: ____________________  (fill this in)
Dump file:              anexa-prod-____________.dump
```

> `pg_dump` must be at least the server's major version or it will refuse.
> Check with `pg_dump --version` against `psql "$PROD_MIGRATE_URL" -tAc "show
> server_version;"`. On macOS: `brew install postgresql@16` and use
> `/opt/homebrew/opt/postgresql@16/bin/pg_dump`.

> The transaction pooler on **:6543** will fail or silently no-op DDL. Migrations
> and `pg_dump` must use the **session pooler on :5432**, with the query string
> stripped and `?sslmode=require` added. A malformed URL makes `migrate deploy`
> report success while doing nothing — always verify with Step 4's check query.

---

## Step 2 — Prove the backup restores  **[REQUIRED GATE]**

A backup you have never restored is a hope, not a backup. This step converts it
into a verified artifact *and* produces the staging database Step 3 needs — one
operation, two jobs.

### 2a. One-line readability check

Cheapest possible signal that the dump is not truncated or corrupt:

```bash
pg_restore --list anexa-prod-YYYYMMDD-HHMM.dump | wc -l
# expect several hundred lines. 0 or an error = the dump is unusable, STOP.
```

```bash
# Confirm the tables you care about are actually in there.
pg_restore --list anexa-prod-YYYYMMDD-HHMM.dump \
  | grep -E "TABLE DATA public (leads|projects|users|companies) " \
  || echo "!! core tables missing from the dump — STOP"
```

### 2b. Full restore into a scratch database

Create an empty Postgres database to restore into. Either a second Supabase
project, or local Docker — local is faster and free:

```bash
docker run -d --name anexa-staging -e POSTGRES_PASSWORD=staging \
  -e POSTGRES_USER=anexa -e POSTGRES_DB=anexa -p 5555:5432 postgres:16

export STAGING_URL='postgresql://anexa:staging@127.0.0.1:5555/anexa'
```

Restore:

```bash
pg_restore \
  --no-owner --no-acl \
  --clean --if-exists \
  --schema=public \
  -d "$STAGING_URL" \
  anexa-prod-YYYYMMDD-HHMM.dump
```

`pg_restore` prints warnings about Supabase-owned roles and extensions it cannot
recreate (`supabase_admin`, `pg_graphql`, publications). **Those are expected and
harmless** — `--no-owner --no-acl` is why. What matters is that the data lands.

### 2c. Confirm the restore is real

```bash
psql "$STAGING_URL" -tAc "
select
  (select count(*) from companies) as companies,
  (select count(*) from users)     as users,
  (select count(*) from leads)     as leads,
  (select count(*) from projects)  as projects;"
```

Compare against production:

```bash
psql "$PROD_MIGRATE_URL" -tAc "
select
  (select count(*) from companies) as companies,
  (select count(*) from users)     as users,
  (select count(*) from leads)     as leads,
  (select count(*) from projects)  as projects;"
```

**The counts must match.** If they do, the backup is verified restorable and you
have a realistic staging database. If they do not, stop — you do not have a
working backup, and nothing below should proceed.

### If you ever need this for real

Restoring over production is the same command pointed at prod, and it is
destructive — it drops and recreates every object in `public`:

```bash
# EMERGENCY ONLY. This destroys current production data.
pg_restore --no-owner --no-acl --clean --if-exists --schema=public \
  -d "$PROD_MIGRATE_URL" anexa-prod-YYYYMMDD-HHMM.dump
```

Prefer the Supabase PITR restore for a real incident — it is transactional at
the platform level and does not depend on your dump being current.

---

## Step 3 — Human smoke test on staging, flag ON  **[REQUIRED GATE]**

A person walks one solar deal end to end, on a preview deploy, against the
staging database from Step 2. **Nothing in production is touched.** This is the
step that catches what tests cannot: whether the thing is actually usable.

### 3a. Prepare staging

```bash
# Bring the restored copy up to the new schema. ALL migrations here, including
# the one held back from production.
DATABASE_URL="$STAGING_URL" npx prisma migrate deploy
```

### 3b. Point a preview deploy at it, flag ON

The PR already produces a Vercel preview. Give the **Preview** environment:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your `$STAGING_URL`, reachable from Vercel |
| `SOLAR_VERTICAL_ENABLED` | `1` |
| `NEXT_PUBLIC_APP_URL` | the preview URL |

> Local Docker is not reachable from Vercel. Either expose it (`ngrok tcp 5555`)
> or use a second Supabase project as the staging target. If neither is
> convenient, run the walkthrough locally instead — `SOLAR_VERTICAL_ENABLED=1
> DATABASE_URL="$STAGING_URL" pnpm dev` — which tests the same code against the
> same data. What matters is a human doing the walk, not where it is hosted.

### 3c. The walkthrough — tick every box

Log in as the owner. Switch to **Solar**.

| # | Do this | Expect |
|---|---|---|
| 1 | Settings → Solar Settings | Page loads. Federal credit is **blank**. |
| 2 | Set federal credit to your CPA's figure, Save | Saves; toast confirms |
| 3 | Settings → Solar Equipment | Modules / inverters / batteries / adders listed |
| 4 | Appointments → create a solar deal | Lands in the Solar pipeline, not Roofing |
| 5 | Deal → **System Design** | Enter utility, annual usage, pick a module, set qty, Save |
| 6 | Same tab | kW-DC, yr-1 kWh and offset % appear, **computed server-side** |
| 7 | Deal → **Financing** → Cash | Dealer-fee field is **disabled** |
| 8 | Switch to Loan | Dealer fee enabled; contract price + credit estimate appear with the disclaimer |
| 9 | Switch to PPA | Input set **changes entirely** — $/kWh, escalator, term. No PPW. |
| 10 | Back to Loan, Save | Saves |
| 11 | Deal → **Proposal** → Check readiness | "Ready to generate" |
| 12 | Generate proposal | v1 appears in the versions list |
| 13 | **Open the proposal link on a real phone** | Single column, readable, no horizontal scroll, tables scroll inside themselves |
| 14 | Read it as a customer would | Hero, environmental, specs, 25-yr savings, financing, 6-step timeline, FAQs |
| 15 | Check the credit line | Shows your configured %, with the not-a-guarantee disclaimer |
| 16 | Check the footer | Non-binding-estimate disclaimer + the assumptions list |
| 17 | Type your name, tick the box, **Accept** | Success state |
| 18 | Back in the portal, reload the deal | Stage is **Contract Signed** |
| 19 | Proposal tab | v1 shows `signed` with the acceptance date |
| 20 | Regenerate the proposal | v2 created; **v1 now shows `superseded`** |
| 21 | Open v1's old link | Refuses acceptance, tells you a newer version exists |
| 22 | Switch to **Roofing** | Every roofing deal intact; no solar deal visible |
| 23 | Roofing deal → Overview | Claim card present; **no** System Design / Proposal tabs |

**Also deliberately try to break it** — the guard rails matter more than the
happy path:

| # | Do this | Expect |
|---|---|---|
| 24 | Design: clear annual usage, Save, check readiness | **Blocked**, message names the usage field |
| 25 | Design: set module qty to 200 (leaving size mismatched) | **Blocked**, module count vs system size |
| 26 | Financing: Cash with a dealer fee | **Blocked**, "a cash deal has no lender" |
| 27 | Financing: PPA with a monthly payment | **Blocked**, tells you to use a Lease |
| 28 | Settings: clear the federal credit, regenerate | New version shows **no credit line at all** (not $0) |

**Every row must pass.** A failure here is a bug to fix before production, not a
note to carry forward. Record who ran it and when:

```
Smoke test run by: ____________________  Date: ____________
Result:            PASS / FAIL
Notes:
```

### 3d. Tear down

```bash
docker rm -f anexa-staging
# and remove the Preview env vars you set, so the preview stops pointing at staging
```

---

## Step 4 — Run the migrations

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
see Step 8. Hold it back:

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

## Step 5 — Deploy the code, flag OFF

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

## Step 6 — Verify Roofing is unchanged

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

## Step 7 — Review AND clean Solar grants  **[REQUIRED GATE]**

Reviewing is not remediating. This step ends with a re-verified list, and the
flag does not go on until it does.

Accounts created before this work inherited Solar from the old default. Who
should keep it is a business decision — the code cannot make it for you.

### 7a. Who has Solar today (read only)

```sql
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

Go down the list and decide, per person: **should this human be able to open the
Solar workspace on day one?** Write the ones who should not into the list below.

### 7b. Preview the revocation — dry run, no commit

Edit the email list, then run the whole block. It shows exactly what would
change and then throws it away.

```sql
BEGIN;

UPDATE users u
   SET industries = COALESCE(
         NULLIF(array_remove(u.industries, 'solar'::"Industry"), '{}'),
         ARRAY['roofing']::"Industry"[]
       )
 WHERE u.email = ANY(ARRAY[
         -- ▼ EDIT: the people who should NOT have Solar on day one
         'someone@anexahomes.com',
         'someone.else@anexahomes.com'
         -- ▲
       ])
   AND u."deletedAt" IS NULL
RETURNING u.email, u.role, u.industries AS grants_after;

-- Read the output. Every row should show grants_after WITHOUT 'solar'.
-- If the row count is not what you expected, an email is misspelled.
ROLLBACK;   -- nothing was changed
```

`array_remove` strips only Solar and leaves any other grant intact, so this
stays correct if a third vertical is ever added. The `COALESCE`/`NULLIF` guard
means nobody can end up with an empty grant list — if removing Solar would empty
it, they fall back to Roofing. (Both behaviours were verified against a copy of
the schema before this runbook shipped: the dry run reports `{roofing}` and the
`ROLLBACK` leaves grants untouched.)

### 7c. Apply it

Same block, `COMMIT` instead of `ROLLBACK`:

```sql
BEGIN;

UPDATE users u
   SET industries = COALESCE(
         NULLIF(array_remove(u.industries, 'solar'::"Industry"), '{}'),
         ARRAY['roofing']::"Industry"[]
       )
 WHERE u.email = ANY(ARRAY[
         -- ▼ the SAME list you just previewed
         'someone@anexahomes.com',
         'someone.else@anexahomes.com'
         -- ▲
       ])
   AND u."deletedAt" IS NULL
RETURNING u.email, u.role, u.industries AS grants_after;

COMMIT;
```

To revoke by id instead of email, swap the predicate:

```sql
 WHERE u.id = ANY(ARRAY['<uuid>', '<uuid>']::text[])
```

### 7d. Re-verify — this is the gate

Re-run the read-only query from 7a. **Only the people you intend should appear.**

```sql
SELECT email, role, status, industries AS grants
FROM users
WHERE 'solar' = ANY(industries)
  AND "deletedAt" IS NULL
ORDER BY role, email;
```

```
Grants reviewed and cleaned by: ____________________  Date: ____________
People intentionally keeping Solar (count): ______
Re-verified list matches intent:            YES / NO
```

**If this is NO, do not proceed to Step 9.**

### What to expect operationally

- **No logout required.** `getSessionUser()` re-reads the grant column from the
  database on every request, so a revocation takes effect on that person's very
  next page load.
- **Anyone sitting in Solar is bounced safely.** `getActiveVertical()` validates
  the workspace cookie against current grants, so a revoked user lands back in
  Roofing rather than getting an error or a blank workspace.
- **No data is touched.** This changes who can *see* Solar, nothing else.

### super_admin is intentionally exempt

Running the UPDATE against a `super_admin` will appear to succeed and **will have
no effect on what they can open**: `userVerticals()` returns every live vertical
for that role regardless of the grant column. That is deliberate — an owner
locked out of a workspace by a stale grant list is a support incident, not a
security win.

If you genuinely need to keep a `super_admin` out of Solar, change their **role**
(Team → member → Role). That is a different and much larger decision, and it is
not part of this rollout.

## Step 8 — Drop the legacy unique indexes

Only after Step 6 passes and the new code is live.

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

## Step 9 — Flip the flag on

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
2. Stay in **Roofing** and re-run the Step 6 checks. Roofing must still be
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
schema (that is exactly the Step 4–5 window), so reverting the code alone is a
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
