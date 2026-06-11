# Anexa Homes — Website + Roofing CRM

A premium marketing website **and** a secure, multi-tenant roofing CRM/portal for
Anexa Homes. Built as a scalable SaaS-style system (Anexa is the first tenant).

> **Protecting Homes. Restoring Roofs. Powering Better Living.**

## Tech stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript** (strict)
- **PostgreSQL** + **Prisma 6** (all money stored as integer cents)
- **NextAuth v5** (Auth.js) — JWT sessions, `sessionVersion` revocation, bcrypt hashing
- **Tailwind v4** + **shadcn/ui** (radix-nova) · **framer-motion** · **lucide-react**
- **@tanstack/react-query**, **react-hook-form** + **zod**, **@dnd-kit** (kanban), **recharts**
- **Playwright** (E2E, incl. role/tenant isolation)

## Quick start

```bash
# 1. Start Postgres (Docker) — runs on host port 5544 to avoid local DB conflicts
pnpm db:up

# 2. Apply schema + generate client
pnpm db:migrate        # first run: prisma migrate dev

# 3. Seed Anexa Homes, all 9 user roles, pipeline, leads, projects, templates
pnpm db:seed

# 4. Run the app
pnpm dev               # http://localhost:3000
```

Copy `.env.example` to `.env` (already present for local dev). `AUTH_SECRET` must be set;
generate a real one with `openssl rand -base64 32` for any non-local use.

## Demo accounts

All seeded users share the password **`Passw0rd!`**. Sign in at `/login`
(the login screen has a one-click demo-account picker).

| Role | Email |
|------|-------|
| Super Admin (Owner) | `owner@anexahomes.com` |
| Admin | `admin@anexahomes.com` |
| Manager | `manager@anexahomes.com` |
| Sales Rep | `rep@anexahomes.com` |
| Project Manager | `pm@anexahomes.com` |
| Installer / Crew | `installer@anexahomes.com` |
| Office Staff | `office@anexahomes.com` |
| Payroll / Accounting | `accounting@anexahomes.com` |
| Customer | `customer@anexahomes.com` |

## Structure

```
src/
  app/
    (marketing)/        Public website: home + 9 service/company pages
    (auth)/             login, forgot-password, reset-password
    portal/             The CRM (auth-gated): dashboard, leads, pipeline,
                        projects, documents, commissions, payroll, reports,
                        team, settings, customer portal
    api/auth/[...nextauth]/
  server/
    db/client.ts        Prisma singleton
    rbac/               matrix.ts (grants) · guards.ts (can/requireCan) · policies.ts (row scoping)
    auth/               config, session (getSessionUser w/ revocation), actions, password-reset
    modules/            leads (intake/queries/actions), dashboard (queries)
  components/
    marketing/  ui/  portal/  auth/
prisma/schema.prisma    Full multi-tenant schema (companies -> users, leads,
                        projects, claims, documents, payroll, commissions, ...)
prisma/seed.ts
e2e/                    Playwright tests (auth flows, RBAC isolation, lead capture)
```

## Security model

- **Tenant isolation:** every business row carries `companyId`; all reads go through
  `listScope(user, resource)` which scopes the Prisma `where` to the company and, for
  sensitive resources, to the user's own rows (e.g. a sales rep sees only their leads;
  a customer sees only their project).
- **RBAC:** `src/server/rbac/matrix.ts` is the single source of truth — 9 roles x
  resources x actions. `can()` / `requireCan()` gate handlers and pages, with optional
  per-user permission overrides (`users.permissions` JSON).
- **Sessions:** JWT carrying `{ userId, companyId, role }`; `getSessionUser()` re-validates
  the live DB row (`status` + `sessionVersion`) on every request, so disabling a user or
  bumping their `sessionVersion` invalidates existing tokens immediately.

## What's built (this delivery)

- **Public website** — all 10 pages, premium black/white/gold design, animations, mobile-responsive
- **Auth** — login (customer/staff/admin/team), password reset, role-aware redirects, route gating
- **RBAC + multi-tenant DB** — 9 roles, row-level scoping, full Prisma schema for every module
- **Role dashboards** — scoped stats (leads, projects, production, signatures, payroll, commissions, revenue)
- **Leads** — list, search, **create/edit forms (with custom-field values)**, detail
  (claim/measurements/notes), website lead capture -> CRM
- **Pipeline** — drag-and-drop kanban over customizable stages
- **Projects** — list + detail with **interactive workflows**: status moves, **QC checklist toggles**,
  **daily production reports**, **crew assignment**, claim, measurements, documents, invoices
- **File & photo uploads** — staff upload job photos/docs on projects; customers upload documents
  from their portal; access-scoped serving (`/portal/files/[id]`)
- **Tasks** — team to-do list with assignment, priority, due dates, and completion toggles
- **Notifications** — fully customizable **rules engine**: pick a trigger (lead created/assigned,
  stage change w/ optional stage filter, project status change w/ optional status filter, document
  sent/viewed/signed/completed, task assigned, daily report, commission/payroll approved), choose
  recipients (by role, specific people, or dynamic targets like assigned rep / PM / customer), and
  channels (in-app now; email via Resend & SMS via Twilio drop-in). In-app bell with live unread
  count + notification center; rules managed in Settings → Notifications
- **Customer portal** — own project, document signing, document/photo uploads, status
- **Document Signer (built-in, DocuSign-style)** — template builder with drag-and-drop
  fields (signature/initials/date/text/checkbox + `{{auto-fill}}` tokens), send-for-signature,
  consent-gated public signing on phone/computer (draw or type), **single-use time-bound tokens**,
  **IP/User-Agent capture**, **hash-chained tamper-evident audit trail**, generated **signed PDF
  with audit certificate page**, void, and authenticated download (8 contract templates seeded)
- **Payroll & Commissions engine** — rule-based calculation (percentage / flat / job-cost,
  manager override, crew pay), idempotent generation from projects, approval workflow,
  payroll runs batching approved commissions, paid/unpaid status, **CSV export**, and an admin
  **Commission Rules** manager (Settings → Commission Rules)
- **Reports** — interactive recharts dashboards (sales by rep, leads by source, projects by
  status, claims by status) + summary KPIs (closing rate, revenue, payroll/commissions owed)
  with **CSV export**
- **Customization Settings** (admin) — editable **pipeline stages** (add/edit/reorder/recolor,
  won/lost), **custom fields** (leads & projects), **commission rules**, **branding** (logo +
  colors with live preview), and a **roles & permissions** matrix view
- Team directory — live scoped views

## Status

All planned phases (0–6), the "fully operable CRM" pass, and a customizable **notifications**
engine are implemented, build-clean, and covered by **21 Playwright E2E tests** (public site,
RBAC isolation across roles, lead capture/create, tasks, photo upload, daily reports, e-signature
flow, payroll/commissions, reports, settings customization, and the notification rules flow).
Remaining ideas: user-invitation UI, wiring real email/SMS provider keys, and production deploy config.

## Tests

```bash
pnpm typecheck         # tsc --noEmit
pnpm build             # production build
pnpm e2e               # Playwright (start `pnpm dev` first; uses port 3001 via E2E_PORT)
```
