# Solar Design Step & Panel Layout Designer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce step 1 of the solar proposal builder to the three inputs that drive every number (usage, bill, panels on the roof), and replace the typed module count with an array drawn at true scale on the deal's satellite imagery.

**Architecture:** Phase 1 strips the form and rehomes each evicted field to where it is actually used — interconnection fields and build equipment to the deal's Operations card, the net-metering programme to company Solar Settings. Panel wattage stops being a rep decision and comes from the catalogue's default module, resolved server-side. Phase 2 adds a canvas designer over the existing server-proxied Google Static Maps image; panel geometry lives in a pure, unit-tested library in ground metres relative to the deal's rooftop coordinate, and a server action counts the geometry it is given rather than trusting a client-sent number.

**Tech Stack:** Next.js App Router (server actions), Prisma/Postgres, React 19 + Tailwind, HTML Canvas 2D (no new dependency), Vitest (unit + integration), Playwright (e2e), `sharp` + existing object storage for the rendered layout image.

**Spec:** `docs/superpowers/specs/2026-08-18-solar-design-step-and-layout-designer-design.md`

---

## Before you start

This branch is shared. `feat/solar-equipment-retire-and-avl-year` has had two solar commits land in the last hour (`b8f6993` equipment retire/AVL year, `7e67cc8` readiness links) and a lender approved-vendor-list migration (`20260819020000_solar_lender_approved_vendor_lists`) appeared while this plan was being written. Confirm `git status` is clean and `git log -1` is what you expect before Task 1, and use migration timestamp `20260819030000` or later so ordering stays correct.

**The lender AVL interaction.** `solar-proposal/page.tsx` now filters the equipment dropdowns to the chosen lender's approved list. Phase 1 removes those dropdowns from step 1, so that filtering moves with them to the Operations card (Task 6). No lender work is deleted; it changes surface.

One gap this opens is deliberately NOT closed here, because it was not in the approved spec: the module is now auto-selected, so nothing checks that the catalogue's default panel is on the chosen lender's approved list. Today a rep could quote a lender a panel it will not finance. Raise it before starting — it is a small addition to `validateDesign` (a warning keyed on `design.lenderId`), but it is scope the spec has not agreed.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `prisma/migrations/20260819030000_solar_design_step_trim/migration.sql` | Three columns + the net-metering backfill |
| `src/lib/solar-layout.ts` | Pure geometry: Mercator scale, block fill, rotation, panel count. No React, no Prisma. |
| `src/lib/__tests__/solar-layout.test.ts` | Unit tests for the above |
| `src/components/portal/solar-layout-designer.tsx` | The canvas designer (client component) |
| `src/server/modules/solar/layout-actions.ts` | `saveSolarLayoutAction` |
| `src/server/modules/solar/__tests__/design-sizing.itest.ts` | Default-module sizing, layout-driven quantity |
| `e2e/solar-layout-designer.spec.ts` | Draw → count → save → generate |

**Modified**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `SolarSettings.netMeteringProgram`, `SolarEquipment.widthMm/heightMm`, `SolarDesign.layoutBlocks` |
| `src/server/modules/solar/settings.ts` | Carry `netMeteringProgram` through `SolarSettingsView` |
| `src/server/modules/solar/actions.ts` | Settings schema; design action drops eight inputs and resolves the default module |
| `src/server/modules/solar/proposal-actions.ts` | Snapshot: net metering from settings, no rate plan, no TSRF |
| `src/lib/solar-validation.ts` | TSRF and rate-plan rules out; module messages reworded; layout becomes blocking (Phase 2) |
| `src/components/portal/solar-panels.tsx` | Design panel trimmed; layout section swapped for the designer |
| `src/components/portal/solar-proposal-builder.tsx` | Equipment props dropped |
| `src/app/portal/leads/[id]/solar-proposal/page.tsx` | Stops querying equipment for step 1; passes lead coordinates |
| `src/components/portal/solar-ops-card.tsx` | New "Interconnection & equipment" block |
| `src/app/portal/leads/[id]/page.tsx` | Feeds the ops card its new props |
| `src/components/portal/solar-settings-form.tsx` | Net-metering programme field |
| `src/components/proposal/solar-proposal-view.tsx` | Rate-plan and TSRF rows out; equipment table is panels-only |

`solar-layout.ts` is deliberately free of React and Prisma: the canvas, the server action and the tests all need the same geometry, and a pure module is the only version of it that all three can hold.

---

# PHASE 1 — strip the form, rehome the fields

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260819030000_solar_design_step_trim/migration.sql`

- [ ] **Step 1: Add the three fields to the schema**

In `model SolarSettings`, after `incentiveDisclaimer`:

```prisma
  /// Net-metering / buyback programme, e.g. "Oncor 1:1 net metering". Set by
  /// the utility and the same for every house on it, so it belongs to the
  /// company rather than being retyped on each design. Printed on every
  /// proposal; the FAQ answer about surplus production points at it.
  netMeteringProgram String?
```

In `model SolarEquipment`, after `ratingW`:

```prisma
  /// Modules only: physical size in mm, so a panel can be drawn on a roof at
  /// true scale. Null falls back to a standard 60-cell residential module —
  /// see MODULE_FALLBACK_MM in src/lib/solar-layout.ts.
  widthMm  Int?
  heightMm Int?
```

In `model SolarDesign`, directly above the panel-layout block:

```prisma
  /// The array as drawn in the designer: LayoutBlock[], positions in ground
  /// metres east/north of the lead's coordinate. NOT pixels — a pixel layout
  /// reopened at a different zoom is a layout in the wrong place.
  layoutBlocks Json @default("[]")
```

- [ ] **Step 2: Write the migration**

```sql
-- prisma/migrations/20260819030000_solar_design_step_trim/migration.sql
ALTER TABLE "solar_settings" ADD COLUMN "netMeteringProgram" TEXT;
ALTER TABLE "solar_equipment" ADD COLUMN "widthMm" INTEGER;
ALTER TABLE "solar_equipment" ADD COLUMN "heightMm" INTEGER;
ALTER TABLE "solar_designs" ADD COLUMN "layoutBlocks" JSONB NOT NULL DEFAULT '[]';

