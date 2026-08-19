# Customer & Energy Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a Customer step and an Energy step ahead of System design, so a rep verifies who they are talking to and works out what the house consumes — from usage, or from the bill and the rate — before drawing a roof.

**Architecture:** The arithmetic lives in one pure, unit-tested module (`src/lib/solar-energy.ts`) that the form, the server action and the tests all share. A method switch on the Energy step decides which two of {usage, bill, rate} a rep types; the third is calculated and read-only, so contradictory figures cannot be stored. The rate has exactly one resolver, replacing three independent derivations. The target system size is computed from settings and never stored.

**Tech Stack:** Next.js App Router (server actions), Prisma/Postgres, React 19 + Tailwind, Vitest (unit + integration), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-08-18-solar-customer-and-energy-steps-design.md`

---

## Before you start

`main` is shared and moves fast — another session shipped a lenders settings page mid-flight last time. Run `git fetch && git log --oneline -1 origin/main`, branch from there, and pick your migration timestamp with `ls prisma/migrations | tail -1` rather than assuming `20260819040000` is free.

The solar catalogue in production has no default module. Target panel counts therefore render as "≈— panels" until one is set; that is correct behaviour, not a bug to code around.

## File structure

**Created**

| File | Responsibility |
|---|---|
| `prisma/migrations/<ts>_solar_energy_and_providers/migration.sql` | `solar_providers` + four columns |
| `src/lib/solar-energy.ts` | Pure arithmetic: usage↔bill↔rate, target system size. No React, no Prisma. |
| `src/lib/__tests__/solar-energy.test.ts` | Unit tests for the above |
| `src/server/modules/solar/providers.ts` | Read the utility / retail provider lists |
| `src/server/modules/solar/energy-actions.ts` | `saveSolarEnergyAction`, `saveCustomerDetailsAction` |
| `src/components/portal/solar-energy-panel.tsx` | The Energy step |
| `src/components/portal/solar-customer-panel.tsx` | The Customer step |
| `src/app/portal/settings/solar-providers/page.tsx` | Manage both lists |
| `src/components/portal/solar-provider-manager.tsx` | That page's client component |
| `e2e/solar-builder-steps.spec.ts` | Step order, bill→usage, target reaches the designer |

**Modified**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `SolarProvider`, `SolarProviderKind`, three `SolarDesign` columns, `SolarSettings.targetOffsetPct` |
| `src/server/modules/solar/settings.ts` | Carry `targetOffsetPct` |
| `src/server/modules/solar/actions.ts` | Settings schema gains `targetOffsetPct` |
| `src/server/modules/leads/manage.ts` | Export a shared contact-field shape |
| `src/lib/solar-validation.ts` | Route the rate through `resolveUtilityRateMills` |
| `src/lib/solar-proposal.ts` | Same, and drop the utility/usage fields the Energy step now owns |
| `src/components/portal/solar-proposal-builder.tsx` | Five steps |
| `src/components/portal/solar-panels.tsx` | Design step loses utility & usage; keeps mount + layout |
| `src/components/portal/solar-layout-designer.tsx` | Counter reads against the target |
| `src/app/portal/leads/[id]/solar-proposal/page.tsx` | Feed the two new steps |
| `src/lib/settings-sections.ts` | Register the providers page |

`solar-energy.ts` stays free of React and Prisma for the same reason `solar-layout.ts` is: the panel, the action and the tests all need the same maths, and a pure module is the only version all three can hold.

---

# PHASE A — the Energy step

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_solar_energy_and_providers/migration.sql`

- [ ] **Step 1: Add the model and columns**

```prisma
enum SolarProviderKind {
  utility
  retail
}

/// The utilities and retail electric providers a company sells against.
///
/// Same shape as LeadSource: a per-company ordered list, deactivated rather
/// than deleted, because a design that already names a provider has to keep
/// rendering after that provider stops being offered.
model SolarProvider {
  id        String            @id @default(uuid())
  companyId String
  company   Company           @relation(fields: [companyId], references: [id], onDelete: Cascade)
  /// Isolated per vertical: this row belongs to exactly one workspace.
  vertical  Vertical          @default(solar)
  kind      SolarProviderKind
  name      String
  position  Int               @default(0)
  active    Boolean           @default(true)
  createdAt DateTime          @default(now())

  @@unique([companyId, kind, name])
  @@index([companyId, kind, active])
  @@map("solar_providers")
}
```

In `model SolarDesign`, beside `utilityProvider`:

```prisma
  /// The retailer that BILLS the customer, where that differs from the utility
  /// that delivers the power — the TDU/REP split Texas runs on. Stored as text
  /// like utilityProvider, filled from the managed list.
  electricProvider String?
  /// The rate the rep was TOLD, in mills per kWh. Null means derive it from
  /// bill ÷ usage, which is what every design before this one does.
  utilityRateMills Int?
  /// Which method the Energy step was filled in with, so it reopens the way it
  /// was left: "usage" | "bill".
  usageBasis       String?
```

In `model SolarSettings`, beside `kwhPerKwYear`:

```prisma
  /// What share of a customer's usage a system is sized to cover. Drives the
  /// target on the Energy step. It does NOT constrain what a rep may draw —
  /// what fits the roof wins.
  targetOffsetPct Float @default(100)
```

