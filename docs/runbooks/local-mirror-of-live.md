# Running a local copy of production

The local database is a **full restore of live**, so every setting, pipeline
stage, document template, scope item, solar lender and piece of branding matches
what is on anexahomes.com. On top of that sits a local-only overlay: the eight
role logins and a set of demo deals that actually pay commissions.

Nothing local can reach production. The clone script's only contact with live is
a read-only `pg_dump`.

```bash
npm run db:clone-live     # refresh local from live (~10 min), then re-seed the demo overlay
npm run dev               # http://localhost:3000
```

## Signing in

Every account uses the password **`Passw0rd!`**, and the panel under the sign-in
form lists all of them — the eight seeded roles *and* live's real team, whose
local passwords are reset so their exact permissions can be checked.

| Account | Role |
|---|---|
| `owner@anexahomes.com` | Super Admin |
| `officeadmin@anexahomes.com` | Admin |
| `manager@anexahomes.com` | Sales Manager |
| `rep@anexahomes.com` | Sales Rep |
| `canvasser@anexahomes.com` | Canvasser |
| `marketing@anexahomes.com` | Marketing |
| `installer@anexahomes.com` | Installer / Crew |
| `accounting@anexahomes.com` | Accounting |

The panel is generated from the database at request time and is served only when
`NEXT_PUBLIC_DEMO_MODE=true` **and** `VERCEL` is unset — so it cannot appear on a
deployed site, and no real email address is compiled into the client bundle.

## Watching commissions flow

Live has no commission rules configured, so a straight copy pays nothing. The
overlay adds a full configuration for both verticals:

- **Roofing** splits the profit pool — contract + supplement − job cost −
  overhead − PA fee. The demo rep takes 40% self-generated / 30% on a
  company-provided lead, plus 10% of the deductible; every active sales manager
  takes their own %; the sales manager also holds a 5% override on the rep.
  A project-manager rule (2%) and an install-crew rule ($1,500) sit outside the
  pool.
- **Solar** does not use a pool. The rep is paid either the overage above a
  $2.10/W redline or a flat $0.30/W, and **which one applies is a property of the
  lender**, not the rep. Both demo solar deals exist so the two can be compared:
  Alvarez routes to Climate First (redline), Brooks to Amos Capital (per-watt).

Five demo deals are seeded, `DEMO-001` … `DEMO-005`, deliberately placed either
side of the commission gate:

| Deal | Vertical | Stage | Pays? |
|---|---|---|---|
| Whitaker | Roofing | Invoice Sent | **No** — one stage short of the gate |
| Ramirez | Roofing | Depreciation Requested | Yes |
| Nair | Roofing | Paid | Yes |
| Alvarez | Solar | Contract Signed | Yes |
| Brooks | Solar | Install Scheduled | Yes |

Open **Commissions**, press **Generate**, and four of the five pay out. Drag
Whitaker into Depreciation Requested on the pipeline, press Generate again, and
its lines appear — that is the gate doing its job. Approving a line moves it into
Payroll.

## What is deliberately different from live

| | Live | Local |
|---|---|---|
| Email | Resend, real delivery | **No mail provider.** Emails print to the terminal instead of sending. This is the only thing preventing a local test from reaching a real customer — do not set `RESEND_API_KEY` or `SMTP_*`. |
| Database | Supabase, transaction pooler | Docker Postgres 17 on `127.0.0.1:5544` |
| Auth secret | production's | local's own, so a session minted here is not valid there |
| Cron jobs | Vercel schedules them | nothing runs them; `CRON_SECRET` is present so the endpoints can be called by hand |

Everything else — storage driver, Google Maps, the onboarding encryption key,
both verticals, the data providers — is copied so the app behaves the same.

## How the clone protects production

- The restore half parses `DATABASE_URL` and **aborts** unless it resolves to
  `127.0.0.1`/`localhost` on port **5544**. There is no override flag.
- `prisma/seed-local-demo.ts` repeats that check independently, and additionally
  refuses any URL naming a hosted provider — it resets passwords to a password it
  prints on screen, so it must never see production.
- Live credentials are pulled into a temp directory deleted on exit, and are only
  ever handed to `pg_dump`.
- After restoring, the script compares **every** table's row count against live
  and fails loudly on any difference, rather than reporting success.

## Gotchas

- **Local Postgres must be 17.** Live runs 17.6, and a v17 dump does not restore
  into a v16 server. `docker-compose.yml` pins `postgres:17-alpine` on the
  `anexa_pgdata17` volume; the old v16 volume `anexa_pgdata` is left in place if
  the pre-clone database is ever wanted back.
- **`pg_dump` must be the v17 client** (`/opt/homebrew/opt/postgresql@17/bin`).
  The v16 client refuses to dump a v17 server outright.
- **The dump takes ~8–10 minutes and lands around 60 MB.** Almost all of that is
  PDFs and photos stored in the database. It is not hung.
- **Dumps live in `.backups/`, which is gitignored.** They are a complete copy of
  production — every customer record and every uploaded document. Never commit
  one. `npm run db:clone-live -- --reuse` restores the newest one without
  re-dumping.
