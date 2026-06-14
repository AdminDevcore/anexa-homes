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
| `AUTH_SECRET` (and/or `NEXTAUTH_SECRET`) | `openssl rand -base64 32` |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` |
| `STORAGE_DRIVER` | `s3` |
| `STORAGE_S3_BUCKET` | your bucket name |
| `AWS_REGION` | bucket region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 credentials (or R2 equivalents) |
| `RESEND_API_KEY` | (optional) email — invites, pay stubs, 1099 |
| `TWILIO_*` | (optional) SMS |

(Confirm the exact auth var names against `src/server/auth/*` + `.env.example`.)

4. Deploy.

## 5. Apply migrations to the prod DB (once, and after each schema change)
The build runs `prisma generate` but NOT migrations (so preview builds never touch
prod). Run migrations explicitly against the prod DB:
```bash
DATABASE_URL="<neon-url>" npx prisma migrate deploy
# first-time only, to create the demo company/users:
DATABASE_URL="<neon-url>" pnpm db:seed     # OPTIONAL — skip for a clean prod start
```
Re-run `migrate deploy` whenever new migrations land.

## 6. First login
- If you seeded: the seeded accounts (`owner@anexahomes.com` … / `Passw0rd!`).
- For a clean prod start, seed only a company + first owner, or build a
  first-run setup. Change all seeded passwords immediately.

## Notes / gotchas
- **Auth URL:** NextAuth needs the canonical prod URL set, or callbacks break.
- **Migrations as source of truth:** never `db push` to prod — only `migrate deploy`.
- **Uploads:** anything via `src/server/storage` requires the S3 env vars in prod.
- **Custom domain:** add it in Vercel → Domains, then update `NEXT_PUBLIC_APP_URL`.
- A production build must be green locally (`pnpm build`) before deploying.