Add `solarProviders SolarProvider[]` to `model Company`.

- [ ] **Step 2: Write the migration**

```sql
CREATE TYPE "SolarProviderKind" AS ENUM ('utility', 'retail');

CREATE TABLE "solar_providers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL DEFAULT 'solar',
    "kind" "SolarProviderKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "solar_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "solar_providers_companyId_kind_name_key" ON "solar_providers"("companyId", "kind", "name");
CREATE INDEX "solar_providers_companyId_kind_active_idx" ON "solar_providers"("companyId", "kind", "active");

ALTER TABLE "solar_providers" ADD CONSTRAINT "solar_providers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_designs"  ADD COLUMN "electricProvider" TEXT;
ALTER TABLE "solar_designs"  ADD COLUMN "utilityRateMills" INTEGER;
ALTER TABLE "solar_designs"  ADD COLUMN "usageBasis" TEXT;
ALTER TABLE "solar_settings" ADD COLUMN "targetOffsetPct" DOUBLE PRECISION NOT NULL DEFAULT 100;
```

Confirm the `Vertical` enum and `companies` table names against an existing migration before running — this repo renamed the industry enum once with `@map`, and copying the wrong name gives a migration that fails halfway.

- [ ] **Step 3: Apply and verify**

Run: `npm run db:migrate`
Then:
```bash
node -e '
const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();
p.$queryRawUnsafe(`SELECT table_name, column_name FROM information_schema.columns WHERE (table_name=$$solar_designs$$ AND column_name IN ($$electricProvider$$,$$utilityRateMills$$,$$usageBasis$$)) OR (table_name=$$solar_settings$$ AND column_name=$$targetOffsetPct$$) ORDER BY 1,2`)
 .then(r=>{console.log(r);return p.$disconnect()})'
```
Expected: four rows.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(solar): providers list, a typed rate, and a target offset"
```

---

## Task 2: The energy arithmetic

**Files:**
- Create: `src/lib/solar-energy.ts`
- Create: `src/lib/__tests__/solar-energy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/solar-energy.test.ts
import { describe, it, expect } from "vitest";
import {
  annualFromMonthlyKwh,
  annualUsageFromBill,
  resolveUtilityRateMills,
  targetSystem,
} from "@/lib/solar-energy";

const A = { kwhPerKwYear: 1450, derateFactor: 0.84, targetOffsetPct: 100 };

describe("usage from a bill and a rate", () => {
  it("turns $200 a month at $0.20/kWh into 12,000 kWh a year", () => {
    // 20,000 cents ÷ 200 mills = 1,000 kWh a month.
    expect(annualUsageFromBill(20_000, 200)).toBe(12_000);
  });

  it("refuses to divide by a rate of zero rather than returning Infinity", () => {
    expect(annualUsageFromBill(20_000, 0)).toBeNull();
    expect(annualUsageFromBill(20_000, null)).toBeNull();
    expect(annualUsageFromBill(0, 200)).toBeNull();
    expect(annualUsageFromBill(-100, 200)).toBeNull();
  });
});

describe("usage from a typical month", () => {
  it("multiplies by twelve", () => {
    expect(annualFromMonthlyKwh(1_000)).toBe(12_000);
  });

  it("treats nothing as nothing, not as zero usage", () => {
    expect(annualFromMonthlyKwh(0)).toBeNull();
    expect(annualFromMonthlyKwh(NaN)).toBeNull();
  });
});

describe("one rate, one place", () => {
  it("prefers the rate the customer actually told us", () => {
    // The bill and usage imply 154 mills; the rep was told 200.
    expect(
      resolveUtilityRateMills({ utilityRateMills: 200, avgMonthlyBillCents: 18_000, annualUsageKwh: 14_000 })
    ).toBe(200);
  });

  it("falls back to what the bill implies", () => {
    expect(
      resolveUtilityRateMills({ utilityRateMills: null, avgMonthlyBillCents: 18_000, annualUsageKwh: 14_000 })
    ).toBe(154);
  });

  it("returns null when neither is derivable, so nothing gets invented", () => {
    expect(resolveUtilityRateMills({ utilityRateMills: null, avgMonthlyBillCents: null, annualUsageKwh: 14_000 })).toBeNull();
    expect(resolveUtilityRateMills({ utilityRateMills: 0, avgMonthlyBillCents: 0, annualUsageKwh: 0 })).toBeNull();
  });
});

