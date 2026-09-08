# Deploying Anexa Homes (Vercel + managed Postgres)

Next.js 16 (App Router) · Prisma 6 · NextAuth v5. File uploads need S3 in prod
(serverless has no persistent disk).

## 1. Push the code to GitHub
```bash
# create an empty repo at github.com/<you>/anexa-homes, then:
git remote add origin git@github.com:<you>/anexa-homes.git
git push -u origin HEAD            # pushes the current branch
```

## 2. Create a production Postgres (Neon — free tier is fine)
1. neon.tech → New Project → copy the **pooled** connection string.
2. You'll set it as `DATABASE_URL` in Vercel (step 4).

## 3. Create an S3 bucket for uploads (photos, PDFs, pay stubs, attachments)
- Any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2).
- Without this, uploads break on Vercel (no local disk). Driver is already built:
  `STORAGE_DRIVER=s3`.

## 4. Import to Vercel
1. vercel.com → Add New → Project → import the GitHub repo.
2. Framework preset: **Next.js** (auto). Build command is already correct
   (`prisma generate && … && next build` — set in package.json).
3. **Environment Variables** (Production):

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` (required behind Vercel's proxy) |
| `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` (used for reset/invite links) |
| `STORAGE_DRIVER` | `s3` |
| `STORAGE_S3_BUCKET` | your bucket name |
| `AWS_REGION` | bucket region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 credentials (or R2 equivalents) |
| `CRON_SECRET` | **required** — `openssl rand -base64 32`. Bearer token for every `/api/cron/*` entry in `vercel.json` and for `POST /api/storm/swaths/ingest`. **Fails closed:** unset ⇒ all of them 503 and no scheduled work runs. |
| `LENDER_WEBHOOK_SECRET` | required if any lender posts credit decisions — also fails closed |
| `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` | (optional) email — invites, pay stubs, 1099 |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | (optional) SMS |
| `NLR_API_KEY` | (optional, solar) real production figures — see below |

⚠️ **Do NOT set in prod:** `NEXT_PUBLIC_DEMO_MODE` — it shows the shared-password
quick-login block on /login and would be a security hole live. (It is additionally
guarded in code: `server/auth/demo-accounts.ts` refuses to enable demo mode whenever
`VERCEL` is set.)

4. Deploy.

## 5. Migrations
**The production build applies them itself.** `npm run build` starts with
`node scripts/prod-migrate.mjs`, which runs `prisma migrate deploy` and then asserts
with `migrate status` — so code can never reach production ahead of its schema, and a
failed migration fails the build with the previous deployment still serving.

It only ever touches the database when `VERCEL_ENV === "production"`, so preview builds
and local `npm run build` skip it entirely. It also rebuilds the connection URL for the
**session** pooler (`:5432`), because Supabase's transaction pooler (`:6543`) cannot run
migrations.

The one thing to keep in mind: the migration lands a few seconds BEFORE the new code goes
live, so ship a **destructive** change (dropping a column the outgoing build still selects)
as two deploys — stop reading it, then drop it.

First-time only, to create the demo company/users:
```bash
DATABASE_URL="<prod-url>" pnpm db:seed     # OPTIONAL — skip for a clean prod start
```

## 6. First login
- If you seeded: the seeded accounts (`owner@anexahomes.com` … / `Passw0rd!`).
- For a clean prod start, seed only a company + first owner, or build a
  first-run setup. Change all seeded passwords immediately.

## Notes / gotchas
- **NLR key (solar production):** `NLR_API_KEY` is what turns a proposal's kWh
  from an estimate into a simulation. With it, every described roof plane is run
  against the NSRDB weather record for that address by PVWatts v8, and the
  customer's proposal says so. Without it the app falls back to the lab's shared
  `DEMO_KEY`, throttled to roughly **30 requests an hour per address** — past
  that, planes quietly keep the company's market-average yield from Solar
  settings, and the proposal correctly lists that average instead. Nothing breaks
  either way; the numbers are just softer. The key is free and instant:
  <https://developer.nlr.gov/signup>.

  **The host moved.** NREL is now the National Laboratory of the Rockies, and
  `developer.nrel.gov` was retired on 29 May 2026 — it does not resolve at all,
  which from inside a build looks identical to a blocked firewall. The API is
  otherwise unchanged. `NREL_API_KEY` is still read if you already set one; the
  key did not change in the rename.

  Answers are cached per rounded location-and-plane and shared across companies,
  so the request volume is far lower than the number of deals — a second quote on
  the same street with the same roof pitch costs nothing.

- **Google Maps key:** `GOOGLE_MAPS_API_KEY` backs three separate things, and each
  needs its API switched on in the Google Cloud console:
  - *Maps Static API* — the aerial thumbnail on a deal.
  - *Geocoding API* — rooftop coordinates for a lead's address.
  - *Map Tiles API* — the optional **Google** / **Google Sat** basemaps in the
    Field Map's Layers panel. **Billed per tile loaded**, which is why they are
    opt-in and disappear entirely when the key is unset. "Google Sat" is the one
    reps want: Google imagery with the roadmap layer over it, so house numbers
    are labelled on the rooftops. Tiles are proxied through `/api/map/tiles` so
    the key and session token never reach the browser; nothing is cached our
    side, since the Map Tiles terms forbid storing tile content.

  Because every call is server-to-server, restrict the key **by IP, not by HTTP
  referrer** — a referrer rule rejects all of them.
- **Auth URL:** NextAuth needs the canonical prod URL set, or callbacks break.
- **Migrations as source of truth:** never `db push` to prod — only `migrate deploy`.
- **Uploads:** anything via `src/server/storage` requires the S3 env vars in prod.
- **Custom domain:** add it in Vercel → Domains, then update `NEXT_PUBLIC_APP_URL`.
- A production build must be green locally (`pnpm build`) before deploying.