-- The programme moves from the design to the company. Carry each company's
-- most-used value across so nobody loses what they had typed.
UPDATE "solar_settings" s
SET "netMeteringProgram" = m.value
FROM (
  SELECT DISTINCT ON ("companyId") "companyId", "netMeteringProgram" AS value
  FROM "solar_designs"
  WHERE "netMeteringProgram" IS NOT NULL AND btrim("netMeteringProgram") <> ''
  GROUP BY "companyId", "netMeteringProgram"
  ORDER BY "companyId", count(*) DESC
) m
WHERE s."companyId" = m."companyId" AND s."netMeteringProgram" IS NULL;
```

No column is dropped. `ratePlan`, `tsrfPct`, `utilityAccountNo`, `meterNo` and the design's own `netMeteringProgram` stay as history for proposals already sent.

- [ ] **Step 3: Apply it locally**

Run: `npm run db:migrate`
Expected: `20260819030000_solar_design_step_trim` applied, Prisma Client regenerated.

- [ ] **Step 4: Verify the columns landed**

Run:
```bash
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('solar_settings','solar_equipment','solar_designs')
  AND column_name IN ('netMeteringProgram','widthMm','heightMm','layoutBlocks');
SQL
```
Expected: five rows (`netMeteringProgram` appears for both `solar_settings` and `solar_designs`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260819030000_solar_design_step_trim
git commit -m "feat(solar): company net-metering, module dimensions, layout blocks"
```

---

## Task 2: Net-metering programme becomes a company setting

**Files:**
- Modify: `src/server/modules/solar/settings.ts`
- Modify: `src/server/modules/solar/actions.ts:20-54`
- Modify: `src/components/portal/solar-settings-form.tsx`

- [ ] **Step 1: Widen `SolarSettingsView`**

In `settings.ts`:

```ts
export type SolarSettingsView = SolarAssumptions & {
  stateIncentiveNote: string | null;
  incentiveDisclaimer: string;
  netMeteringProgram: string | null;
};
```

Add `netMeteringProgram: null` to the no-row fallback object, and `netMeteringProgram: row.netMeteringProgram` to the mapped return.

- [ ] **Step 2: Accept it in the settings action**

In `actions.ts`, add to `settingsSchema` beside `stateIncentiveNote`:

```ts
  netMeteringProgram: z.string().max(120).nullable(),
```

No other change is needed — `updateSolarSettingsAction` spreads `d` into the upsert.

- [ ] **Step 3: Add the field to the settings form**

In `solar-settings-form.tsx`, in the incentives/notes section beside the state-incentive note, following the file's existing field components:

```tsx
<TextField
  label="Net-metering programme"
  value={f.netMeteringProgram}
  onChange={(v) => set("netMeteringProgram", v)}
  hint="Printed on every proposal, e.g. “Oncor 1:1 net metering”"
/>
```

Seed it in the form's initial state from the settings prop, and send `netMeteringProgram: f.netMeteringProgram.trim() || null` on save. If the file has no `TextField`, use the same `Input` + `Label` pairing its other text inputs use — do not introduce a new field component.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/solar/settings.ts src/server/modules/solar/actions.ts src/components/portal/solar-settings-form.tsx
git commit -m "feat(solar): net-metering programme is a company setting"
```

---

## Task 3: Size the system from the catalogue's default panel

**Files:**
- Modify: `src/server/modules/solar/actions.ts:61-181`
- Create: `src/server/modules/solar/__tests__/design-sizing.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/solar/__tests__/design-sizing.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * Where the watts come from once a rep no longer picks equipment.
 *
 * A rep sells a system; the approved-vendor list decides which panel it is
 * built from. These tests pin the two halves of that: a design with no module
 * takes the catalogue default, and a design that already HAS one keeps it, so
 * next year's AVL cannot silently re-price a quote sent last year.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "Sizing Co", slug: `sz-${process.pid}-${Date.now()}` } });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({ data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 } });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id, firstName: "Siz", lastName: "Test" },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarEquipment.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const panel = (over: Record<string, unknown> = {}) =>
  db.solarEquipment.create({
    data: { companyId, kind: "module", model: `P-${Math.random().toString(36).slice(2, 8)}`, ratingW: 400, ...over },
  });