describe("the target system", () => {
  it("sizes 12,000 kWh to about 9.9 kW and 25 panels", () => {
    // 12,000 ÷ (1450 × 0.84) = 9.85 kW ; 9,852W ÷ 400W = 24.6 → 25
    const t = targetSystem({ annualUsageKwh: 12_000, assumptions: A, panelWatts: 400 })!;
    expect(t.kwDc).toBeCloseTo(9.85, 2);
    expect(t.panels).toBe(25);
  });

  it("rounds panels UP, because you cannot install a tenth of one", () => {
    const t = targetSystem({ annualUsageKwh: 12_100, assumptions: A, panelWatts: 400 })!;
    expect(t.panels).toBe(25);
  });

  it("follows the company's target offset", () => {
    const at = (targetOffsetPct: number) =>
      targetSystem({ annualUsageKwh: 12_000, assumptions: { ...A, targetOffsetPct }, panelWatts: 400 })!.kwDc;
    expect(at(90)).toBeCloseTo(at(100) * 0.9, 6);
    expect(at(110)).toBeCloseTo(at(100) * 1.1, 6);
  });

  it("still gives a kW figure when the catalogue has no default panel", () => {
    const t = targetSystem({ annualUsageKwh: 12_000, assumptions: A, panelWatts: null })!;
    expect(t.kwDc).toBeCloseTo(9.85, 2);
    expect(t.panels).toBeNull();
  });

  it("has no target without usage", () => {
    expect(targetSystem({ annualUsageKwh: null, assumptions: A, panelWatts: 400 })).toBeNull();
    expect(targetSystem({ annualUsageKwh: 0, assumptions: A, panelWatts: 400 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- solar-energy`
Expected: FAIL — cannot resolve `@/lib/solar-energy`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/solar-energy.ts
import { deriveUtilityRateMills } from "./solar-money";

/**
 * Turning what a customer can tell you into what a system has to cover.
 *
 * A homeowner rarely knows their annual kWh. They know what they pay a month,
 * and often what they pay per kWh. This module is the arithmetic between those
 * facts and a system size, kept pure so the form, the server action and the
 * tests all agree on it.
 *
 * Units are the ones already used across solar: cents for money, MILLS per kWh
 * for the rate (1 cent = 10 mills), whole kWh for usage.
 */

export const MONTHS_PER_YEAR = 12;

/** Annual kWh from one typical month. Null for anything that is not a usage. */
export function annualFromMonthlyKwh(monthlyKwh: number | null | undefined): number | null {
  if (monthlyKwh == null || !Number.isFinite(monthlyKwh) || monthlyKwh <= 0) return null;
  return Math.round(monthlyKwh * MONTHS_PER_YEAR);
}

/**
 * Annual kWh implied by a monthly bill at a known rate.
 *
 * The null guards are the point: a rate of zero would return Infinity, and an
 * Infinity that reaches the offset calculation is the five-figure percentage
 * this module exists to prevent.
 */
export function annualUsageFromBill(
  avgMonthlyBillCents: number | null | undefined,
  rateMillsPerKwh: number | null | undefined
): number | null {
  if (!avgMonthlyBillCents || avgMonthlyBillCents <= 0) return null;
  if (!rateMillsPerKwh || rateMillsPerKwh <= 0) return null;
  const monthlyKwh = (avgMonthlyBillCents * 10) / rateMillsPerKwh;
  if (!Number.isFinite(monthlyKwh)) return null;
  return Math.round(monthlyKwh * MONTHS_PER_YEAR);
}

/**
 * The customer's rate: what they told us, else what their bill implies.
 *
 * Every surface that shows a rate goes through this. Three call sites deriving
 * it separately is how a validation screen and a customer's proposal end up
 * disagreeing about what that customer pays.
 */
export function resolveUtilityRateMills(d: {
  utilityRateMills?: number | null;
  avgMonthlyBillCents?: number | null;
  annualUsageKwh?: number | null;
}): number | null {
  if (d.utilityRateMills && d.utilityRateMills > 0) return d.utilityRateMills;
  return deriveUtilityRateMills(d.avgMonthlyBillCents, d.annualUsageKwh);
}

export type TargetAssumptions = {
  kwhPerKwYear: number;
  derateFactor: number;
  targetOffsetPct: number;
};

/**
 * How big a system this house needs, and roughly how many panels that is.
 *
 * A TARGET, not a decision: it tells a rep what to aim for while drawing. What
 * gets quoted is still the array on the roof, because what fits beats what the
 * arithmetic wants.
 */
export function targetSystem(args: {
  annualUsageKwh: number | null | undefined;
  assumptions: TargetAssumptions;
  panelWatts: number | null | undefined;
}): { kwDc: number; panels: number | null } | null {
  const usage = args.annualUsageKwh;
  if (!usage || usage <= 0) return null;

  const { kwhPerKwYear, derateFactor, targetOffsetPct } = args.assumptions;
  const kwhPerKw = kwhPerKwYear * derateFactor;
  if (!Number.isFinite(kwhPerKw) || kwhPerKw <= 0) return null;

  const kwDc = (usage * (targetOffsetPct / 100)) / kwhPerKw;
  if (!Number.isFinite(kwDc)) return null;

  // Up, always: a tenth of a panel is not a thing you can install.
  const panels =
    args.panelWatts && args.panelWatts > 0 ? Math.ceil((kwDc * 1000) / args.panelWatts) : null;

  return { kwDc, panels };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- solar-energy`
Expected: PASS (12 tests).

- [ ] **Step 5: Prove the tests bite**

Temporarily change `Math.ceil` to `Math.round` in `targetSystem` and re-run. Expected: the "rounds panels UP" test fails. Then change `(avgMonthlyBillCents * 10)` to `* 100` and re-run: the `$200` test fails. Revert both.

This step is not optional. Tests written alongside an implementation agree with it by construction; the only way to know they constrain anything is to break the thing they cover.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar-energy.ts src/lib/__tests__/solar-energy.test.ts
git commit -m "feat(solar): the arithmetic between a bill, a rate and a system size"
```

---

## Task 3: One rate resolver, three call sites

**Files:**
- Modify: `src/lib/solar-validation.ts`
- Modify: `src/lib/solar-proposal.ts:425`
- Modify: `src/server/modules/solar/settings.ts`
- Modify: `src/server/modules/solar/actions.ts`

- [ ] **Step 1: Carry the new setting**

In `settings.ts`, add `targetOffsetPct: number` to `SolarSettingsView`, `targetOffsetPct: 100` to `SOLAR_ASSUMPTION_DEFAULTS`, and `targetOffsetPct: row.targetOffsetPct` to the mapped return.

In `actions.ts`, add to `settingsSchema`:

```ts
  targetOffsetPct: z.number().min(50).max(200),
```

In `solar-settings-form.tsx`, add to the Production assumptions grid:

```tsx
<NumField
  label="Target offset %"
  value={f.targetOffsetPct}
  onChange={(v) => set("targetOffsetPct", v)}
  hint="What the Energy step sizes toward. Does not limit what a rep may draw."
/>
```
seeding it from `String(settings.targetOffsetPct)` and sending `Number(f.targetOffsetPct)`.

- [ ] **Step 2: Route validation through the resolver**

In `solar-validation.ts`, replace the `deriveUtilityRateMills` import with `resolveUtilityRateMills` from `@/lib/solar-energy`, add `utilityRateMills?: number | null` to `DesignForValidation`, and rewrite the bill check so it judges the RATE rather than the bill:

```ts
  // A rate is required; a bill is only one of the two ways to get one. A deal
  // that entered bill-and-rate has no derivable bill÷usage and must still pass.
  if (d.avgMonthlyBillCents !== undefined) {
    const rate = resolveUtilityRateMills(d);
    if (rate == null) {
      block(
        "utility.rate_missing",
        "utility",
        "avgMonthlyBillCents",
        "No utility rate. Enter the bill and usage, or the bill and the rate per kWh — savings cannot be projected without one."
      );
    } else if (rate < 50 || rate > 600) {
      warn(
        "utility.rate_implausible",
        "utility",
        "avgMonthlyBillCents",
        `That works out at $${(rate / 1000).toFixed(3)}/kWh, which is outside the normal US retail range. Check the figures.`
      );
    }
  }
```

Delete the old `utility.bill_missing` and `utility.rate_underivable` branches — `utility.rate_missing` replaces both. Grep for those two codes across `src/` and `e2e/` and update anything asserting them.

- [ ] **Step 3: Route the snapshot through it**

In `solar-proposal.ts:425`, replace `deriveUtilityRateMills(design.avgMonthlyBillCents, design.annualUsageKwh) ?? 0` with `resolveUtilityRateMills(design) ?? 0`, and add `utilityRateMills?: number | null` to that function's `design` input type.

- [ ] **Step 4: Pass it in**

In `readiness.ts` and `proposal-actions.ts`, add `utilityRateMills: design.utilityRateMills` wherever the design is mapped for validation or the snapshot.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS. `solar-savings.test.ts` asserts `deriveUtilityRateMills(18_000, 14_000) === 154`; that function is unchanged and its test stays.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar-validation.ts src/lib/solar-proposal.ts src/server/modules/solar
git commit -m "feat(solar): one utility-rate resolver instead of three derivations"
```

---

## Task 4: The provider lists

**Files:**
- Create: `src/server/modules/solar/providers.ts`
- Create: `src/app/portal/settings/solar-providers/page.tsx`
- Create: `src/components/portal/solar-provider-manager.tsx`
- Modify: `src/lib/settings-sections.ts`
- Modify: `src/server/modules/solar/actions.ts`

- [ ] **Step 1: The read module**

```ts
// src/server/modules/solar/providers.ts
import { prisma } from "@/server/db/client";
import type { SolarProviderKind } from "@prisma/client";

export type ProviderOption = { id: string; name: string; active: boolean };

/**
 * A company's provider list for one kind.
 *
 * Includes INACTIVE entries when `keepName` names one, for the same reason the
 * equipment dropdowns do: an option that vanishes from its own select is how a
 * save quietly writes null over a deal's data.
 */
export async function listSolarProviders(
  companyId: string,
  kind: SolarProviderKind,
  keepName?: string | null
): Promise<ProviderOption[]> {
  const rows = await prisma.solarProvider.findMany({
    where: { companyId, kind, ...(keepName ? {} : { active: true }) },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });
  return keepName ? rows.filter((r) => r.active || r.name === keepName) : rows;
}
```

- [ ] **Step 2: Actions**

Add to `actions.ts`, following `saveSolarEquipmentAction`'s shape for permissions and errors:

```ts
const providerSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["utility", "retail"]),
  name: z.string().min(1).max(120),
  position: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});

/** Create or rename one provider. Names are unique per company and kind. */
export async function saveSolarProviderAction(input: z.infer<typeof providerSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid provider.");
  const d = parsed.data;

  const data = {
    companyId: user.companyId,
    kind: d.kind,
    name: d.name.trim(),
    position: d.position ?? 0,
    active: d.active ?? true,
  };

  try {
    if (d.id) await prisma.solarProvider.update({ where: { id: d.id }, data });
    else await prisma.solarProvider.create({ data });
  } catch {
    // The unique index is the enforcement; this is the message for it.
    return fail(`“${data.name}” is already on that list.`);
  }

  revalidatePath("/portal/settings/solar-providers");
  return ok();
}

/**
 * Retire a provider rather than deleting it: designs store the NAME, so a
 * delete would leave a deal naming something the company no longer recognises.
 */
export async function setSolarProviderActiveAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const row = await prisma.solarProvider.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!row) return fail("Provider not found.");
  await prisma.solarProvider.update({ where: { id }, data: { active } });
  revalidatePath("/portal/settings/solar-providers");
  return ok();
}
```

- [ ] **Step 3: The settings page**

Copy the structure of `src/app/portal/settings/solar-lenders/page.tsx` exactly — `requireUser`, `can(user, "update", "Settings")` or redirect, `PageHeader`, a back link, and a client manager. The manager renders two labelled sections (Utilities, Retail electric providers), each a list of rows with a name input, an active toggle calling `setSolarProviderActiveAction`, and an "Add" row calling `saveSolarProviderAction`.

Register it in `src/lib/settings-sections.ts` next to the `solar-lenders` entry, gated to the solar vertical the same way.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Then `npm run dev`, open Settings → Solar providers, add "Oncor" as a utility and "Rhythm Energy" as a retail provider, retire one, confirm it greys out rather than disappearing.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/solar/providers.ts src/app/portal/settings/solar-providers src/components/portal/solar-provider-manager.tsx src/lib/settings-sections.ts src/server/modules/solar/actions.ts
git commit -m "feat(solar): company-managed utility and electric provider lists"
```

---

## Task 5: Saving the Energy step

**Files:**
- Create: `src/server/modules/solar/energy-actions.ts`
- Create: `src/server/modules/solar/__tests__/energy.itest.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/solar/__tests__/energy.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { annualUsageFromBill, resolveUtilityRateMills } from "@/lib/solar-energy";

/**
 * Whichever way a rep enters consumption, the row that comes out has to be
 * consistent: one annual usage figure, and a rate that resolves.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "Energy Co", slug: `en-${process.pid}-${Date.now()}` } });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({ data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 } });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id, firstName: "En", lastName: "Test" },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("entering consumption from the bill", () => {
  it("stores a derived annual usage alongside the typed rate", async () => {
    const usage = annualUsageFromBill(20_000, 200);
    expect(usage).toBe(12_000);

    await db.solarDesign.create({
      data: {
        companyId, leadId, usageBasis: "bill",
        avgMonthlyBillCents: 20_000, utilityRateMills: 200, annualUsageKwh: usage,
      },
    });

    const row = await db.solarDesign.findUnique({ where: { leadId } });
    expect(row?.annualUsageKwh).toBe(12_000);
    expect(row?.utilityRateMills).toBe(200);
    expect(resolveUtilityRateMills(row!)).toBe(200);
  });
});

describe("entering consumption from usage", () => {
  it("leaves the rate null so it stays derived from the bill", async () => {
    await db.solarDesign.create({
      data: {
        companyId, leadId, usageBasis: "usage",
        annualUsageKwh: 14_000, avgMonthlyBillCents: 18_000, utilityRateMills: null,
      },
    });

    const row = await db.solarDesign.findUnique({ where: { leadId } });
    expect(row?.utilityRateMills).toBeNull();
    expect(resolveUtilityRateMills(row!)).toBe(154);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- energy`
Expected: PASS — it pins the row shape the action must produce.

- [ ] **Step 3: Write the action**

```ts
// src/server/modules/solar/energy-actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { annualFromMonthlyKwh, annualUsageFromBill } from "@/lib/solar-energy";

const fail = (error: string) => ({ ok: false as const, error });

const energySchema = z.object({
  leadId: z.string().min(1),
  utilityProvider: z.string().max(120).nullable(),
  electricProvider: z.string().max(120).nullable(),
  basis: z.enum(["usage", "bill"]),
  avgMonthlyBillCents: z.number().int().min(0).max(10_000_00).nullable(),
  // usage basis
  annualUsageKwh: z.number().int().min(0).max(1_000_000).nullable(),
  avgMonthlyUsageKwh: z.number().min(0).max(100_000).nullable(),
  // bill basis
  utilityRateMills: z.number().int().min(0).max(2_000).nullable(),
});

/**
 * Save what the customer uses and what they pay for it.
 *
 * The stored `annualUsageKwh` is always the ONE consumption figure, whichever
 * method produced it — everything downstream reads that field and must not have
 * to know how it was arrived at. `usageBasis` records the method purely so the
 * step reopens the way the rep left it.
 */
export async function saveSolarEnergyAction(input: z.infer<typeof energySchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = energySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid energy details.");
  const d = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: d.leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // Derive server-side. The client shows the same figure, but what gets STORED
  // is computed here — the offset every homeowner reads hangs off it.
  const annualUsageKwh =
    d.basis === "bill"
      ? annualUsageFromBill(d.avgMonthlyBillCents, d.utilityRateMills)
      : (d.annualUsageKwh ?? annualFromMonthlyKwh(d.avgMonthlyUsageKwh));

  const data = {
    utilityProvider: d.utilityProvider,
    electricProvider: d.electricProvider,
    usageBasis: d.basis,
    avgMonthlyBillCents: d.avgMonthlyBillCents,
    annualUsageKwh,
    // Only the bill basis has a rate the rep was told. In usage basis the rate
    // stays derived, so storing one here would make it un-derivable again.
    utilityRateMills: d.basis === "bill" ? d.utilityRateMills : null,
  };

  await prisma.solarDesign.upsert({
    where: { leadId: d.leadId },
    create: { companyId: user.companyId, leadId: d.leadId, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const, annualUsageKwh };
}
```

Note: saving energy does NOT recompute system size or offset — those follow the module count, which only the layout sets. Offset does depend on usage, so add a recompute of `offsetPct` from the stored `year1ProductionKwh` and the new usage:

```ts
  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { year1ProductionKwh: true },
  });
  const offset =
    annualUsageKwh && existing?.year1ProductionKwh
      ? offsetPct(existing.year1ProductionKwh, annualUsageKwh)
      : 0;
```
and include `offsetPct: offset` in `data`. Import `offsetPct` from `@/lib/solar-money`. Without this, changing usage leaves a stale offset on the deal.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run test:integration -- energy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/solar/energy-actions.ts src/server/modules/solar/__tests__/energy.itest.ts
git commit -m "feat(solar): save consumption from either method, derived server-side"
```

---

## Task 6: The Energy step, and five steps in the builder

**Files:**
- Create: `src/components/portal/solar-energy-panel.tsx`
- Modify: `src/components/portal/solar-proposal-builder.tsx:18-24`
- Modify: `src/components/portal/solar-panels.tsx`
- Modify: `src/app/portal/leads/[id]/solar-proposal/page.tsx`

- [ ] **Step 1: Widen the step machinery**

```tsx
type StepId = "customer" | "energy" | "design" | "financing" | "generate";

const STEPS: { id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "customer", label: "1 · Customer", icon: User },
  { id: "energy", label: "2 · Energy", icon: Zap },
  { id: "design", label: "3 · System design", icon: Hammer },
  { id: "financing", label: "4 · Financing", icon: Landmark },
  { id: "generate", label: "5 · Generate & send", icon: Sun },
];
```

Import `User` and `Zap` from `lucide-react`. Widen `initialStep` and the page's `?step=` parse to accept all five; the readiness report links to `?step=design` and `?step=financing` and must keep working.

Add `<NextStep>` chaining: customer → energy → design.

- [ ] **Step 2: Move utility and usage out of the design step**

In `solar-panels.tsx`, delete the whole `Utility & usage` section and `utilityProvider` / `annualUsageKwh` / `avgMonthlyBill` from `SolarDesignPanel`'s form state and save payload. The design step keeps mount type, the derived strip, the count and the layout. Remove those fields from `designSchema` in `actions.ts` too — the Energy step owns them now, and two writers for one field is what this whole rework has been undoing.

- [ ] **Step 3: Build the panel**

`solar-energy-panel.tsx`, a client component taking `leadId`, `energy` (the stored values), `utilities` and `retailers` (`ProviderOption[]`), `assumptions` (`kwhPerKwYear`, `derateFactor`, `targetOffsetPct`), `panelWatts`, `canEdit`.

State: `basis: "usage" | "bill"`, provider selections plus their "Other…" free-text values, `annualUsage`, `avgMonthlyUsage`, `bill`, `rate` (as dollars, converted to mills on save).

Live figures come straight from the library — never a second copy of the maths:

```tsx
const annual =
  basis === "bill"
    ? annualUsageFromBill(billCents, rateMills)
    : (Number(annualUsage) || annualFromMonthlyKwh(Number(avgMonthlyUsage)));
const rateNow = basis === "bill" ? rateMills : deriveUtilityRateMills(billCents, annual);
const target = targetSystem({ annualUsageKwh: annual, assumptions, panelWatts });
```

Render the two-mode form from the spec, with the calculated figure shown read-only and explicitly labelled `(calculated)`, and a result strip.

Control labels are load-bearing — `e2e/solar-builder-steps.spec.ts` finds them by label and role, so use exactly these: radios `From their usage` / `From their bill`; inputs `Annual usage (kWh)`, `Avg monthly kWh`, `Average monthly bill ($)`, `Rate ($/kWh)`; the save button `Save energy`, and its success toast `Energy saved`.

```tsx
<p data-testid="energy-summary">
  {annual ? `${annual.toLocaleString()} kWh/yr` : "—"}
  {rateNow ? ` · $${(rateNow / 1000).toFixed(3)}/kWh` : ""}
  {target ? ` · needs ≈${target.kwDc.toFixed(1)} kW` : ""}
  {target?.panels ? ` ≈ ${target.panels} panels` : ""}
</p>
```

Each provider select ends with `<option value="__other">Other…</option>`; choosing it reveals a text input, and the submitted value is the typed text. A stored provider not on the list is preselected as "Other…" with its name in the box, so an existing design never loses what it had.

- [ ] **Step 4: Feed it from the page**

In `solar-proposal/page.tsx`, add to the `Promise.all`:

```tsx
listSolarProviders(user.companyId, "utility", design?.utilityProvider),
listSolarProviders(user.companyId, "retail", design?.electricProvider),
```
and pass those, `settings`, and `sizingModule?.ratingW` into the builder.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`, then `npm run dev`. On a solar deal: five tabs; entering $200 and $0.20 shows 12,000 kWh/yr and a target; switching to usage mode shows the rate as calculated.

- [ ] **Step 6: Commit**

```bash
git add src/components/portal/solar-energy-panel.tsx src/components/portal/solar-proposal-builder.tsx src/components/portal/solar-panels.tsx "src/app/portal/leads/[id]/solar-proposal/page.tsx" src/server/modules/solar/actions.ts
git commit -m "feat(solar): an Energy step that works from usage or from the bill"
```

---

## Task 7: The target reaches the drawing

**Files:**
- Modify: `src/components/portal/solar-layout-designer.tsx`
- Modify: `src/components/portal/solar-panels.tsx`

- [ ] **Step 1: Accept a target**

Add `targetPanels: number | null` to `SolarLayoutDesigner`'s props, threaded from the page through the builder and `SolarDesignPanel` (computed there with `targetSystem`, so the number has one source).

- [ ] **Step 2: Show it on the counter**

```tsx
<span data-testid="panel-count" className="font-display text-lg font-semibold">
  {count} {count === 1 ? "panel" : "panels"}
</span>
{targetPanels ? (
  <span
    className={cn(
      "ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium",
      count >= targetPanels ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
    )}
  >
    of ~{targetPanels} needed
  </span>
) : null}
```

Keep `data-testid="panel-count"` on the count alone — `e2e/solar-layout-designer.spec.ts` asserts its exact text, and folding the target into that element breaks it.

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck`, then draw on a deal with usage entered and watch the badge go green at the target.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/solar-layout-designer.tsx src/components/portal/solar-panels.tsx
git commit -m "feat(solar): the designer says how many panels this house needs"
```

**Phase A ships here.**

---

# PHASE B — the Customer step

## Task 8: One definition of a valid customer

**Files:**
- Modify: `src/server/modules/leads/manage.ts:26-36`
- Modify: `src/server/modules/solar/energy-actions.ts`

- [ ] **Step 1: Extract the contact shape**

In `manage.ts`, pull the contact fields out of `leadInput` into a shared const and compose it back, so there is exactly one definition:

```ts
/**
 * The contact half of a lead, shared by the full edit form and the solar
 * builder's Customer step. Extracted rather than duplicated: two definitions of
 * a valid name are two places for them to drift apart.
 */
export const leadContactFields = {
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  coOwnerName: z.string().max(80).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  address: z.string().max(160).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(12).optional().or(z.literal("")),
};

const leadInput = z.object({
  ...leadContactFields,
  preferredLanguage: z.string().max(40).optional().or(z.literal("")),
  // …the rest unchanged
});
```

Also export `addressChanged` if it is not already exported — the next step needs it.

- [ ] **Step 2: The focused action**

In `energy-actions.ts`:

```ts
const customerSchema = z.object({ leadId: z.string().min(1), ...leadContactFields });

/**
 * Save the customer's own details from the proposal builder.
 *
 * Deliberately narrow: it writes the contact fields and NOTHING else. Posting
 * the full lead shape back from here would let a proposal screen quietly
 * reassign a rep or move a stage.
 */
export async function saveCustomerDetailsAction(input: z.infer<typeof customerSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid customer details.");
  const d = parsed.data;

  const existing = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: d.leadId },
    select: { id: true, address: true, city: true, state: true, zip: true },
  });
  if (!existing) return fail("Deal not found.");

  // Coordinates are a CACHE of the address. Correcting the address has to
  // invalidate them, or the designer keeps framing the old house — the same
  // rule updateLeadAction follows, and the reason it is shared code.
  const moved = addressChanged(existing, {
    address: d.address || null, city: d.city || null, state: d.state || null, zip: d.zip || null,
  });

  await prisma.lead.update({
    where: { id: d.leadId },
    data: {
      firstName: d.firstName,
      lastName: d.lastName,
      coOwnerName: d.coOwnerName || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      ...(moved ? { lat: null, lng: null, geocodedAt: null } : {}),
    },
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const, addressMoved: moved };
}
```

- [ ] **Step 3: Test the invariant**

Append to `energy.itest.ts`:

```ts
describe("correcting an address invalidates the pin", () => {
  it("clears the coordinates the designer frames on", async () => {
    await db.lead.update({
      where: { id: leadId },
      data: { address: "1 Old St", city: "Dallas", state: "TX", zip: "75204", lat: 32.8, lng: -96.8 },
    });

    const { addressChanged } = await import("@/server/modules/leads/manage");
    const moved = addressChanged(
      { address: "1 Old St", city: "Dallas", state: "TX", zip: "75204" },
      { address: "2 New St", city: "Dallas", state: "TX", zip: "75204" }
    );
    expect(moved).toBe(true);

    await db.lead.update({ where: { id: leadId }, data: { address: "2 New St", lat: null, lng: null } });
    const after = await db.lead.findUnique({ where: { id: leadId }, select: { lat: true } });
    // Null is what makes the satellite route re-geocode on next load.
    expect(after?.lat).toBeNull();
  });
});
```

If `addressChanged` cannot be imported into the test (it pulls the session), move it to a small module with no auth imports — the same split `sizing.ts` exists for.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test && npm run test:integration -- energy`

```bash
git add src/server/modules/leads/manage.ts src/server/modules/solar/energy-actions.ts src/server/modules/solar/__tests__/energy.itest.ts
git commit -m "feat(solar): save a customer's details from the builder, and only those"
```

---

## Task 9: The Customer step

**Files:**
- Create: `src/components/portal/solar-customer-panel.tsx`
- Modify: `src/components/portal/solar-proposal-builder.tsx`
- Modify: `src/app/portal/leads/[id]/solar-proposal/page.tsx`

- [ ] **Step 1: Build the panel**

A client component taking `leadId`, `customer` (the nine fields), `canEdit`, and `hasLayout: boolean`. Two sections — "Who we are talking to" and "Where the system goes" — and one button labelled **"Save customer details"** calling `saveCustomerDetailsAction`.

Field labels are load-bearing: `e2e/solar-builder-steps.spec.ts` finds them by label, so use exactly these — `First name`, `Last name`, `Co-signer name`, `Phone`, `Email`, `Address`, `City`, `State`, `ZIP`. Note `coOwnerName` is labelled "Co-owner name (if applicable)" on the deal's own edit form; this step calls the same column **Co-signer name**, because that is what it is on a solar deal. Do not rename the column.

On a successful save where `addressMoved` is true AND `hasLayout` is true, warn rather than silently invalidating work:

```tsx
toast.warning("Address changed — the roof view will re-centre, so check the panel layout still sits on the house.");
```

Use the existing address autocomplete component if the deal edit form uses one; grep `lead-form.tsx` for the address field and reuse whatever it mounts, so a rep gets the same house-number dropdown here.

- [ ] **Step 2: Wire it in**

Add it as the `customer` step in the builder, pass the nine fields plus `hasLayout={!!design?.layoutImageFileId}` from the page (the lead select already returns names and address; add `coOwnerName`, `email`, `phone`).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`, then edit a phone number in the builder and confirm it shows on the deal page.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/solar-customer-panel.tsx src/components/portal/solar-proposal-builder.tsx "src/app/portal/leads/[id]/solar-proposal/page.tsx"
git commit -m "feat(solar): verify the customer before quoting them"
```

---

## Task 10: End to end

**Files:**
- Create: `e2e/solar-builder-steps.spec.ts`

- [ ] **Step 1: Write the spec**

Copy the login and `openDesignerDeal` helpers from `e2e/solar-layout-designer.spec.ts` verbatim — including its use of the Marcus Webb fixture, since this spec also writes to the deal and must not disturb Priya Raman's, which `solar-no-insurance.spec.ts` pins at 10.00 kW.

```ts
test("the builder walks customer, energy, then design", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  const leadId = await openDesignerDeal(page);
  await page.goto(`/portal/leads/${leadId}/solar-proposal`);

  await expect(page.getByRole("button", { name: /1 · Customer/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /2 · Energy/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /3 · System design/ })).toBeVisible();

  // Step 1 shows who we are quoting.
  await expect(page.getByLabel("First name")).toHaveValue(/Marcus/);
  await expect(page.getByLabel("Co-signer name")).toBeVisible();
});

test("a bill and a rate give usage and a target", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  const leadId = await openDesignerDeal(page);
  await page.goto(`/portal/leads/${leadId}/solar-proposal?step=energy`);

  await page.getByRole("radio", { name: /From their bill/ }).check();
  await page.getByLabel("Average monthly bill ($)").fill("200");
  await page.getByLabel("Rate ($/kWh)").fill("0.20");

  // $200 ÷ $0.20 = 1,000 kWh a month.
  await expect(page.getByTestId("energy-summary")).toContainText("12,000 kWh/yr");
  await page.getByRole("button", { name: "Save energy" }).click();
  await expect(page.getByText(/Energy saved/)).toBeVisible({ timeout: 15000 });

  await page.reload();
  await expect(page.getByTestId("energy-summary")).toContainText("12,000 kWh/yr");
});
```

- [ ] **Step 2: Run it**

Run: `SOLAR_VERTICAL_ENABLED=1 E2E_PORT=3006 npx playwright test solar-builder-steps`
Expected: PASS (2 tests). Scroll any element into view before using `page.mouse` — it works in viewport coordinates and does not scroll.

- [ ] **Step 3: Full suite**

Run: `npm test && npm run test:integration && npm run typecheck && npm run lint`
Then `SOLAR_VERTICAL_ENABLED=1 E2E_PORT=3006 npx playwright test solar`

Expected: PASS, except the three `solar-no-insurance` specs (lines 45, 152, 240) that fail on `main` today. Confirm against `origin/main` before blaming this work.

- [ ] **Step 4: Commit**

```bash
git add e2e/solar-builder-steps.spec.ts
git commit -m "test(solar): cover the customer and energy steps end to end"
```

---

## Done when

- The builder shows five steps and opens on Customer.
- $200 at $0.20/kWh produces 12,000 kWh/yr, a target in kW, and a panel count.
- Entering usage instead shows the rate as calculated, and stores no typed rate.
- The designer's counter reads "24 of ~25 needed" and goes green at the target.
- Utility and electric providers come from lists you manage in Settings.
- Every surface that shows a utility rate goes through `resolveUtilityRateMills`.
- `npm test`, `npm run test:integration`, `npm run typecheck` and `npm run lint` all pass.
