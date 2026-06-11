# Per-Tenant Brand & Identity (Portal White-Label) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every brand/identity element shown inside the CRM portal (company name, record-number prefix, support phone, currency/locale, logo, favicon, colors, font, login + email branding) editable per company through the Settings UI, with zero hardcoded "Anexa Homes" / "AH-" / phone / `$` left in portal code.

**Architecture:** A single request-cached server resolver (`currentBranding()`) merges each tenant's `CompanySettings` + `Company` over sane defaults. A `BrandingProvider` React context mounted in the portal layout exposes it to client components via `useBranding()` / `useFormat()`; server components/PDFs use `format-server.ts`. All hardcoded portal strings/formatting are migrated to read from this layer. The public marketing site is out of scope and keeps the `COMPANY` constant.

**Tech Stack:** Next.js 16 (App Router, RSC), Prisma 6 + PostgreSQL, React context, `Intl.NumberFormat`/`Intl.DateTimeFormat`, Vitest (unit), Playwright (integration/isolation).

**Spec:** `docs/superpowers/specs/2026-06-11-brand-identity-white-label-design.md`

---

## File Structure

**New files:**
- `src/server/branding/defaults.ts` — `DEFAULT_BRANDING`, the `Branding` type, the `resolveBranding()` pure merge function.
- `src/server/branding/resolve.ts` — `currentBranding()` (session-based, request-cached) and `brandingForHost(hostname)` (pre-auth, by custom domain).
- `src/server/branding/__tests__/resolve.test.ts` — unit tests for the pure merge.
- `src/lib/format-server.ts` — server-side `formatMoney`/`formatDate`/`formatDateTime` taking an explicit `Branding`/`FormatConfig`.
- `src/lib/format-core.ts` — pure formatters shared by client + server (`makeMoney`, `makeDate`, `makeDateTime` given `{currency, locale, timeZone}`).
- `src/lib/__tests__/format-core.test.ts` — unit tests for formatting.
- `src/components/portal/branding-provider.tsx` — `BrandingProvider`, `useBranding()`, `useFormat()`.
- `vitest.config.ts` — unit test runner config.

**Modified files:**
- `prisma/schema.prisma` — new `CompanySettings` fields.
- `prisma/migrations/<new>/migration.sql` — additive migration.
- `prisma/seed.ts` — backfill Anexa tenant to today's values.
- `src/lib/format.ts` — re-export from `format-core` (kept for marketing/back-compat with explicit config).
- `src/server/modules/settings/actions.ts` — extend branding schema/action + new identity/localization action.
- `src/app/portal/layout.tsx` — mount `BrandingProvider`.
- `src/components/portal/portal-shell.tsx` — sidebar logo/wordmark/support phone from branding.
- `src/server/modules/projects/actions.ts:170` — record prefix from branding.
- `src/app/(auth)/layout.tsx` + `src/app/(auth)/login/page.tsx` — login branding by host.
- `src/server/modules/notifications/delivery.ts` — email from-name from branding.
- `src/app/portal/settings/branding/*` — expanded Branding + Company/Localization UI.
- `src/app/portal/customer/page.tsx:121` — phone from branding.
- PDF builders (esign, roof-report, photo-report) — company name/logo from branding.

---

## Task 1: Set up the Vitest unit runner

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Add the `vite-tsconfig-paths` dev dep and a `test` script**

Run:

```bash
pnpm add -D vite-tsconfig-paths
```

Then add to `package.json` `"scripts"` (after `"e2e"`):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Add a smoke test to prove the runner works**

Create `src/lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test`
Expected: PASS, 1 test passed.

- [ ] **Step 5: Delete the smoke test and commit the runner**

```bash
rm src/lib/__tests__/smoke.test.ts
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: add vitest unit runner"
```

---

## Task 2: Branding data model (schema + migration)

**Files:**
- Modify: `prisma/schema.prisma:305-325` (CompanySettings)
- Create: `prisma/migrations/<timestamp>_branding_identity/migration.sql`

- [ ] **Step 1: Add fields to `CompanySettings`**

In `prisma/schema.prisma`, inside `model CompanySettings`, after the `accentColor` line, add:

```prisma
  faviconUrl              String?
  fontFamily              String?
  recordPrefix            String   @default("")
  supportPhone            String?
  supportEmail            String?
  currencyCode            String   @default("USD")
  locale                  String   @default("en-US")
  businessHours           Json     @default("{}")
  emailFromName           String?
  customDomain            String?  @unique
  removePoweredBy         Boolean  @default(false)
```

- [ ] **Step 2: Create the migration**

Run:

```bash
pnpm exec prisma migrate dev --name branding_identity --create-only
```

Open the generated `migration.sql` and confirm it only `ADD COLUMN`s (no drops). It should look like:

```sql
ALTER TABLE "company_settings" ADD COLUMN "faviconUrl" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "fontFamily" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "recordPrefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "company_settings" ADD COLUMN "supportPhone" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "supportEmail" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "company_settings" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE "company_settings" ADD COLUMN "businessHours" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "company_settings" ADD COLUMN "emailFromName" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "customDomain" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "removePoweredBy" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "company_settings_customDomain_key" ON "company_settings"("customDomain");
```