describe("the default panel sizes the system", () => {
  it("fills an empty design with the active default module", async () => {
    const def = await panel({ ratingW: 450, isDefault: true });
    await db.solarDesign.create({ data: { companyId, leadId, moduleQty: 20 } });

    const { resolveSizingModule } = await import("@/server/modules/solar/actions");
    const chosen = await resolveSizingModule(companyId, null);

    expect(chosen?.id).toBe(def.id);
    expect(chosen?.ratingW).toBe(450);
  });

  it("keeps a module the design already chose, even after the default changes", async () => {
    const lastYear = await panel({ ratingW: 400 });
    await panel({ ratingW: 450, isDefault: true });

    const { resolveSizingModule } = await import("@/server/modules/solar/actions");
    const chosen = await resolveSizingModule(companyId, lastYear.id);

    expect(chosen?.id).toBe(lastYear.id);
    expect(chosen?.ratingW).toBe(400);
  });

  it("ignores a retired default rather than sizing from a product nobody sells", async () => {
    await panel({ ratingW: 450, isDefault: true, isActive: false });

    const { resolveSizingModule } = await import("@/server/modules/solar/actions");
    expect(await resolveSizingModule(companyId, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- design-sizing`
Expected: FAIL — `resolveSizingModule` is not exported from `actions.ts`.

- [ ] **Step 3: Implement `resolveSizingModule`**

In `src/server/modules/solar/actions.ts`, above `saveSolarDesignAction`:

```ts
/**
 * Which panel this design is sized from.
 *
 * A rep does not choose hardware on a sales call — the approved-vendor list
 * does, once a year — so an empty design takes the catalogue's active default.
 * A design that ALREADY has a module keeps it: re-pointing an existing quote at
 * this year's panel would silently change a price somebody has already been
 * shown. Returns null when there is no default to use, which validation turns
 * into a blocking issue pointing at the catalogue.
 */
export async function resolveSizingModule(
  companyId: string,
  existingModuleId: string | null
): Promise<{ id: string; ratingW: number | null } | null> {
  if (existingModuleId) {
    const kept = await prisma.solarEquipment.findFirst({
      where: { companyId, id: existingModuleId, kind: "module" },
      select: { id: true, ratingW: true },
    });
    if (kept) return kept;
  }
  return prisma.solarEquipment.findFirst({
    where: { companyId, kind: "module", isActive: true, isDefault: true },
    select: { id: true, ratingW: true },
  });
}
```

- [ ] **Step 4: Run the test again**

Run: `npm run test:integration -- design-sizing`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it in `saveSolarDesignAction`, and drop the evicted inputs**

Remove these keys from `designSchema`: `ratePlan`, `utilityAccountNo`, `meterNo`, `netMeteringProgram`, `tsrfPct`, `moduleId`, `inverterId`, `batteryId`, `batteryQty`. Keep `moduleQty` for now — Phase 2 (Task 12) takes it away.

Replace the `resolveEquipment` calls and the sizing lines in the body with:

```ts
  const existing = await prisma.solarDesign.findUnique({
    where: { leadId: d.leadId },
    select: { moduleId: true, moduleQty: true },
  });

  const module_ = await resolveSizingModule(user.companyId, existing?.moduleId ?? null);

  const moduleQty = d.moduleQty ?? existing?.moduleQty ?? 0;
  const systemSizeKwDc = module_?.ratingW ? (moduleQty * module_.ratingW) / 1000 : 0;
  // TSRF is gone: it was a figure typed from memory that multiplied straight
  // into the customer's quoted kWh. System losses are the company-wide derate
  // in Solar Settings, which one person sets from real production data.
  const year1ProductionKwh = year1Production(systemSizeKwDc, assumptions);
```

and add `moduleId: module_?.id ?? null` to the `data` object written by the upsert.

`resolveEquipment` stays exported — Task 6's ops-card action is its new caller, and it is the only thing stopping a retired product being attached to a deal.

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: PASS. If `solar-savings.test.ts` or `solar-money.test.ts` fail on a TSRF argument, they are asserting the old signature — update the call, not the expectation, and only where TSRF was the input under test.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/solar/actions.ts src/server/modules/solar/__tests__/design-sizing.itest.ts
git commit -m "feat(solar): size the system from the catalogue's default panel"
```

---

## Task 4: Validation stops asking for what the form no longer collects

**Files:**
- Modify: `src/lib/solar-validation.ts:93-107, 178-260, 330-340`
- Modify: `src/server/modules/solar/readiness.ts`
- Test: `src/lib/__tests__/solar-validation.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/solar-validation.test.ts
import { describe, it, expect } from "vitest";
import { validateDesign, type DesignForValidation } from "@/lib/solar-validation";
import { SOLAR_ASSUMPTION_DEFAULTS } from "@/server/modules/solar/settings";

const design = (over: Partial<DesignForValidation> = {}): DesignForValidation => ({
  systemSizeKwDc: 9.6,
  year1ProductionKwh: 13_900,
  annualUsageKwh: 14_000,
  offsetPct: 99,
  moduleQty: 24,
  moduleRatingW: 400,
  avgMonthlyBillCents: 18_000,
  utilityProvider: "Oncor",
  ...over,
});

describe("a design is judged only on what the form still collects", () => {
  it("raises nothing about TSRF, because nobody enters it any more", () => {
    const codes = validateDesign(design(), SOLAR_ASSUMPTION_DEFAULTS).map((i) => i.code);
    expect(codes.filter((c) => c.includes("tsrf"))).toEqual([]);
  });

  it("raises nothing about a rate plan", () => {
    const codes = validateDesign(design(), SOLAR_ASSUMPTION_DEFAULTS).map((i) => i.code);
    expect(codes).not.toContain("utility.rate_plan_missing");
  });

  it("blames the catalogue, not the rep, when there is no panel to size from", () => {
    const issues = validateDesign(design({ moduleRatingW: null, systemSizeKwDc: 0 }), SOLAR_ASSUMPTION_DEFAULTS, "lead-1");
    const noModule = issues.find((i) => i.code === "equipment.no_module");
    expect(noModule?.message).toContain("default");
    expect(noModule?.action?.href).toContain("/portal/settings/solar-equipment");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- solar-validation`
Expected: FAIL — TSRF codes present, module message still says "Pick a module".

- [ ] **Step 3: Make the changes**

In `DesignForValidation`, delete `tsrfPct` and `ratePlan`.

Delete the whole `── TSRF ──` block and the `TSRF_MIN_PCT` / `TSRF_WARN_PCT` / `TSRF_MAX_PCT` constants. Delete the `utility.rate_plan_missing` warning.

Reword the two module issues, and point the first at the catalogue:

```ts
  if (d.systemSizeKwDc <= 0) {
    block("design.size_zero", "design", "systemSizeKwDc", "System size must be greater than zero.");
  }
  if (d.moduleRatingW == null) {
    issues.push({
      severity: "block",
      code: "equipment.no_module",
      group: "equipment",
      field: "moduleId",
      message: "No default solar panel is set in the catalogue, so a system cannot be sized.",
      action: { label: "Open the equipment catalogue", href: "/portal/settings/solar-equipment" },
    });
  } else if (d.moduleRatingW <= 0) {
    block("equipment.module_rating_zero", "equipment", "moduleId", "The default panel has no wattage on it. Fix the catalogue entry before quoting it.");
  }
```

- [ ] **Step 4: Run the test**

Run: `npm test -- solar-validation`
Expected: PASS (3 tests).

- [ ] **Step 5: Fix the callers**

Run: `npm run typecheck`
Expected: errors in `readiness.ts` and `proposal-actions.ts` where `tsrfPct` / `ratePlan` are passed into `validateDesign`. Delete those two properties at each call site. Do not delete the columns.

Run again. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar-validation.ts src/lib/__tests__/solar-validation.test.ts src/server/modules/solar/readiness.ts src/server/modules/solar/proposal-actions.ts
git commit -m "feat(solar): stop validating fields the design step no longer collects"
```

---

## Task 5: Trim the design panel

**Files:**
- Modify: `src/components/portal/solar-panels.tsx:196-536`
- Modify: `src/components/portal/solar-proposal-builder.tsx:36-110`
- Modify: `src/app/portal/leads/[id]/solar-proposal/page.tsx`

- [ ] **Step 1: Trim `SolarDesignPanel`**

Delete from the `form` state and from the JSX: `ratePlan`, `utilityAccountNo`, `meterNo`, `netMeteringProgram`, `tsrfPct`, `moduleId`, `inverterId`, `batteryId`. Delete the whole `SYSTEM` equipment grid (the three-selector `map` and its empty-catalogue hints) and the `Site` section's TSRF field; the mount-type select stays and is now alone in that grid.

`moduleQty` keeps its input in Phase 1, but moves out of the deleted System section and sits directly above the derived strip, with the hint that Phase 2 will make true:

```tsx
<TextField
  label="Module quantity"
  value={form.moduleQty}
  disabled={!canEdit}
  onChange={(v) => set("moduleQty", v)}
  type="number"
/>
```

Delete `modules`, `inverters`, `batteries` from the component's props and from `SolarDesignView`: `ratePlan`, `utilityAccountNo`, `meterNo`, `netMeteringProgram`, `tsrfPct`, `moduleId`, `inverterId`, `batteryId`.

Update the `save()` payload so it sends only `utilityProvider`, `annualUsageKwh`, `avgMonthlyBillCents`, `mountType`, `moduleQty`.

- [ ] **Step 2: Drop the props above it**

In `solar-proposal-builder.tsx`, delete the `modules`, `inverters`, `batteries` props and the `EquipmentOption` type if nothing else in the file uses it.

In `solar-proposal/page.tsx`, delete `modules=`, `inverters=`, `batteries=` from the `<SolarProposalBuilder>` call. Leave the `equipment` query and `equipOptions` in place only if the lender props still consume them; if the equipment query now feeds nothing, delete it along with `chosen`, `approvedFor`, `hiddenByLender` and `equipOptions`, and remove those props from the builder too. Let `npm run typecheck` decide which — do not guess.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Look at it**

Run: `npm run dev`, open a solar deal → Build Proposal.
Expected: Utility & usage shows three fields; Site shows mount type; module quantity sits above the derived strip; no equipment dropdowns, no TSRF.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/solar-panels.tsx src/components/portal/solar-proposal-builder.tsx "src/app/portal/leads/[id]/solar-proposal/page.tsx"
git commit -m "feat(solar): strip the design step to usage, bill and mount"
```

---

## Task 6: Interconnection and build equipment move to the Operations card

**Files:**
- Modify: `src/server/modules/solar/actions.ts`
- Modify: `src/components/portal/solar-ops-card.tsx`
- Modify: `src/app/portal/leads/[id]/page.tsx:686`

- [ ] **Step 1: Write the failing integration test**

Append to `src/server/modules/solar/__tests__/design-sizing.itest.ts`:

```ts
describe("build details never move a quoted number", () => {
  it("records the inverter without touching system size", async () => {
    const p = await panel({ ratingW: 400, isDefault: true });
    const inv = await db.solarEquipment.create({
      data: { companyId, kind: "inverter", model: "INV-1", ratingW: 7600 },
    });
    await db.solarDesign.create({
      data: { companyId, leadId, moduleId: p.id, moduleQty: 20, systemSizeKwDc: 8 },
    });

    await db.solarDesign.update({
      where: { leadId },
      data: { inverterId: inv.id, utilityAccountNo: "ACCT-9", meterNo: "MTR-3" },
    });

    const after = await db.solarDesign.findUnique({ where: { leadId } });
    expect(after?.inverterId).toBe(inv.id);
    expect(after?.systemSizeKwDc).toBe(8);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- design-sizing`
Expected: PASS — this test pins the invariant the action must preserve; it passes against the database directly before the action exists.

- [ ] **Step 3: Add the action**

In `actions.ts`:

```ts
const buildDetailsSchema = z.object({
  leadId: z.string().min(1),
  utilityAccountNo: z.string().max(60).nullable(),
  meterNo: z.string().max(60).nullable(),
  inverterId: z.string().nullable(),
  batteryId: z.string().nullable(),
});

/**
 * What the job is actually built from, recorded when it is being built.
 *
 * Deliberately separate from the design action: nothing here may change
 * `systemSizeKwDc`, production or offset. Only the module sizes the system, and
 * only the design step sets that — so an ops edit weeks after the sale cannot
 * move a number the customer has already signed against.
 */
export async function saveSolarBuildDetailsAction(input: z.infer<typeof buildDetailsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = buildDetailsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid build details.");
  const d = parsed.data;

  const design = await prisma.solarDesign.findFirst({
    where: { leadId: d.leadId, companyId: user.companyId },
    select: { inverterId: true, batteryId: true },
  });
  if (!design) return fail("Save the system design first.");

  const [inv, bat] = await Promise.all([
    resolveEquipment(d.inverterId, "inverter", design.inverterId, user.companyId),
    resolveEquipment(d.batteryId, "battery", design.batteryId, user.companyId),
  ]);
  for (const r of [inv, bat]) if (!r.ok) return fail(r.error);

  await prisma.solarDesign.update({
    where: { leadId: d.leadId },
    data: {
      utilityAccountNo: d.utilityAccountNo,
      meterNo: d.meterNo,
      inverterId: inv.ok ? (inv.row?.id ?? null) : null,
      batteryId: bat.ok ? (bat.row?.id ?? null) : null,
    },
  });

  revalidatePath(`/portal/leads/${d.leadId}`);
  return ok();
}
```

`resolveEquipment` currently closes over `user` inside `saveSolarDesignAction`. Lift it to module scope with an explicit `companyId` parameter (signature as called above) and update its existing call sites.

- [ ] **Step 4: Add the ops-card block**

In `solar-ops-card.tsx`, a third section below the crossover half, gated on `props.canEdit`, holding: utility account #, meter #, an inverter `<select>` and a battery `<select>`, plus a Save button calling `saveSolarBuildDetailsAction`. Follow the card's existing `run(fn, okMsg)` helper for busy state and toasts. New props:

```ts
  utilityAccountNo: string | null;
  meterNo: string | null;
  inverterId: string | null;
  batteryId: string | null;
  inverters: { id: string; label: string }[];
  batteries: { id: string; label: string }[];
```

Header copy: "Interconnection & equipment", with the subtitle "Recorded when the job is built — none of this changes the customer's quote."

- [ ] **Step 5: Feed it from the deal page**

In `src/app/portal/leads/[id]/page.tsx`, the solar branch already loads the design for the ops card region. Query the company's active inverters and batteries (plus whatever this design already has, using the same `OR: [{ isActive: true }, { id: { in: [...] } }]` shape `solar-proposal/page.tsx` uses — a retired item must stay renderable), map them to `{ id, label }`, and pass all seven props.

- [ ] **Step 6: Typecheck, lint, look at it**

Run: `npm run typecheck && npm run lint`
Expected: no errors. Then open a solar deal and save an inverter; confirm the deal's system size is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/solar/actions.ts src/components/portal/solar-ops-card.tsx "src/app/portal/leads/[id]/page.tsx" src/server/modules/solar/__tests__/design-sizing.itest.ts
git commit -m "feat(solar): interconnection and build equipment live on the deal, not the quote"
```

---

## Task 7: The customer proposal stops printing what nobody set

**Files:**
- Modify: `src/server/modules/solar/proposal-actions.ts:158-176`
- Modify: `src/components/proposal/solar-proposal-view.tsx:200-290, 505`

- [ ] **Step 1: Change the snapshot**

In the `design:` block: delete `ratePlan` and `tsrfPct`, and read the programme from settings:

```ts
      // Company-level now: the programme is set by the utility, not by the
      // house, so it is one value per company rather than one per deal.
      netMeteringProgram: assumptions.netMeteringProgram,
```

Delete `ratePlan` and `tsrfPct` from the snapshot's TypeScript type wherever it is declared (`src/lib/solar-proposal.ts` or the type file it imports).

- [ ] **Step 2: Change the view**

In `solar-proposal-view.tsx`:
- Delete the `Rate plan` row (line ~201) and the `Solar resource (TSRF)` row (~231).
- Delete the TSRF clause in the assumptions paragraph (~505).
- In the equipment table (~267-290), render the panel row only; drop the inverter and battery rows.

Every field read there must stay optional-tolerant: an already-sent proposal renders from its frozen snapshot and still carries `ratePlan` and `tsrfPct`. Removing a row is safe; changing how a field is read is not.

- [ ] **Step 3: Run the proposal tests**

Run: `npm test -- solar-proposal`
Expected: PASS. Update any fixture that asserts a TSRF or rate-plan row.

- [ ] **Step 4: Look at a proposal**

Generate one on a seeded solar deal and confirm: no rate plan, no TSRF, panels only in the equipment table, and the billing programme still appears from Settings.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/solar/proposal-actions.ts src/components/proposal/solar-proposal-view.tsx src/lib/solar-proposal.ts
git commit -m "feat(solar): the proposal stops quoting hardware and figures nobody set"
```

---

**Phase 1 is shippable here.** Before deploying, do the settings check the spec calls for: compare one installed system's real annual output against its proposal, and lower `kwhPerKwYear` if it was tuned with TSRF in the mix. Production migrations are manual — session pooler on :5432, strip the query string, add `?sslmode=require`, and verify the columns landed rather than trusting the CLI's "success".

---

# PHASE 2 — the panel layout designer

## Task 8: The geometry library

**Files:**
- Create: `src/lib/solar-layout.ts`
- Create: `src/lib/__tests__/solar-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/solar-layout.test.ts
import { describe, it, expect } from "vitest";
import {
  metresPerPixel, panelSizeM, fitBlock, panelCount, panelCorners,
  metresToImagePx, MODULE_FALLBACK_MM, type LayoutBlock,
} from "@/lib/solar-layout";

const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "b1", originE: 0, originN: 0, rotationDeg: 0,
  cols: 4, rows: 3, orientation: "portrait", omitted: [], ...over,
});

describe("ground scale", () => {
  it("is Google's documented resolution at the equator", () => {
    expect(metresPerPixel(0, 0, 1)).toBeCloseTo(156543.034, 2);
  });

  it("halves with each zoom level and again at scale 2", () => {
    expect(metresPerPixel(32, 21, 1) / metresPerPixel(32, 20, 1)).toBeCloseTo(0.5, 6);
    expect(metresPerPixel(32, 20, 2)).toBeCloseTo(metresPerPixel(32, 20, 1) / 2, 9);
  });

  it("shrinks with latitude, because Mercator stretches", () => {
    expect(metresPerPixel(60, 20, 1)).toBeLessThan(metresPerPixel(0, 20, 1));
  });
});

describe("filling a dragged rectangle", () => {
  it("fits whole panels only, never a partial one", () => {
    // 4.0m x 6.0m at 1.134m x 1.762m portrait, 20mm gap:
    // cols = floor((4.0 + .02) / 1.154) = 3 ; rows = floor((6.0 + .02) / 1.782) = 3
    const fit = fitBlock({ widthM: 4.0, heightM: 6.0 }, MODULE_FALLBACK_MM, "portrait");
    expect(fit).toEqual({ cols: 3, rows: 3 });
  });

  it("returns nothing for a rectangle smaller than one panel", () => {
    expect(fitBlock({ widthM: 0.5, heightM: 0.5 }, MODULE_FALLBACK_MM, "portrait")).toEqual({ cols: 0, rows: 0 });
  });

  it("swaps the sides in landscape", () => {
    const p = panelSizeM(MODULE_FALLBACK_MM, "portrait");
    const l = panelSizeM(MODULE_FALLBACK_MM, "landscape");
    expect(l.w).toBeCloseTo(p.h, 9);
    expect(l.h).toBeCloseTo(p.w, 9);
  });
});

describe("counting what is actually on the roof", () => {
  it("is rows times columns", () => {
    expect(panelCount([block()])).toBe(12);
  });

  it("excludes knocked-out cells", () => {
    expect(panelCount([block({ omitted: [0, 5] })])).toBe(10);
  });

  it("ignores out-of-range and duplicate omissions rather than going negative", () => {
    expect(panelCount([block({ omitted: [0, 0, 99, -1] })])).toBe(11);
  });

  it("sums across blocks", () => {
    expect(panelCount([block(), block({ id: "b2", cols: 2, rows: 2 })])).toBe(16);
  });
});

describe("rotation is rigid", () => {
  it("moves panels without changing how many there are or how big they are", () => {
    const flat = panelCorners(block(), MODULE_FALLBACK_MM);
    const tilted = panelCorners(block({ rotationDeg: 37 }), MODULE_FALLBACK_MM);
    expect(tilted.length).toBe(flat.length);

    const side = (q: { e: number; n: number }[]) => Math.hypot(q[1].e - q[0].e, q[1].n - q[0].n);
    expect(side(tilted[0])).toBeCloseTo(side(flat[0]), 9);
  });

  it("turns east into south at 90 degrees clockwise", () => {
    const [first] = panelCorners(block({ cols: 1, rows: 1, rotationDeg: 90 }), MODULE_FALLBACK_MM);
    // The corner one panel-width east of the origin is now one width south.
    expect(first[1].e).toBeCloseTo(0, 6);
    expect(first[1].n).toBeCloseTo(-panelSizeM(MODULE_FALLBACK_MM, "portrait").w, 6);
  });
});

describe("metres survive a change of zoom", () => {
  it("moves a ground point twice as far from centre when the zoom doubles", () => {
    const size = 1280;
    const a = metresToImagePx(10, -4, metresPerPixel(32.7, 20, 2), size);
    const b = metresToImagePx(10, -4, metresPerPixel(32.7, 21, 2), size);
    expect(b.x - size / 2).toBeCloseTo((a.x - size / 2) * 2, 6);
    expect(b.y - size / 2).toBeCloseTo((a.y - size / 2) * 2, 6);
  });

  it("puts north above centre and east to the right", () => {
    const px = metresToImagePx(10, 10, metresPerPixel(32.7, 20, 2), 1280);
    expect(px.x).toBeGreaterThan(640);
    expect(px.y).toBeLessThan(640);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- solar-layout`
Expected: FAIL — cannot resolve `@/lib/solar-layout`.

- [ ] **Step 3: Write the library**

```ts
// src/lib/solar-layout.ts
/**
 * The geometry behind the panel-layout designer.
 *
 * Pure on purpose: the canvas, the server action that counts panels and the
 * tests all need the same maths, and a module with no React and no Prisma in it
 * is the only version all three can hold.
 *
 * POSITIONS ARE GROUND METRES, east and north of the deal's coordinate — never
 * pixels. A pixel layout reopened at a different zoom is a layout in the wrong
 * place, which is the same class of bug as house dots landing on tile corners.
 */

export type Orientation = "portrait" | "landscape";

export type LayoutBlock = {
  id: string;
  /** Block's first panel's top-left corner, metres east/north of the lead. */
  originE: number;
  originN: number;
  /** Clockwise from north, degrees — a roof ridge's bearing. */
  rotationDeg: number;
  cols: number;
  rows: number;
  orientation: Orientation;
  /** Grid indices knocked out: chimneys, vents, setbacks. Row-major. */
  omitted: number[];
};

export type ModuleMm = { widthMm: number; heightMm: number };

/** A standard 60-cell residential module, for a catalogue entry with no size. */
export const MODULE_FALLBACK_MM: ModuleMm = { widthMm: 1134, heightMm: 1762 };

/** Rail gap between neighbouring modules. */
export const PANEL_GAP_M = 0.02;

/**
 * Web Mercator ground resolution — the whole tool's accuracy rests here.
 *
 * `scale: 2` is a HiDPI image: twice the pixels for the same ground, so each
 * pixel covers half the distance.
 */
export function metresPerPixel(lat: number, zoom: number, scale: 1 | 2 = 1): number {
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom * scale);
}

export function panelSizeM(m: ModuleMm, o: Orientation): { w: number; h: number } {
  const w = m.widthMm / 1000;
  const h = m.heightMm / 1000;
  return o === "portrait" ? { w, h } : { w: h, h: w };
}

/** How many whole panels fit a dragged rectangle. Never a partial one. */
export function fitBlock(
  rect: { widthM: number; heightM: number },
  m: ModuleMm,
  o: Orientation
): { cols: number; rows: number } {
  const { w, h } = panelSizeM(m, o);
  const fit = (span: number, size: number) =>
    Math.max(0, Math.floor((span + PANEL_GAP_M) / (size + PANEL_GAP_M)));
  return { cols: fit(rect.widthM, w), rows: fit(rect.heightM, h) };
}

/** Cells knocked out of one block, de-duplicated and clamped to the grid. */
function omittedInRange(b: LayoutBlock): Set<number> {
  const cells = b.cols * b.rows;
  return new Set(b.omitted.filter((i) => Number.isInteger(i) && i >= 0 && i < cells));
}

/** The number the quote is built on. Counted from geometry, never sent by a client. */
export function panelCount(blocks: LayoutBlock[]): number {
  return blocks.reduce((n, b) => {
    const cells = Math.max(0, b.cols) * Math.max(0, b.rows);
    return n + cells - omittedInRange(b).size;
  }, 0);
}

/** Rotate a block-local offset into ground metres. Clockwise from north. */
function rotate(dE: number, dN: number, deg: number): { e: number; n: number } {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { e: dE * cos + dN * sin, n: -dE * sin + dN * cos };
}

/**
 * Every present panel as four ground-metre corners, clockwise from top-left.
 * Used to draw the array and to hit-test a click on it.
 */
export function panelCorners(b: LayoutBlock, m: ModuleMm): { e: number; n: number }[][] {
  const { w, h } = panelSizeM(m, b.orientation);
  const skip = omittedInRange(b);
  const out: { e: number; n: number }[][] = [];

  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      if (skip.has(row * b.cols + col)) continue;
      const x = col * (w + PANEL_GAP_M);
      const y = row * (h + PANEL_GAP_M);
      out.push(
        // Local frame: +x east, +y SOUTH (screen-natural), so a panel's top
        // edge is at -y in ground north.
        [
          [x, -y],
          [x + w, -y],
          [x + w, -y - h],
          [x, -y - h],
        ].map(([dx, dy]) => {
          const r = rotate(dx, dy, b.rotationDeg);
          return { e: b.originE + r.e, n: b.originN + r.n };
        })
      );
    }
  }
  return out;
}

/** Ground metres → pixel on a square static map centred on the deal. */
export function metresToImagePx(
  e: number,
  n: number,
  mpp: number,
  imageSizePx: number
): { x: number; y: number } {
  // Mercator's cos(lat) stretch is already in `mpp`, and a residential roof
  // spans tens of metres, so treating north as a straight vertical here is
  // accurate to well under a pixel.
  return { x: imageSizePx / 2 + e / mpp, y: imageSizePx / 2 - n / mpp };
}

/** Parse `SolarDesign.layoutBlocks` from the database. Bad data reads as empty. */
export function parseLayoutBlocks(raw: unknown): LayoutBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is LayoutBlock => {
    if (!b || typeof b !== "object") return false;
    const x = b as Record<string, unknown>;
    return (
      typeof x.id === "string" &&
      Number.isFinite(x.originE) &&
      Number.isFinite(x.originN) &&
      Number.isFinite(x.rotationDeg) &&
      Number.isInteger(x.cols) &&
      Number.isInteger(x.rows) &&
      (x.orientation === "portrait" || x.orientation === "landscape") &&
      Array.isArray(x.omitted)
    );
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- solar-layout`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar-layout.ts src/lib/__tests__/solar-layout.test.ts
git commit -m "feat(solar): panel layout geometry, in ground metres"
```

---

## Task 9: Saving a layout sets the module count

**Files:**
- Create: `src/server/modules/solar/layout-actions.ts`
- Modify: `src/server/modules/solar/__tests__/design-sizing.itest.ts`

- [ ] **Step 1: Write the failing test**

Append to `design-sizing.itest.ts`:

```ts
describe("the layout is what sets the module count", () => {
  it("counts the geometry it was given and ignores any count in the payload", async () => {
    await panel({ ratingW: 400, isDefault: true });
    await db.solarDesign.create({ data: { companyId, leadId, moduleQty: 0 } });

    const { panelCount } = await import("@/lib/solar-layout");
    const blocks = [
      { id: "b1", originE: 0, originN: 0, rotationDeg: 0, cols: 5, rows: 4, orientation: "portrait", omitted: [3] },
    ];
    expect(panelCount(blocks as never)).toBe(19);

    await db.solarDesign.update({
      where: { leadId },
      data: { layoutBlocks: blocks, moduleQty: panelCount(blocks as never) },
    });

    const after = await db.solarDesign.findUnique({ where: { leadId } });
    expect(after?.moduleQty).toBe(19);
    // 19 panels x 400W
    expect(19 * 400 / 1000).toBeCloseTo(7.6, 6);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- design-sizing`
Expected: PASS — it pins the arithmetic the action must reproduce.

- [ ] **Step 3: Write the action**

```ts
// src/server/modules/solar/layout-actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { fail, ok } from "@/server/modules/solar/actions";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./actions";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";
import { year1Production, offsetPct } from "@/lib/solar-money";

const blockSchema = z.object({
  id: z.string().min(1).max(40),
  originE: z.number().finite().min(-200).max(200),
  originN: z.number().finite().min(-200).max(200),
  rotationDeg: z.number().finite().min(-360).max(360),
  cols: z.number().int().min(0).max(60),
  rows: z.number().int().min(0).max(60),
  orientation: z.enum(["portrait", "landscape"]),
  omitted: z.array(z.number().int()).max(3600),
});

const layoutSchema = z.object({
  leadId: z.string().min(1),
  blocks: z.array(blockSchema).max(40),
});

/**
 * Save the drawn array, and let it set the module count.
 *
 * The client never sends a panel count. It sends geometry, and the server
 * counts it — the same discipline as system size and offset, and for the same
 * reason: every number a homeowner reads has to come from something nobody in
 * the browser can retype.
 */
export async function saveSolarLayoutAction(input: z.infer<typeof layoutSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return fail("That layout could not be read.");
  const { leadId, blocks } = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  const existing = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: { moduleId: true, annualUsageKwh: true },
  });

  const moduleQty = panelCount(blocks as LayoutBlock[]);
  if (moduleQty > 500) return fail("That is more than 500 panels — check the drawing.");

  const assumptions = await getSolarSettings(user.companyId);
  const module_ = await resolveSizingModule(user.companyId, existing?.moduleId ?? null);

  const systemSizeKwDc = module_?.ratingW ? (moduleQty * module_.ratingW) / 1000 : 0;
  const year1ProductionKwh = year1Production(systemSizeKwDc, assumptions);
  const computedOffset = existing?.annualUsageKwh
    ? offsetPct(year1ProductionKwh, existing.annualUsageKwh)
    : 0;

  const data = {
    layoutBlocks: blocks,
    moduleQty,
    moduleId: module_?.id ?? null,
    systemSizeKwDc,
    year1ProductionKwh,
    offsetPct: computedOffset,
  };

  await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${leadId}`);
  return { ...ok(), moduleQty, systemSizeKwDc, year1ProductionKwh, offsetPct: computedOffset };
}
```

If `fail` / `ok` are not exported from `actions.ts`, import them from wherever that file gets them rather than redefining them.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/solar/layout-actions.ts src/server/modules/solar/__tests__/design-sizing.itest.ts
git commit -m "feat(solar): the drawn array sets the module count, server-side"
```

---

## Task 10: The canvas, showing the roof

**Files:**
- Create: `src/components/portal/solar-layout-designer.tsx`
- Modify: `src/app/portal/leads/[id]/solar-proposal/page.tsx`

- [ ] **Step 1: Pass the deal's coordinate to the builder**

In `solar-proposal/page.tsx`, add `lat: true, lng: true` to the `lead` select and pass:

```tsx
  lat={lead.lat}
  lng={lead.lng}
  moduleMm={{ widthMm: defaultModule?.widthMm ?? 1134, heightMm: defaultModule?.heightMm ?? 1762 }}
  initialBlocks={parseLayoutBlocks(design?.layoutBlocks)}
```

where `defaultModule` is the row `resolveSizingModule` would return — query it here with `select: { widthMm: true, heightMm: true, ratingW: true }` so the designer can show a live kW figure. Thread all four through `SolarProposalBuilder` into `SolarDesignPanel`.

- [ ] **Step 2: Build the canvas shell**

`solar-layout-designer.tsx`, a client component. State: `blocks: LayoutBlock[]`, `selectedId`, `view: { zoom: 20 | 21; panX: number; panY: number; scale: number }`, `history: LayoutBlock[][]`.

The base image is `<img src={`/api/property/satellite?leadId=${leadId}&zoom=${view.zoom}`}>` loaded into an `Image()` and drawn to the canvas each frame. It is same-origin — the route proxies Google server-side so the API key never reaches the browser — so `canvas.toBlob()` in Task 12 is not blocked by a tainted canvas. Do not switch to a direct Google URL for any reason; it would both leak the key and break saving.

Render loop:

```tsx
const mpp = metresPerPixel(lat, view.zoom, 2) / view.scale;
const size = 1280;
// base image, then every block's panels via panelCorners + metresToImagePx
```

If `lat`/`lng` are null, render the existing upload-only panel with the message "This deal has no rooftop coordinate yet, so the roof cannot be shown. Fix the address, or upload a layout drawn elsewhere." — never a blank canvas.

Include a zoom 20/21 toggle: Google's maximum zoom varies by area and it answers an unavailable zoom with a grey tile and HTTP 200, so the rep needs a way out that is not "the tool is broken".

- [ ] **Step 3: Verify by eye**

Run: `npm run dev`, open a solar deal's Build Proposal.
Expected: the roof, framed and centred, panning and zooming smoothly, with no panels yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/solar-layout-designer.tsx "src/app/portal/leads/[id]/solar-proposal/page.tsx" src/components/portal/solar-proposal-builder.tsx src/components/portal/solar-panels.tsx
git commit -m "feat(solar): show the roof in the proposal builder"
```

---

## Task 11: Drawing, rotating and editing the array

**Files:**
- Modify: `src/components/portal/solar-layout-designer.tsx`

- [ ] **Step 1: Rubber-band a block**

Pointer-down on empty imagery starts a rectangle; pointer-move draws it; pointer-up converts pixel extents to metres (`× mpp`), calls `fitBlock`, and pushes a block whose origin is the rectangle's top-left in ground metres. A drag yielding `cols === 0 || rows === 0` adds nothing and shows "Too small for a panel" rather than an invisible empty block.

- [ ] **Step 2: Rotate**

A handle above the selected block's top edge. Dragging sets `rotationDeg` from `atan2` of the pointer relative to the block origin, snapped to 5° unless Shift is held. Show the angle numerically while dragging — a rep matching a ridge needs to see 24°, not guess it.

- [ ] **Step 3: Resize by rows and columns**

Handles on the right and bottom edges add or remove whole columns/rows. Never a fractional panel: recompute `cols`/`rows` from the dragged distance with `fitBlock`.

- [ ] **Step 4: Knock panels out**

A click that hits a panel (point-in-polygon against `panelCorners`, which already returns ground-metre corners) toggles that grid index in `omitted`. A click on an omitted cell restores it, so a mis-click costs nothing.

- [ ] **Step 5: Delete, orientation, undo**

`Delete`/`Backspace` removes the selected block. `P` toggles its orientation and refits. `Cmd/Ctrl-Z` pops the history stack. Push to history on every committed mutation, not on every pointer-move.

- [ ] **Step 6: Live totals**

A toolbar showing `panelCount(blocks)` and `panelCount × ratingW / 1000` kW-DC, updating as the rep draws, so they can size against the bill without saving.

- [ ] **Step 7: Verify by eye**

Draw a 5×4 block on a roof, rotate it to the ridge, knock out two panels for a vent, confirm the toolbar reads 18 panels.

- [ ] **Step 8: Commit**

```bash
git add src/components/portal/solar-layout-designer.tsx
git commit -m "feat(solar): draw, rotate and edit the array on the roof"
```

---

## Task 12: Saving — the count, then the picture

**Files:**
- Modify: `src/components/portal/solar-layout-designer.tsx`
- Modify: `src/components/portal/solar-panels.tsx`
- Modify: `src/server/modules/solar/actions.ts`

- [ ] **Step 1: Save the geometry first**

```tsx
const res = await saveSolarLayoutAction({ leadId, blocks });
if (!res.ok) return toast.error(res.error);
```

- [ ] **Step 2: Then render the picture into the existing layout slot**

```tsx
// The count is what the quote depends on, so it is saved first and stands on
// its own. The image is the customer's copy of the same thing — worth
// reporting separately if it fails, never worth losing the count over.
const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
if (blob) {
  const fd = new FormData();
  fd.set("leadId", leadId);
  fd.set("file", new File([blob], "panel-layout.jpg", { type: "image/jpeg" }));
  fd.set("designProvider", "Anexa Designer");
  fd.set("designExternalRef", "");
  const up = await uploadPanelLayoutAction(fd);
  if (!up.ok) toast.error(`Layout saved, but the image did not attach: ${up.error}`);
}
toast.success(`${res.moduleQty} panels saved`);
router.refresh();
```

Export the canvas WITHOUT selection handles, rotation gizmos or the hover highlight — the customer sees this image. Redraw once into an offscreen canvas with a `chrome: false` flag rather than trying to hide DOM overlays.

- [ ] **Step 3: Make module quantity read-only**

In `SolarDesignPanel`, replace the `moduleQty` input with text inside the layout section:

```tsx
<p className="text-sm">
  <span className="font-display text-lg font-semibold">{design?.moduleQty ?? 0}</span> panels
  <span className="text-muted-foreground"> · drawn on the roof above</span>
</p>
```

Remove `moduleQty` from `designSchema` and from `saveSolarDesignAction`'s writes; `saveSolarLayoutAction` is now its only writer. In the design action, read the existing quantity for the size recompute:

```ts
  const moduleQty = existing?.moduleQty ?? 0;
```

- [ ] **Step 4: Verify**

Draw an array, save, reload the page. Expected: the same panels in the same places, the count above the derived strip, and the rendered image in the proposal's layout slot marked preliminary.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/solar-layout-designer.tsx src/components/portal/solar-panels.tsx src/server/modules/solar/actions.ts
git commit -m "feat(solar): saving the layout sets the count and draws the customer's picture"
```

---

## Task 13: No layout, no quote

**Files:**
- Modify: `src/lib/solar-validation.ts:330-340`
- Modify: `src/lib/__tests__/solar-validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("a quote needs a drawing", () => {
  it("blocks generation when no layout has been drawn or attached", () => {
    const issues = validateDocuments({ hasLayoutImage: false }, "lead-1");
    const found = issues.find((i) => i.code === "documents.no_layout");
    expect(found?.severity).toBe("block");
    expect(found?.action?.href).toContain("step=design");
  });
});
```

Match `validateDocuments` to that function's real name and signature in the file.

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- solar-validation`
Expected: FAIL — severity is `"warn"`.

- [ ] **Step 3: Promote it**

```ts
    block(
      "documents.no_layout",
      "documents",
      "layoutImageFileId",
      "No panel layout has been drawn. The module count, and therefore the price, comes from it."
    );
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- solar-validation && npm run test:integration -- design-sizing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar-validation.ts src/lib/__tests__/solar-validation.test.ts
git commit -m "feat(solar): a proposal without a layout cannot be generated"
```

---

## Task 14: End-to-end

**Files:**
- Create: `e2e/solar-layout-designer.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

/**
 * The designer's contract, end to end: what a rep draws is what the deal is
 * sized from, and it survives a reload.
 */
test("drawing an array sizes the system", async ({ page }) => {
  // Sign in and seed the deal with the SAME helpers
  // e2e/solar-proposal-builder.spec.ts uses — copy its imports and its
  // beforeEach verbatim, and take `leadId` from the seeded deal it creates.
  await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);

  const canvas = page.getByTestId("layout-canvas");
  await expect(canvas).toBeVisible();

  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 500, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByTestId("panel-count")).not.toHaveText("0 panels");
  const drawn = await page.getByTestId("panel-count").textContent();

  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText(/panels saved/)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("panel-count")).toHaveText(drawn!);
});

test("the design step no longer asks for what nobody decides here", async ({ page }) => {
  await page.goto(`/portal/leads/${leadId}/solar-proposal?step=design`);
  await expect(page.getByLabel("Annual usage (kWh)")).toBeVisible();
  for (const gone of ["Utility account #", "Meter #", "Rate plan / tariff", "TSRF %", "Net metering programme"]) {
    await expect(page.getByLabel(gone)).toHaveCount(0);
  }
});
```

Add `data-testid="layout-canvas"` and `data-testid="panel-count"` in Task 10/11's component. Assert on `getByLabel`, not on placeholder text — an `aria-label` on a wrapper has bitten selectors in this repo before.

- [ ] **Step 2: Run it**

Run: `npx playwright test solar-layout-designer`
Expected: PASS (2 tests). If port 3001 is held by another session's run, start yours on a different port rather than killing theirs.

- [ ] **Step 3: Full suite**

Run: `npm test && npm run test:integration && npm run typecheck && npm run lint`
Expected: PASS. Eight Playwright specs already fail on this baseline — check any failure against that list before blaming this work.

- [ ] **Step 4: Commit**

```bash
git add e2e/solar-layout-designer.spec.ts src/components/portal/solar-layout-designer.tsx
git commit -m "test(solar): end-to-end cover for the layout designer"
```

---

## Done when

- Step 1 shows utility provider, annual usage, average monthly bill, mount type, the drawn array and the derived strip. Nothing else.
- Panel count comes only from geometry the server counted.
- Account #, meter #, inverter and battery are editable on the deal's Operations card and cannot move a quoted number.
- The net-metering programme is set once per company and still prints on every proposal.
- A design with no layout cannot generate a proposal.
- `npm test`, `npm run test:integration`, `npm run typecheck` and `npm run lint` all pass.
