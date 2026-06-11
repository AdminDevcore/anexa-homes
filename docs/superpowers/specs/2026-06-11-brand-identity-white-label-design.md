# Sub-project A — Per-Tenant Brand & Identity (Portal White-Label)

**Date:** 2026-06-11
**Status:** Approved (design), pending implementation plan
**Part of:** the larger "Make the App Fully Customizable per Company (White-Label Ready)" initiative. This is **sub-project A of 8** (A Brand & Identity, B Terminology, C Config-list engine + enum conversion, D Claim module, E RBAC editor, F Navigation, G Commission models, H Reports). Each sub-project gets its own spec → plan → build.

## Goal

Make every brand/identity element shown **inside the CRM portal** editable per company through the Settings UI — no code, no DB edits. After this ships, nothing user-facing in the portal displays a hardcoded "Anexa Homes", "AH-" record prefix, support phone number, or a `$`/USD/`en-US` formatting assumption; all of it comes from the tenant's own settings.

## Scope

**In scope (portal only):**
- Company **name** displayed in portal (sidebar wordmark, browser-tab titles, document/PDF headers, dashboard, branding preview).
- **Record-number prefix** (replaces hardcoded `AH-`).
- **Support phone** and support email shown in the portal sidebar.
- **Currency** (remove hardcoded `$`/`USD`), **locale** (drives date/number formatting; removes hardcoded `en-US`), **timezone**, structured **company address**, **business hours**.
- **Portal logo + favicon** (sidebar wordmark and browser-tab favicon wired to the tenant's uploaded logo).
- **Login-screen branding** (tenant logo/name/colors on the portal login page).
- **Email/notification branding** (from-name + logo/colors on outgoing notification emails).
- **Custom font** (curated web-font list applied via CSS variable).
- **Custom domain** (stored + hostname→tenant mapping for login-page branding) and **remove "powered by"** toggle.

**Out of scope (deferred to their own sub-projects):**
- The public marketing website (anexahomes.com) stays Anexa's own brand. Per-tenant public sites would be a separate CMS-scale sub-project.
- Enum-backed configurable lists (statuses, sources, types, dispositions, outcomes) — that is sub-project **C**.
- Per-tenant terminology map ("Lead"→"Appointment"/"Job") — sub-project **B**.
- Full UI language translation (i18n of all interface strings). `locale` here governs **number/date/currency formatting only**, not translation of UI copy.

## Explicit assumptions (locked during brainstorming)

1. **Currency is display-only, no FX conversion.** Each tenant operates in a single currency. Money remains stored as integer minor units (cents). Changing currency changes the symbol/formatting, not the stored numbers.
2. **Prefix/currency changes affect only new records and live display.** Existing record numbers (e.g. `AH-1001`) are stored strings and are never rewritten. This satisfies the "safe edit / never orphan data" requirement.
3. **Who can edit:** users with `can(update, "Settings")` (existing pattern — owners/admins).
4. **New tenants** start from neutral defaults; the **existing Anexa tenant** is backfilled to today's exact values so current behavior is byte-identical.

## Architecture

### Resolution + propagation (Approach 1: Branding context + format hook)

- **`currentBranding()`** — a request-cached (React `cache()`) server helper. Resolves the logged-in user's `companyId` → a merged `Branding` object (tenant `CompanySettings`/`Company` values layered over sane defaults). One source of truth; memoized per request so repeated calls are free.
- **`BrandingProvider`** — a React context mounted in `/portal/layout.tsx`, seeded server-side from `currentBranding()`, exposing the resolved branding to every client component in the portal.
- **Client hooks:**
  - `useBranding()` → identity + visual (name, logoUrl, colors, supportPhone, recordPrefix, etc.).
  - `useFormat()` → `{ money(cents), date(d), dateTime(d) }` bound to the tenant's currency/locale/timezone.
- **Server helpers:** `format-server.ts` exposes `formatMoney`/`formatDate`/`formatDateTime` that read from `currentBranding()` (or take an explicit branding arg in non-request contexts like PDF generation).

Rationale for Approach 1 over alternatives: AsyncLocalStorage (Approach 2) is fragile under RSC/Turbopack and hides global state; prop-threading (Approach 3) is tedious and error-prone. Approach 1 is idiomatic Next, correct everywhere, single source of truth. Cost is a mechanical, test-guarded migration of existing `formatCents`/`formatDate` call sites.

### Data model

All per-tenant config lives on the **existing** `CompanySettings` (1:1 with `Company`) plus `Company`. No new top-level tables. New fields are nullable / defaulted so the migration is safe.

Company **name** stays on `Company.name` (already exists). `Company.timezone` already exists.

New/confirmed `CompanySettings` fields:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `logoUrl` | string? | (exists) | Portal sidebar + login + email logo |
| `faviconUrl` | string? | null | Browser-tab favicon |
| `primaryColor` | string | `#0B0B0C` (exists) | Brand color |
| `accentColor` | string | `#BFA15F`→orange (exists) | Accent color |
| `fontFamily` | string? | null (system) | Curated web-font choice |
| `recordPrefix` | string | `AH-` (Anexa) / initials (new) | Record-number prefix |
| `supportPhone` | string? | null | Sidebar support phone |
| `supportEmail` | string? | null | Sidebar/support contact |
| `currencyCode` | string | `USD` | ISO 4217 currency for money formatting |
| `locale` | string | `en-US` | BCP-47 locale for date/number/currency formatting |
| `addressStreet/City/State/Zip/Country` | string? | null | Company address |
| `businessHours` | JSON | null | Per-day open/close |
| `emailFromName` | string? | null (falls back to company name) | Outgoing email from-name |
| `customDomain` | string? | null | Hostname→tenant mapping for login branding |
| `removePoweredBy` | boolean | false | Hide "powered by" footer |

### De-hardcoding map (what changes, where)

| Hardcoded today | Source (file) | New source |
|---|---|---|
| "Anexa Homes" wordmark/logo | sidebar `Logo` component / `PortalShell` | `Company.name` + `branding.logoUrl` |
| Portal tab titles "… · Anexa Homes" | portal page metadata / `layout.tsx` | tenant name (marketing layout untouched) |
| `AH-{1000+n}` record number | `src/server/modules/projects/actions.ts` (+ any lead-number gen) | `branding.recordPrefix` |
| Support phone `(555) 200-7663` | `COMPANY.supportPhone` (`src/lib/site.ts`) | `branding.supportPhone` |
| PDF/document headers | esign / roof-report / photo-report PDF builders | company name + logo passed into the builder |
| `$` / `USD` / `en-US` | `src/lib/format.ts` | `useFormat()` (client) / `format-server.ts` (server) |
| Login screen branding | auth/login page | resolved branding (by hostname if `customDomain` matches, else default) |
| Notification email from-name/logo | `src/server/modules/notifications/delivery.ts` | `branding.emailFromName` + logo/colors |

`src/lib/site.ts` `COMPANY` constant remains for the **marketing site only**; portal code stops importing it.

### Settings UI

Expand `/portal/settings/branding` into a tabbed surface:
- **Branding tab:** logo, favicon, primary/accent colors, font picker, live wordmark + login preview, email from-name.
- **Company / Localization tab (new):** company name, record prefix, support phone/email, currency, locale, timezone, address, business hours, custom domain, remove-powered-by toggle. Live preview of a sample formatted amount + date in the chosen currency/locale.

Both guarded by `can(update, "Settings")`. Mutations via `src/server/modules/settings/actions.ts` (extends existing `updateBrandingAction`).

### Custom domain (honest scope)

In-app: store `customDomain`, map incoming hostname → tenant so the **login page** shows that tenant's branding pre-auth; honor `removePoweredBy`; show DNS setup instructions in Settings. Actual TLS certificate / DNS provisioning is deploy-platform ops (e.g. Vercel domains) and is **not** automated from inside the app — documented as a manual/ops step.

## Migration & seed

- One Prisma migration adds the new `CompanySettings` fields, all nullable/defaulted (safe on existing data).
- **Backfill** the existing Anexa tenant to today's exact values: name "Anexa Homes", `recordPrefix` `AH-`, `supportPhone` `(555) 200-7663`, `currencyCode` `USD`, `locale` `en-US`, Dallas address. Result: zero behavioral change for the current tenant.
- **New-tenant defaults:** `recordPrefix` derived from company-name initials, `currencyCode` `USD`, `locale` `en-US`, blank support phone/email until set, default colors/logo.
- Seed (`prisma/seed.ts`) updated so a freshly seeded tenant exercises the new fields.

## Safe-edit handling

- Changing `recordPrefix` or `currencyCode` affects only records created afterward and live formatting; stored record-number strings and stored cent amounts are untouched.
- No status/data rows are deleted or remapped in this sub-project (no enum work here — that is sub-project C).

## Testing

- **Unit:** `currentBranding()` merge/defaults; `formatMoney`/`formatDate` for ≥2 currency/locale combos (e.g. USD/en-US and EUR/de-DE).
- **Tenant isolation (integration/Playwright):** two companies with different name, prefix, currency, support phone:
  - Each renders only its own name/phone/currency in the sidebar and a sample screen.
  - Editing company B's branding never changes what company A renders.
  - A new record created in company B uses B's prefix; company A's records/prefix are unaffected.
- **Regression:** Anexa tenant still shows "Anexa Homes", `AH-` numbers, and USD formatting identical to pre-change (guards the backfill).
- **Grep guard:** the portal code paths no longer import `COMPANY` from `site.ts`; `formatCents`/`formatDate` hardcoded `en-US`/`USD` removed.

## Acceptance criteria (this sub-project)

1. An admin can, entirely through the portal Settings UI, change company name, record prefix, support phone/email, currency, locale, timezone, address, logo, favicon, colors, font, login branding, email from-name — with zero code or DB edits — and see them reflected across the portal.
2. Grepping the **portal** code for user-facing "Anexa Homes", "AH-", the support phone literal, and `$`/`USD`/`en-US` formatting returns no hits — all resolve from per-tenant config. (Marketing site excluded.)
3. Tenant isolation tests pass: one company's branding/identity can't affect another's.
4. The existing Anexa tenant is visually and functionally unchanged after migration (backfill verified).

## Open items / follow-ups (not blocking)

- Curated font list contents (which web fonts to offer) — decide during implementation.
- Business-hours UI shape (per-day rows) — decide during implementation; data model is JSON so it's flexible.
- Email-template branding depth: this sub-project does from-name + logo/colors; richer template editing can be folded into a later pass.