- [ ] **Step 3: Apply the migration + regenerate client**

Run: `pnpm exec prisma migrate dev`
Expected: "Your database is now in sync with your schema." and Prisma Client regenerated.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add per-tenant branding/identity fields to CompanySettings"
```

---

## Task 3: Branding type, defaults, and pure merge (TDD)

**Files:**
- Create: `src/server/branding/defaults.ts`
- Test: `src/server/branding/__tests__/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/branding/__tests__/resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_BRANDING, resolveBranding } from "../defaults";

describe("resolveBranding", () => {
  it("returns defaults when no tenant data", () => {
    const b = resolveBranding({ company: { name: "Acme" }, settings: null });
    expect(b.companyName).toBe("Acme");
    expect(b.currencyCode).toBe(DEFAULT_BRANDING.currencyCode); // "USD"
    expect(b.locale).toBe("en-US");
    expect(b.recordPrefix).toBe("AC-"); // derived from initials when unset
  });

  it("overlays tenant settings over defaults", () => {
    const b = resolveBranding({
      company: { name: "Summit Roofing", timezone: "America/New_York" },
      settings: {
        currencyCode: "EUR",
        locale: "de-DE",
        recordPrefix: "SR-",
        supportPhone: "(111) 222-3333",
        primaryColor: "#123456",
        logoUrl: "https://x/logo.png",
      },
    });
    expect(b.currencyCode).toBe("EUR");
    expect(b.locale).toBe("de-DE");
    expect(b.timeZone).toBe("America/New_York");
    expect(b.recordPrefix).toBe("SR-");
    expect(b.supportPhone).toBe("(111) 222-3333");
    expect(b.primaryColor).toBe("#123456");
    expect(b.logoUrl).toBe("https://x/logo.png");
  });

  it("derives a prefix from multi-word names, capping at 3 letters", () => {
    expect(resolveBranding({ company: { name: "A B C D" }, settings: null }).recordPrefix).toBe("ABC-");
    expect(resolveBranding({ company: { name: "solo" }, settings: null }).recordPrefix).toBe("SO-");
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm test src/server/branding`
Expected: FAIL — cannot find module `../defaults`.

- [ ] **Step 3: Implement `defaults.ts`**

Create `src/server/branding/defaults.ts`:

```ts
export type Branding = {
  companyName: string;
  recordPrefix: string;
  supportPhone: string | null;
  supportEmail: string | null;
  currencyCode: string;
  locale: string;
  timeZone: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string | null;
  emailFromName: string | null;
  customDomain: string | null;
  removePoweredBy: boolean;
};

export const DEFAULT_BRANDING = {
  recordPrefix: "",
  currencyCode: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  primaryColor: "#0B0B0C",
  accentColor: "#F4631E",
  removePoweredBy: false,
} as const;

/** First letters of up to the first 3 words, uppercased, e.g. "Summit Roofing" -> "SR-".
 *  Single-word names use the first two letters, e.g. "Solo" -> "SO-". */
export function derivePrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const letters =
    words.length === 1
      ? words[0].slice(0, 2)
      : words.slice(0, 3).map((w) => w[0]).join("");
  return letters.toUpperCase() + "-";
}

type CompanyInput = { name: string; timezone?: string | null };
type SettingsInput = Partial<{
  recordPrefix: string;
  supportPhone: string | null;
  supportEmail: string | null;
  currencyCode: string;
  locale: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string | null;
  emailFromName: string | null;
  customDomain: string | null;
  removePoweredBy: boolean;
}> | null;

export function resolveBranding(input: {
  company: CompanyInput;
  settings: SettingsInput;
}): Branding {
  const s = input.settings ?? {};
  return {
    companyName: input.company.name,
    recordPrefix: s.recordPrefix?.trim() || derivePrefix(input.company.name),
    supportPhone: s.supportPhone ?? null,
    supportEmail: s.supportEmail ?? null,
    currencyCode: s.currencyCode || DEFAULT_BRANDING.currencyCode,
    locale: s.locale || DEFAULT_BRANDING.locale,
    timeZone: input.company.timezone || DEFAULT_BRANDING.timeZone,
    logoUrl: s.logoUrl ?? null,
    faviconUrl: s.faviconUrl ?? null,
    primaryColor: s.primaryColor || DEFAULT_BRANDING.primaryColor,
    accentColor: s.accentColor || DEFAULT_BRANDING.accentColor,
    fontFamily: s.fontFamily ?? null,
    emailFromName: s.emailFromName ?? null,
    customDomain: s.customDomain ?? null,
    removePoweredBy: s.removePoweredBy ?? DEFAULT_BRANDING.removePoweredBy,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/server/branding`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/branding/defaults.ts src/server/branding/__tests__/resolve.test.ts
git commit -m "feat: branding type, defaults, and pure merge resolver"
```

---

## Task 4: Pure formatters shared by client + server (TDD)

**Files:**
- Create: `src/lib/format-core.ts`
- Test: `src/lib/__tests__/format-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/format-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeMoney, makeDate } from "../format-core";

describe("format-core", () => {
  it("formats cents in USD/en-US", () => {
    const money = makeMoney({ currency: "USD", locale: "en-US" });
    expect(money(123456)).toBe("$1,235"); // rounds to whole dollars (maxFractionDigits 0)
  });

  it("formats cents in EUR/de-DE", () => {
    const money = makeMoney({ currency: "EUR", locale: "de-DE" });
    // de-DE uses "." thousands sep and a trailing € — assert the pieces, not exact spacing
    const out = money(123456);
    expect(out).toContain("€");
    expect(out).toContain("235");
  });

  it("formats a date in a fixed timezone", () => {
    const date = makeDate({ locale: "en-US", timeZone: "America/Chicago" });
    expect(date("2026-06-11T12:00:00Z")).toBe("Jun 11, 2026");
  });

  it("returns an em dash for null", () => {
    const date = makeDate({ locale: "en-US", timeZone: "UTC" });
    expect(date(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm test src/lib/__tests__/format-core`
Expected: FAIL — cannot find module `../format-core`.

- [ ] **Step 3: Implement `format-core.ts`**

Create `src/lib/format-core.ts`:

```ts
export type FormatConfig = { currency?: string; locale: string; timeZone?: string };

/** Build a money formatter that turns integer minor units (cents) into a currency string. */
export function makeMoney(cfg: { currency: string; locale: string }) {
  return (cents: number, opts?: { compact?: boolean }): string => {
    const amount = (cents ?? 0) / 100;
    return new Intl.NumberFormat(cfg.locale, {
      style: "currency",
      currency: cfg.currency,
      notation: opts?.compact ? "compact" : "standard",
      maximumFractionDigits: opts?.compact ? 1 : 0,
    }).format(amount);
  };
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  return typeof d === "string" ? new Date(d) : d;
}

export function makeDate(cfg: { locale: string; timeZone?: string }) {
  return (d: Date | string | null | undefined): string => {
    const date = toDate(d);
    if (!date) return "—";
    return new Intl.DateTimeFormat(cfg.locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: cfg.timeZone,
    }).format(date);
  };
}

export function makeDateTime(cfg: { locale: string; timeZone?: string }) {
  return (d: Date | string | null | undefined): string => {
    const date = toDate(d);
    if (!date) return "—";
    return new Intl.DateTimeFormat(cfg.locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: cfg.timeZone,
    }).format(date);
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/__tests__/format-core`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-core.ts src/lib/__tests__/format-core.test.ts
git commit -m "feat: tenant-aware pure formatters (money/date)"
```

---

## Task 5: Keep `format.ts` working via `format-core` (back-compat)

**Files:**
- Modify: `src/lib/format.ts`

- [ ] **Step 1: Rewrite `format.ts` to delegate to `format-core` with the US defaults**

Replace the bodies of `formatCents`, `formatDate`, `formatDateTime` in `src/lib/format.ts` (keep `initials` as-is):

```ts
import { makeMoney, makeDate, makeDateTime } from "./format-core";

const usdMoney = makeMoney({ currency: "USD", locale: "en-US" });
const usDate = makeDate({ locale: "en-US" });
const usDateTime = makeDateTime({ locale: "en-US" });

/** @deprecated Prefer useFormat()/format-server for tenant-aware output. USD/en-US only. */
export function formatCents(cents: number, opts?: { compact?: boolean }): string {
  return usdMoney(cents, opts);
}

export function formatDate(date: Date | string | null | undefined): string {
  return usDate(date);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  return usDateTime(date);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
```

- [ ] **Step 2: Verify the build/typecheck still passes**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0 (existing `formatCents`/`formatDate` callers unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/lib/format.ts
git commit -m "refactor: route legacy format helpers through format-core"
```

---

## Task 6: Server resolvers — `currentBranding()` and `brandingForHost()`

**Files:**
- Create: `src/server/branding/resolve.ts`
- Create: `src/lib/format-server.ts`

- [ ] **Step 1: Implement the resolvers**

Create `src/server/branding/resolve.ts`:

```ts
import { cache } from "react";
import { prisma } from "@/server/db/client";
import { getSessionUser } from "@/server/auth/session";
import { resolveBranding, DEFAULT_BRANDING, type Branding } from "./defaults";

const SELECT = {
  recordPrefix: true,
  supportPhone: true,
  supportEmail: true,
  currencyCode: true,
  locale: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
  fontFamily: true,
  emailFromName: true,
  customDomain: true,
  removePoweredBy: true,
} as const;

/** Resolve branding for a specific company id. */
export async function brandingForCompany(companyId: string): Promise<Branding> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, timezone: true, settings: { select: SELECT } },
  });
  if (!company) {
    return resolveBranding({ company: { name: "" }, settings: null });
  }
  return resolveBranding({
    company: { name: company.name, timezone: company.timezone },
    settings: company.settings,
  });
}

/** Branding for the logged-in user's company. Request-cached so repeated calls are free. */
export const currentBranding = cache(async (): Promise<Branding> => {
  const user = await getSessionUser();
  if (!user) {
    return resolveBranding({ company: { name: "" }, settings: null });
  }
  return brandingForCompany(user.companyId);
});

/** Pre-auth branding by hostname (custom domain). Falls back to neutral defaults. */
export const brandingForHost = cache(async (hostname: string | null): Promise<Branding | null> => {
  if (!hostname) return null;
  const host = hostname.split(":")[0].toLowerCase();
  const settings = await prisma.companySettings.findFirst({
    where: { customDomain: host },
    select: { ...SELECT, company: { select: { name: true, timezone: true } } },
  });
  if (!settings) return null;
  return resolveBranding({
    company: { name: settings.company.name, timezone: settings.company.timezone },
    settings,
  });
});

export { DEFAULT_BRANDING };
```

> Note: confirm the session helper name — the codebase exposes `getSessionUser()` (returns the user or null) and `requireUser()` (redirects). Use `getSessionUser()` here. If the actual export differs, adjust the import only.

- [ ] **Step 2: Implement `format-server.ts`**

Create `src/lib/format-server.ts`:

```ts
import { makeMoney, makeDate, makeDateTime } from "./format-core";
import { currentBranding } from "@/server/branding/resolve";
import type { Branding } from "@/server/branding/defaults";

/** Build formatters from an already-resolved Branding (use in PDFs / non-request code). */
export function formattersFor(b: Pick<Branding, "currencyCode" | "locale" | "timeZone">) {
  return {
    money: makeMoney({ currency: b.currencyCode, locale: b.locale }),
    date: makeDate({ locale: b.locale, timeZone: b.timeZone }),
    dateTime: makeDateTime({ locale: b.locale, timeZone: b.timeZone }),
  };
}

/** Tenant-aware formatters for the current request (server components / actions). */
export async function currentFormatters() {
  return formattersFor(await currentBranding());
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/branding/resolve.ts src/lib/format-server.ts
git commit -m "feat: server branding resolvers + tenant-aware server formatters"
```

---

## Task 7: BrandingProvider + client hooks

**Files:**
- Create: `src/components/portal/branding-provider.tsx`

- [ ] **Step 1: Implement the provider and hooks**

Create `src/components/portal/branding-provider.tsx`:

```tsx
"use client";

import * as React from "react";
import { makeMoney, makeDate, makeDateTime } from "@/lib/format-core";
import type { Branding } from "@/server/branding/defaults";

const BrandingContext = React.createContext<Branding | null>(null);

export function BrandingProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  const ctx = React.useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within <BrandingProvider>");
  return ctx;
}

/** Tenant-aware formatters, memoized per branding value. */
export function useFormat() {
  const b = useBranding();
  return React.useMemo(
    () => ({
      money: makeMoney({ currency: b.currencyCode, locale: b.locale }),
      date: makeDate({ locale: b.locale, timeZone: b.timeZone }),
      dateTime: makeDateTime({ locale: b.locale, timeZone: b.timeZone }),
    }),
    [b.currencyCode, b.locale, b.timeZone]
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/branding-provider.tsx
git commit -m "feat: BrandingProvider with useBranding/useFormat hooks"
```

---

## Task 8: Mount BrandingProvider in the portal layout

**Files:**
- Modify: `src/app/portal/layout.tsx`

- [ ] **Step 1: Resolve branding and wrap the shell**

In `src/app/portal/layout.tsx`, add imports:

```ts
import { currentBranding } from "@/server/branding/resolve";
import { BrandingProvider } from "@/components/portal/branding-provider";
```

After `const activeIndustry = await getActiveIndustry(user);` add:

```ts
  const branding = await currentBranding();
```

Wrap the returned `<PortalShell ...>...</PortalShell>` in the provider:

```tsx
  return (
    <BrandingProvider branding={branding}>
      <PortalShell
        user={{
          name: user.fullName,
          email: user.email ?? "",
          roleLabel: roleLabel(user.role),
        }}
        allowedHrefs={allowedHrefs}
        activeIndustry={activeIndustry}
        industries={industries}
        branding={branding}
      >
        {children}
      </PortalShell>
    </BrandingProvider>
  );
```

(The `branding={branding}` prop on PortalShell is consumed in Task 9.)

- [ ] **Step 2: Typecheck (expect a PortalShell prop error until Task 9)**

Run: `pnpm exec tsc --noEmit`
Expected: ONE error — `PortalShell` has no `branding` prop. That is fixed in Task 9. Do not commit yet; proceed to Task 9 and commit them together.

---

## Task 9: De-hardcode the sidebar (logo, wordmark, support phone)

**Files:**
- Modify: `src/components/portal/portal-shell.tsx`

- [ ] **Step 1: Accept the `branding` prop**

Add to PortalShell's props type:

```ts
import type { Branding } from "@/server/branding/defaults";
// ...
  branding: Branding;
```

Add `branding` to the destructured props.

- [ ] **Step 2: Replace the hardcoded logo/wordmark**

Find the sidebar brand block (the portal logo/wordmark near the top of the sidebar). Replace the hardcoded logo image + "Anexa Homes" text with:

```tsx
<div className="flex items-center gap-2">
  {branding.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={branding.logoUrl} alt={branding.companyName} className="h-7 w-auto" />
  ) : (
    <span className="grid size-7 place-items-center rounded-md bg-foreground text-background text-xs font-bold">
      {branding.companyName.slice(0, 2).toUpperCase()}
    </span>
  )}
  <span className="font-display text-base font-semibold tracking-tight">
    {branding.companyName}
  </span>
</div>
```

- [ ] **Step 3: Replace the hardcoded support phone (lines ~105-109)**

Replace the `COMPANY.supportPhoneHref` / `COMPANY.supportPhone` block with a conditional that only renders when a support phone is set:

```tsx
{branding.supportPhone && (
  <a
    href={`tel:${branding.supportPhone.replace(/[^0-9+]/g, "")}`}
    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
  >
    <Phone className="size-4" />
    Support: {branding.supportPhone}
  </a>
)}
```

Remove the now-unused `import { COMPANY } from "@/lib/site";` from this file (keep `Phone` import from lucide-react; add it if missing).

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0 (Task 8's error now resolved).

- [ ] **Step 5: Commit Tasks 8 + 9 together**

```bash
git add src/app/portal/layout.tsx src/components/portal/portal-shell.tsx
git commit -m "feat: portal sidebar shows tenant logo, name, and support phone"
```

---

## Task 10: De-hardcode the record-number prefix

**Files:**
- Modify: `src/server/modules/projects/actions.ts:170`

- [ ] **Step 1: Resolve the prefix from branding when generating a project number**

In `src/server/modules/projects/actions.ts`, add near the top:

```ts
import { brandingForCompany } from "@/server/branding/resolve";
```

In the function that creates the project (where `projectNumber: \`AH-${1000 + count + 1}\`` is built), before the create, resolve the prefix:

```ts
  const { recordPrefix } = await brandingForCompany(user.companyId);
```

Replace line 170:

```ts
      projectNumber: `${recordPrefix}${1000 + count + 1}`,
```

> If `user`/`companyId` isn't in scope at that exact spot, use the company id already used for the `count` query in the same function.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/projects/actions.ts
git commit -m "feat: record-number prefix comes from tenant branding"
```

---

## Task 11: De-hardcode the customer-page phone

**Files:**
- Modify: `src/app/portal/customer/page.tsx:121`

- [ ] **Step 1: Use branding instead of `COMPANY.phone`**

In `src/app/portal/customer/page.tsx`, add `import { currentBranding } from "@/server/branding/resolve";`, resolve it in the server component (`const branding = await currentBranding();`), and replace the `COMPANY.phoneHref` / `COMPANY.phone` block:

```tsx
{branding.supportPhone && (
  <a href={`tel:${branding.supportPhone.replace(/[^0-9+]/g, "")}`}>
    Call your project team: {branding.supportPhone}
  </a>
)}
```

Remove the `COMPANY` import if it becomes unused in this file.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (expect exit 0)

```bash
git add src/app/portal/customer/page.tsx
git commit -m "feat: customer page phone comes from tenant branding"
```

---

## Task 12: Tenant-aware money/date across portal screens

**Files:**
- Modify: portal client components importing `formatCents`/`formatDate` from `@/lib/format`.

> This is the mechanical migration. Do it screen-by-screen, committing per screen, so each diff is reviewable. Server components use `currentFormatters()`; client components use `useFormat()`.

- [ ] **Step 1: Enumerate the call sites**

Run:

```bash
grep -rln "formatCents\|formatDate\|formatDateTime" src/app/portal src/components/portal
```

Record the list. For EACH file, apply Step 2 (client) or Step 3 (server), then commit.

- [ ] **Step 2: Client component conversion (pattern)**

In a `"use client"` file, replace:

```ts
import { formatCents, formatDate } from "@/lib/format";
```

with:

```ts
import { useFormat } from "@/components/portal/branding-provider";
```

Inside the component body add `const fmt = useFormat();` and replace `formatCents(x)` → `fmt.money(x)`, `formatDate(x)` → `fmt.date(x)`, `formatDateTime(x)` → `fmt.dateTime(x)`. Keep `initials()` as-is (it still comes from `@/lib/format`).

- [ ] **Step 3: Server component conversion (pattern)**

In a server component, add:

```ts
import { currentFormatters } from "@/lib/format-server";
```

At the top of the async component: `const fmt = await currentFormatters();` and replace calls as in Step 2. If a server component passes formatted strings to a client child, prefer passing raw cents/dates and letting the client child format via `useFormat()`.

- [ ] **Step 4: Per-file verify + commit**

After each file: `pnpm exec tsc --noEmit` (exit 0), then:

```bash
git add <file>
git commit -m "refactor: tenant-aware formatting in <screen>"
```

- [ ] **Step 5: Final grep guard**

Run:

```bash
grep -rn "from \"@/lib/format\"" src/app/portal src/components/portal | grep -v "initials"
```

Expected: no `formatCents`/`formatDate`/`formatDateTime` imports remain in portal code (only `initials`, if any).

---

## Task 13: De-hardcode PDF/document headers

**Files:**
- Modify: esign PDF builder (`src/server/modules/esign/*`), roof-report PDF (`src/server/modules/roof/actions.ts`), photo-report route (`src/app/portal/projects/[id]/photo-report/route.ts`).

- [ ] **Step 1: Find hardcoded company strings in PDF builders**

Run:

```bash
grep -rn "Anexa\|anexa-\|formatCents\|\"\\$\"" src/server/modules/esign src/server/modules/roof src/app/portal/projects/*/photo-report
```

- [ ] **Step 2: Thread branding into each builder**

For each builder, resolve branding at the call site (`const branding = await brandingForCompany(companyId);` using the project/company id already in scope) and pass `branding.companyName`, `branding.logoUrl`, and `formattersFor(branding).money` into the PDF code. Replace any literal "Anexa Homes" header text with `branding.companyName` and any `formatCents` with the threaded money formatter.

- [ ] **Step 3: Verify a PDF still renders**

Manually: open a deal, generate a signed PDF / roof report, confirm the header shows the company name and amounts format correctly. (No automated PDF assertion — visual check.)

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0)

```bash
git add src/server/modules/esign src/server/modules/roof src/app/portal/projects
git commit -m "feat: PDF/document headers use tenant company name + currency"
```

---

## Task 14: Login-screen branding by host

**Files:**
- Modify: `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Resolve host branding in the auth layout**

In `src/app/(auth)/layout.tsx`, add:

```ts
import { headers } from "next/headers";
import { brandingForHost } from "@/server/branding/resolve";
```

Inside the async layout: 

```ts
  const host = (await headers()).get("host");
  const branding = await brandingForHost(host); // null when no custom domain matches
  const companyName = branding?.companyName ?? "Anexa Homes";
  const logoUrl = branding?.logoUrl ?? null;
```

Pass `companyName`/`logoUrl`/`branding?.primaryColor` down to the auth panel UI, replacing the hardcoded full-logo/"Anexa Homes" wordmark with: tenant logo when present, else the default Anexa logo (default branding keeps current look). If `branding?.removePoweredBy` is false, render a small "Powered by Anexa" footer; when true, hide it.

- [ ] **Step 2: Apply the same in the login page hero if it has its own brand block**

If `login/page.tsx` renders its own logo/name, switch it to the values provided by the layout (or resolve `brandingForHost` again — it's request-cached, so a second call is free).

- [ ] **Step 3: Verify**

Manually: load `/login` (no custom domain) → still shows Anexa branding. (Custom-domain path is covered by Task 17 setup + manual host header test.)

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0)

```bash
git add "src/app/(auth)/layout.tsx" "src/app/(auth)/login/page.tsx"
git commit -m "feat: login screen branding resolves by custom domain"
```

---

## Task 15: Email from-name from branding

**Files:**
- Modify: `src/server/modules/notifications/delivery.ts`

- [ ] **Step 1: Accept an optional from-name override**

Change `sendEmail` / `sendEmailWithAttachments` signatures to accept an optional `opts?: { fromName?: string }` and build `from` as:

```ts
const fromAddress = process.env.NOTIFY_EMAIL_FROM_ADDRESS ?? "notifications@anexahomes.com";
const fromName = opts?.fromName?.trim() || process.env.NOTIFY_EMAIL_FROM_NAME || "Anexa Homes";
const from = `${fromName} <${fromAddress}>`;
```

(Keep `NOTIFY_EMAIL_FROM` as a fallback if already set, to avoid breaking existing env.)

- [ ] **Step 2: Pass the tenant's `emailFromName` at the call sites**

In the notification engine where emails are dispatched, resolve `const branding = await brandingForCompany(companyId);` and pass `{ fromName: branding.emailFromName ?? branding.companyName }` to `sendEmail`.

- [ ] **Step 3: Verify (dev logs)**

Trigger a notification with email channel in dev; confirm the `[email:dev]` log shows the tenant's from-name.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0)

```bash
git add src/server/modules/notifications/delivery.ts src/server/modules/notifications
git commit -m "feat: outgoing notification emails use tenant from-name"
```

---

## Task 16: Settings UI — expand branding + add Company/Localization

**Files:**
- Modify: `src/server/modules/settings/actions.ts:213-243` (branding schema/action)
- Modify: `src/app/portal/settings/branding/*` (page + client form)

- [ ] **Step 1: Extend the branding schema + action**

In `src/server/modules/settings/actions.ts`, replace `brandingSchema` and `updateBrandingAction` with an expanded version covering the new fields:

```ts
const brandingSchema = z.object({
  logoUrl: z.string().max(500).optional().or(z.literal("")),
  faviconUrl: z.string().max(500).optional().or(z.literal("")),
  primaryColor: z.string().min(1).max(20),
  accentColor: z.string().min(1).max(20),
  fontFamily: z.string().max(80).optional().or(z.literal("")),
  recordPrefix: z.string().max(8).optional().or(z.literal("")),
  supportPhone: z.string().max(40).optional().or(z.literal("")),
  supportEmail: z.string().max(120).optional().or(z.literal("")),
  currencyCode: z.string().length(3),
  locale: z.string().min(2).max(12),
  emailFromName: z.string().max(80).optional().or(z.literal("")),
  customDomain: z.string().max(255).optional().or(z.literal("")),
  removePoweredBy: z.boolean().optional(),
});

export async function updateBrandingAction(input: z.infer<typeof brandingSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid branding values.");
  const d = parsed.data;
  const data = {
    logoUrl: d.logoUrl || null,
    faviconUrl: d.faviconUrl || null,
    primaryColor: d.primaryColor,
    accentColor: d.accentColor,
    fontFamily: d.fontFamily || null,
    recordPrefix: d.recordPrefix?.trim() || "",
    supportPhone: d.supportPhone || null,
    supportEmail: d.supportEmail || null,
    currencyCode: d.currencyCode.toUpperCase(),
    locale: d.locale,
    emailFromName: d.emailFromName || null,
    customDomain: d.customDomain?.trim().toLowerCase() || null,
    removePoweredBy: d.removePoweredBy ?? false,
  };
  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: data,
    create: { companyId: user.companyId, ...data },
  });
  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return ok();
}
```

- [ ] **Step 2: Add a company-name action (name lives on `Company`)**

Add to the same file:

```ts
const companyIdentitySchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  timezone: z.string().max(60),
});

export async function updateCompanyIdentityAction(input: z.infer<typeof companyIdentitySchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = companyIdentitySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid company values.");
  const d = parsed.data;
  await prisma.company.update({
    where: { id: user.companyId },
    data: {
      name: d.name,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      timezone: d.timezone,
    },
  });
  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return ok();
}
```

- [ ] **Step 3: Expand the Branding settings page UI**

In the branding settings page, load current values (`await brandingForCompany(user.companyId)` + the raw `Company` for name/address) and render two cards/tabs:
- **Branding:** logo URL, favicon URL, primary/accent color pickers, font select (curated list: `["", "Inter", "Roboto", "Open Sans", "Lato", "Poppins", "Source Sans 3"]` where `""` = system default), email from-name, a live preview of the wordmark and a sample `money`/`date`.
- **Company & Localization:** company name, record prefix (with helper "Used for new record numbers, e.g. `SR-1001`"), support phone/email, currency (ISO list), locale (curated list e.g. `en-US`, `en-GB`, `en-CA`, `es-MX`, `fr-FR`, `de-DE`), timezone, address fields, custom domain (with note: "Point a CNAME at your host, then enter it here"), remove-powered-by switch.

Wire submit to `updateBrandingAction` and `updateCompanyIdentityAction`. Use the existing settings form patterns in this file's sibling pages (`react-hook-form` + `toast`).

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (exit 0)

```bash
git add src/server/modules/settings/actions.ts src/app/portal/settings/branding
git commit -m "feat: settings UI for branding, identity, and localization"
```

---

## Task 17: Apply custom font + favicon in the portal head

**Files:**
- Modify: `src/app/portal/layout.tsx` (font CSS var + favicon link)

- [ ] **Step 1: Inject the font family + favicon**

In `src/app/portal/layout.tsx`, after resolving `branding`, render a `<style>` setting a CSS variable and a favicon link when set. Wrap the provider's children:

```tsx
  return (
    <BrandingProvider branding={branding}>
      {branding.fontFamily && (
        <style>{`:root{--tenant-font:${JSON.stringify(branding.fontFamily)};} .portal-root{font-family:var(--tenant-font),var(--font-sans),sans-serif;}`}</style>
      )}
      {/* existing PortalShell, with className="portal-root" added to its root wrapper */}
      ...
    </BrandingProvider>
  );
```

For the favicon: portal pages can export `generateMetadata` returning `{ icons: branding.faviconUrl ? [{ rel: "icon", url: branding.faviconUrl }] : undefined, title: { default: branding.companyName, template: \`%s · ${branding.companyName}\` } }`. Add this `generateMetadata` to `src/app/portal/layout.tsx`.

- [ ] **Step 2: Add `className="portal-root"` to PortalShell's outermost element**

In `portal-shell.tsx`, add `portal-root` to the root wrapper's className so the font variable applies.

- [ ] **Step 3: Verify + commit**

Manually set a font in settings, reload, confirm font changes and tab title shows the company name.

```bash
git add src/app/portal/layout.tsx src/components/portal/portal-shell.tsx
git commit -m "feat: per-tenant font + favicon + tab title in portal"
```

---

## Task 18: Seed backfill — Anexa tenant keeps today's values

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Set Anexa's branding/identity explicitly in the seed**

In `prisma/seed.ts`, where `CompanySettings` is created/upserted for the seeded company, set the new fields to today's literals so the existing tenant is unchanged:

```ts
recordPrefix: "AH-",
supportPhone: "(555) 200-7663",
supportEmail: "support@anexahomes.com",
currencyCode: "USD",
locale: "en-US",
emailFromName: "Anexa Homes",
primaryColor: "#0B0B0C",
accentColor: "#F4631E",
```

Ensure the seeded `Company` has `name: "Anexa Homes"`, Dallas address, and `timezone: "America/Chicago"` (already present — confirm).

- [ ] **Step 2: Reseed and verify**

Run: `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<consent text>" pnpm db:reset` (dev DB only)
Then load the portal: sidebar shows "Anexa Homes", a new deal's production number is `AH-1xxx`, amounts show `$`.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: seed Anexa tenant with explicit branding/identity defaults"
```

---

## Task 19: Tenant isolation tests (Playwright)

**Files:**
- Create: `e2e/branding-isolation.spec.ts`
- Modify: `e2e/global-setup.*` or seed helper to create a SECOND company with distinct branding (if a second tenant isn't already seeded).

- [ ] **Step 1: Seed a second tenant with distinct branding**

In the e2e seed/global-setup, create company B "Summit Roofing" with `recordPrefix: "SR-"`, `currencyCode: "EUR"`, `locale: "de-DE"`, `supportPhone: "(111) 222-3333"`, and an owner user `ownerb@summitroofing.test` / `Passw0rd!`.

- [ ] **Step 2: Write the isolation test**

Create `e2e/branding-isolation.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers"; // use the repo's existing login helper

test("each tenant sees only its own brand identity", async ({ page }) => {
  // Company A (Anexa)
  await login(page, "owner@anexahomes.com", "Passw0rd!");
  await expect(page.getByText("Anexa Homes").first()).toBeVisible();
  await expect(page.getByText(/Support: \(555\) 200-7663/)).toBeVisible();

  // Company B (Summit)
  await login(page, "ownerb@summitroofing.test", "Passw0rd!");
  await expect(page.getByText("Summit Roofing").first()).toBeVisible();
  await expect(page.getByText(/Support: \(111\) 222-3333/)).toBeVisible();
  await expect(page.getByText("Anexa Homes")).toHaveCount(0);
});

test("editing company B branding does not change company A", async ({ page }) => {
  await login(page, "ownerb@summitroofing.test", "Passw0rd!");
  await page.goto("/portal/settings/branding");
  await page.getByLabel("Company name").fill("Summit Roofing Co");
  await page.getByRole("button", { name: /save/i }).first().click();
  await expect(page.getByText(/saved/i)).toBeVisible();

  await login(page, "owner@anexahomes.com", "Passw0rd!");
  await expect(page.getByText("Anexa Homes").first()).toBeVisible();
  await expect(page.getByText("Summit Roofing")).toHaveCount(0);
});
```

> Use the repo's actual login helper signature; if there isn't one, inline the login steps used by other specs.

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm db:seed && pnpm e2e e2e/branding-isolation.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 4: Commit**

```bash
git add e2e/branding-isolation.spec.ts e2e/global-setup.* prisma
git commit -m "test: tenant isolation for branding/identity"
```

---

## Task 20: Final grep guard + full verification

**Files:** none (verification only)

- [ ] **Step 1: Grep portal code for residual hardcoded identity**

Run:

```bash
grep -rn "Anexa Homes" src/app/portal src/components/portal
grep -rn "AH-" src/server/modules/projects src/app/portal src/components/portal
grep -rn "555) 200-7663" src/app/portal src/components/portal
grep -rn "from \"@/lib/format\"" src/app/portal src/components/portal | grep -vE "initials"
```

Expected: **no user-facing hits.** (Marketing site `src/app/(marketing)` and `src/lib/site.ts` are intentionally excluded.) Any portal hit found → migrate it to branding, commit, re-run.

- [ ] **Step 2: Full typecheck + unit + build**

Run:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected: tsc exit 0, all unit tests pass, build succeeds. (Remember: delete `.next` before returning to `pnpm dev` per the project's Turbopack gotcha.)

- [ ] **Step 3: Full e2e regression**

Run: `pnpm db:seed && pnpm e2e`
Expected: all specs pass (existing suite + the new isolation spec).

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: white-label brand/identity verification fixes"
```

---

## Self-Review Notes (author)

- **Spec coverage:** name (T9/T16/T18), prefix (T10/T16/T18), support phone (T9/T11/T16), currency+locale (T4/T6/T7/T12/T16), timezone (T6/T16), address (T16), logo+favicon (T9/T17), login branding (T14), email branding (T15), font (T17), custom domain + remove-powered-by (T6/T14/T16), migration+seed (T2/T18), safe-edit (T10 — prefix only affects new records), isolation tests (T19), grep guard (T12/T20). All spec sections map to tasks.
- **Deferred-by-design (not gaps):** business-hours UI is data-modeled (T2 `businessHours` JSON) but a dedicated editor is left as a thin follow-up; richer email-template editing beyond from-name/logo is a later pass (noted in spec "Open items").
- **Type consistency:** `Branding` shape defined once in `defaults.ts` and imported everywhere; `useFormat()`/`currentFormatters()`/`formattersFor()` all return the same `{money,date,dateTime}` surface built from `format-core`.
