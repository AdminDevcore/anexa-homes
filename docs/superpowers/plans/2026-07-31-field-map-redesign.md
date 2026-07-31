# Field Map Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/portal/canvassing` as a full-bleed, map-first screen where a rep logs a knock in two taps and manager tooling only renders for `canManage`.

**Architecture:** `canvassing-client.tsx` (1,739 lines) is decomposed into `src/components/portal/field-map/`. Filter state moves into a pure module (`src/lib/field-map-filters.ts`) that serialises to URL query params, so it is unit-testable without a DOM. House and deal Leaflet popups are replaced by a bottom sheet driven by `onKnockClick` / `onDealClick` callbacks; territory popups stay. The page escapes the portal's padding and sizes to `calc(100dvh-4rem)`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind, react-leaflet, TanStack Query, shadcn `sheet.tsx` (already supports `side="bottom"`), framer-motion (already a dependency), Vitest (node env, `src/**/*.test.ts`), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-31-field-map-redesign-design.md`

---

## Context an engineer needs before starting

Read these first. They contain hard-won constraints that are easy to break:

- `src/components/portal/canvassing-shell.tsx:48` — the map is `forceMount`ed on purpose. Tearing down the Leaflet container on tab switch throws `_leaflet_pos`. **Keep `forceMount`.**
- `src/components/portal/canvassing-client.tsx:114-118` — `statuses` is memoised because an unstable array re-renders every marker and crashes Leaflet popup positioning. Same reason for `persistedKnocks`, `deals`, `zips`, `center`, `highlightTerritoryIds`.
- `src/components/portal/canvassing-client.tsx:120-124` — `handleMapReady` must be a stable `useCallback` or `MapController`'s effect re-subscribes listeners every render and loops.
- `src/components/portal/canvassing-client.tsx:449-459` — auto-loaded house dots have synthetic ids (`house:<lat>,<lng>`) and **no DB row**. Any write must call `ensureHouseKnockAction` first to materialise them. This applies to disposition changes, owner lookup, convert and move.
- `src/components/portal/canvassing-client.tsx:266-269` — `?houses=off` disables the live OSM house fetch. Every Playwright test uses it.
- Vitest is `environment: "node"` and only picks up `src/**/*.test.ts` (**not** `.tsx`). There is no testing-library. Component behaviour is tested with Playwright; pure logic with Vitest.
- The portal content area is `<main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">` (`src/components/portal/portal-shell.tsx:188`) and the header is `h-16`.

Run commands from `anexa-homes/`. The dev DB is on port 5544; if Prisma reports "Unknown field" after any schema touch, restart the dev server (this plan has no schema changes, so that should not arise).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/field-map-filters.ts` | Create | Pure filter type, defaults, URL parse/serialise, active-count. No React. |
| `src/lib/__tests__/field-map-filters.test.ts` | Create | Vitest unit tests for the above. |
| `src/components/portal/field-map/use-map-filters.ts` | Create | Binds the pure module to the URL via `useRouter`/`useSearchParams`. |
| `src/components/portal/field-map/use-field-map-data.ts` | Create | The six TanStack queries + derived `knocks`/`deals`/`zips` memos. |
| `src/components/portal/field-map/knock-sheet.tsx` | Create | Bottom sheet: disposition grid (peek) + full detail (expanded). |
| `src/components/portal/field-map/deal-sheet.tsx` | Create | Bottom sheet for deal pins. |
| `src/components/portal/field-map/layers-panel.tsx` | Create | Layer toggles. Shared by rep sheet and manager rail; `canManage` gates ZIP/Reports/Warnings. |
| `src/components/portal/field-map/layers-sheet.tsx` | Create | Rep-only bottom sheet wrapping `LayersPanel`. |
| `src/components/portal/field-map/filters-sheet.tsx` | Create | Rep filter sheet (date, dispositions, remaining, deals). |
| `src/components/portal/field-map/manager-rail.tsx` | Create | Collapsible 320px rail: Layers, Filters, Territories, Storm. |
| `src/components/portal/field-map/map-overlays.tsx` | Create | Floating search/locate bar, status bar, loading pill, move/search banners. |
| `src/components/portal/field-map/dialogs.tsx` | Create | `TerritoryDialog`, `ConvertDialog`, `KnockDetailDialog`, `AddressSearch`, `HouseValue` moved verbatim. |
| `src/components/portal/field-map/field-map.tsx` | Create | Layout shell + role branch. Target ~200 lines. |
| `src/components/portal/canvassing-map.tsx` | Modify | Add `onKnockClick`/`onDealClick`; drop `renderKnockPopup`/`renderDealPopup`. |
| `src/components/portal/canvassing-shell.tsx` | Modify | 7 tabs → 3; full-bleed wrapper. |
| `src/components/portal/canvassing-insights.tsx` | Create | Dashboard + Leaderboard in one scroll. |
| `src/components/portal/canvassing-client.tsx` | Delete | Replaced by `field-map/`. |
| `e2e/field-map-mobile.spec.ts` | Create | Mobile viewport: two-tap knock, filter URL round-trip, role split. |
| `e2e/canvassing.spec.ts` | Modify | Retarget selectors that this redesign moves. |

---

## Task 1: Pure filter module

**Files:**
- Create: `src/lib/field-map-filters.ts`
- Test: `src/lib/__tests__/field-map-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/field-map-filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  activeFilterCount,
  type FieldMapFilters,
} from "@/lib/field-map-filters";

describe("parseFilters", () => {
  it("returns defaults for an empty query string", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS);
  });

  it("reads dispositions from a comma list", () => {
    const f = parseFilters(new URLSearchParams("disp=sold,callback"));
    expect([...f.dispositions].sort()).toEqual(["callback", "sold"]);
  });

  it("ignores disposition values that are not real dispositions", () => {
    const f = parseFilters(new URLSearchParams("disp=sold,bogus"));
    expect([...f.dispositions]).toEqual(["sold"]);
  });

  // The "Not Knocked" chip is a filterable disposition even though a rep can't
  // *set* it. Validating against KNOCKED_DISPOSITIONS would silently drop it.
  it("keeps not_knocked, which is filterable but not settable", () => {
    const f = parseFilters(new URLSearchParams("disp=not_knocked"));
    expect([...f.dispositions]).toEqual(["not_knocked"]);
  });

  it("reads booleans, rep, date preset and custom range", () => {
    const f = parseFilters(
      new URLSearchParams("remaining=1&deals=0&rep=rep_1&date=custom&from=2026-01-01&to=2026-01-31")
    );
    expect(f.remainingOnly).toBe(true);
    expect(f.showDeals).toBe(false);
    expect(f.repId).toBe("rep_1");
    expect(f.datePreset).toBe("custom");
    expect(f.dateFrom).toBe("2026-01-01");
    expect(f.dateTo).toBe("2026-01-31");
  });

  it("falls back to the default preset when date is unrecognised", () => {
    expect(parseFilters(new URLSearchParams("date=lastCentury")).datePreset).toBe("all");
  });

  it("clamps minScore into 0-150 and defaults non-numeric input", () => {
    expect(parseFilters(new URLSearchParams("score=200")).minScore).toBe(150);
    expect(parseFilters(new URLSearchParams("score=-5")).minScore).toBe(0);
    expect(parseFilters(new URLSearchParams("score=abc")).minScore).toBe(0);
  });
});

describe("serializeFilters", () => {
  it("emits nothing for defaults so a clean URL stays clean", () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("round-trips through parseFilters", () => {
    const f: FieldMapFilters = {
      ...DEFAULT_FILTERS,
      dispositions: new Set(["sold", "not_home"]),
      remainingOnly: true,
      showDeals: false,
      repId: "rep_9",
      datePreset: "week",
      minScore: 40,
      showZips: false,
      showHeat: false,
    };
    expect(parseFilters(new URLSearchParams(serializeFilters(f)))).toEqual(f);
  });

  it("sorts dispositions so the URL is stable across renders", () => {
    const a = serializeFilters({ ...DEFAULT_FILTERS, dispositions: new Set(["sold", "callback"]) });
    const b = serializeFilters({ ...DEFAULT_FILTERS, dispositions: new Set(["callback", "sold"]) });
    expect(a).toBe(b);
  });
});

describe("activeFilterCount", () => {
  it("is zero for defaults", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it("counts each engaged filter once", () => {
    const f: FieldMapFilters = {
      ...DEFAULT_FILTERS,
      dispositions: new Set(["sold", "callback"]),
      remainingOnly: true,
      repId: "rep_1",
      datePreset: "today",
    };
    // dispositions (1) + remainingOnly (1) + rep (1) + date (1)
    expect(activeFilterCount(f)).toBe(4);
  });

  it("does not count layer toggles — they are not filters", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, showZips: false, showHeat: false })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npm run test -- src/lib/__tests__/field-map-filters.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/field-map-filters"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/field-map-filters.ts`:

```ts
// Pure filter state for the Field Map. No React, no DOM — so it unit-tests under
// vitest's node environment and stays the single definition of "what is filtered".
import { DISPOSITIONS } from "@/lib/canvassing";

export type DatePreset = "today" | "yesterday" | "week" | "month" | "all" | "custom";

const DATE_PRESETS: DatePreset[] = ["today", "yesterday", "week", "month", "all", "custom"];

// DISPOSITIONS, not KNOCKED_DISPOSITIONS: "not_knocked" is filterable (it's the
// "Remaining" chip) even though a rep can never set it on a house.
const FILTERABLE = DISPOSITIONS.map((d) => d.value);

export const MAX_SCORE = 150;

export type FieldMapFilters = {
  dispositions: Set<string>;
  remainingOnly: boolean;
  showDeals: boolean;
  repId: string; // "all" | rep id
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  // Layer toggles ride along in the URL so a shared link restores the whole view,
  // but they are deliberately excluded from activeFilterCount.
  basemap: "satellite" | "street";
  showZips: boolean;
  showRadar: boolean;
  showStormReports: boolean;
  showStormWarnings: boolean;
  showHeat: boolean;
  minScore: number;
};

export const DEFAULT_FILTERS: FieldMapFilters = {
  dispositions: new Set(),
  remainingOnly: false,
  showDeals: true,
  repId: "all",
  datePreset: "all",
  dateFrom: "",
  dateTo: "",
  basemap: "satellite",
  showZips: true,
  showRadar: true,
  showStormReports: false,
  showStormWarnings: false,
  showHeat: true,
  minScore: 0,
};

const bool = (v: string | null, fallback: boolean) => (v === null ? fallback : v === "1");

export function parseFilters(sp: URLSearchParams): FieldMapFilters {
  const disp = (sp.get("disp") ?? "").split(",").filter((d) => FILTERABLE.includes(d));

  const rawPreset = sp.get("date");
  const datePreset = DATE_PRESETS.includes(rawPreset as DatePreset)
    ? (rawPreset as DatePreset)
    : DEFAULT_FILTERS.datePreset;

  const rawScore = Number(sp.get("score"));
  const minScore = Number.isFinite(rawScore)
    ? Math.min(MAX_SCORE, Math.max(0, rawScore))
    : DEFAULT_FILTERS.minScore;

  const rawBasemap = sp.get("base");

  return {
    dispositions: new Set(disp),
    remainingOnly: bool(sp.get("remaining"), DEFAULT_FILTERS.remainingOnly),
    showDeals: bool(sp.get("deals"), DEFAULT_FILTERS.showDeals),
    repId: sp.get("rep") ?? DEFAULT_FILTERS.repId,
    datePreset,
    dateFrom: sp.get("from") ?? DEFAULT_FILTERS.dateFrom,
    dateTo: sp.get("to") ?? DEFAULT_FILTERS.dateTo,
    basemap: rawBasemap === "street" ? "street" : DEFAULT_FILTERS.basemap,
    showZips: bool(sp.get("zips"), DEFAULT_FILTERS.showZips),
    showRadar: bool(sp.get("hail"), DEFAULT_FILTERS.showRadar),
    showStormReports: bool(sp.get("reports"), DEFAULT_FILTERS.showStormReports),
    showStormWarnings: bool(sp.get("warnings"), DEFAULT_FILTERS.showStormWarnings),
    showHeat: bool(sp.get("heat"), DEFAULT_FILTERS.showHeat),
    minScore,
  };
}

/** Only non-default values are emitted, so an untouched map keeps a clean URL. */
export function serializeFilters(f: FieldMapFilters): string {
  const sp = new URLSearchParams();
  if (f.dispositions.size) sp.set("disp", [...f.dispositions].sort().join(","));
  if (f.remainingOnly !== DEFAULT_FILTERS.remainingOnly) sp.set("remaining", f.remainingOnly ? "1" : "0");
  if (f.showDeals !== DEFAULT_FILTERS.showDeals) sp.set("deals", f.showDeals ? "1" : "0");
  if (f.repId !== DEFAULT_FILTERS.repId) sp.set("rep", f.repId);
  if (f.datePreset !== DEFAULT_FILTERS.datePreset) sp.set("date", f.datePreset);
  if (f.dateFrom) sp.set("from", f.dateFrom);
  if (f.dateTo) sp.set("to", f.dateTo);
  if (f.basemap !== DEFAULT_FILTERS.basemap) sp.set("base", f.basemap);
  if (f.showZips !== DEFAULT_FILTERS.showZips) sp.set("zips", f.showZips ? "1" : "0");
  if (f.showRadar !== DEFAULT_FILTERS.showRadar) sp.set("hail", f.showRadar ? "1" : "0");
  if (f.showStormReports !== DEFAULT_FILTERS.showStormReports) sp.set("reports", f.showStormReports ? "1" : "0");
  if (f.showStormWarnings !== DEFAULT_FILTERS.showStormWarnings) sp.set("warnings", f.showStormWarnings ? "1" : "0");
  if (f.showHeat !== DEFAULT_FILTERS.showHeat) sp.set("heat", f.showHeat ? "1" : "0");
  if (f.minScore !== DEFAULT_FILTERS.minScore) sp.set("score", String(f.minScore));
  return sp.toString();
}

/** Badge count on the Filters button. Layer toggles are not filters. */
export function activeFilterCount(f: FieldMapFilters): number {
  let n = 0;
  if (f.dispositions.size) n++;
  if (f.remainingOnly) n++;
  if (!f.showDeals) n++;
  if (f.repId !== "all") n++;
  if (f.datePreset !== "all") n++;
  return n;
}

/** Server-side status filter for the knock query — matches today's behaviour. */
export function statusesFor(f: FieldMapFilters): string[] {
  return (f.remainingOnly ? ["not_knocked"] : [...f.dispositions]).slice().sort();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npm run test -- src/lib/__tests__/field-map-filters.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/field-map-filters.ts src/lib/__tests__/field-map-filters.test.ts
git commit -m "feat(field-map): pure, URL-serialisable filter state"
```

---

## Task 2: Extract dialogs and helpers verbatim

Pure move. No behaviour changes — this is what makes the later tasks reviewable.

**Files:**
- Create: `src/components/portal/field-map/dialogs.tsx`
- Modify: `src/components/portal/canvassing-client.tsx`

- [ ] **Step 1: Create the new file with the moved code**

Create `src/components/portal/field-map/dialogs.tsx`. Move these symbols out of `canvassing-client.tsx` **without editing their bodies**, and `export` each one:

- `usd`, `shortUsd`, `monthYear`, `yearOf`, `PropertyValueResp` (from `canvassing-client.tsx:991-1010`)
- `HouseValue` / property-value display component (the block following `PropertyValueResp`)
- `AddressSearch` (the component owning `term`/`debounced`/`open`, `canvassing-client.tsx:1111`)
- `TerritoryDialog` (owns `name`/`color`/`repId`/`busy`/`houseCount`, `canvassing-client.tsx:1255`)
- `ConvertDialog` (owns `firstName`/`lastName`/`phone`/`busy`, `canvassing-client.tsx:1352`)
- `KnockDetailDialog` (owns `comment`/`contact`/`savingContact`/`lookingUp`/`apptAt`/`apptRep`/`bookingAppt`, `canvassing-client.tsx:1465`)

Start the file with `"use client";` and copy across only the imports those symbols actually use.

- [ ] **Step 2: Re-point the old file at the new one**

In `canvassing-client.tsx`, delete the moved definitions and add:

```ts
import {
  usd,
  AddressSearch,
  TerritoryDialog,
  ConvertDialog,
  KnockDetailDialog,
} from "./field-map/dialogs";
```

`usd` is re-exported from `canvassing-client.tsx` today (`export const usd`). Find every importer and re-point it:

```bash
grep -rn 'from "@/components/portal/canvassing-client"\|from "./canvassing-client"' src/
```

Update each hit to import from `@/components/portal/field-map/dialogs`.

- [ ] **Step 3: Verify nothing changed**

```bash
npm run typecheck && npm run lint
```

Expected: both clean. If `typecheck` reports an unused import in `canvassing-client.tsx`, delete that import.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/field-map/dialogs.tsx src/components/portal/canvassing-client.tsx
git commit -m "refactor(field-map): extract dialogs and value helpers, no behaviour change"
```

---

## Task 3: Data hook

**Files:**
- Create: `src/components/portal/field-map/use-field-map-data.ts`

- [ ] **Step 1: Create the hook**

Move the six queries and their derived memos out of `canvassing-client.tsx:61-323` verbatim into a hook. Signature:

```ts
"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvassingMeta, KnockDTO, TerritoryDTO, DealDTO } from "@/server/modules/canvassing/queries";
import type { Viewport, ZipFeature } from "../canvassing-map";
import type { StormSwathDTO, StormEventDTO } from "@/server/modules/storm/queries";
import type { StormWarning } from "@/components/portal/storm/storm-map";
import type { FieldMapFilters } from "@/lib/field-map-filters";
import { statusesFor } from "@/lib/field-map-filters";
import { resolveRange } from "../canvassing-filters";

export const MIN_PIN_ZOOM = 16;
export const MIN_DEAL_ZOOM = 11;

export type FieldMapData = {
  meta: CanvassingMeta | undefined;
  canManage: boolean;
  ownerLookupEnabled: boolean;
  territories: TerritoryDTO[];
  reps: { id: string; name: string }[];
  knocks: KnockDTO[];       // persisted + synthetic house dots, merged
  deals: DealDTO[];
  zips: ZipFeature[];
  zipsTooBig: boolean;
  radarSwaths: StormSwathDTO[];
  stormEvents: StormEventDTO[];
  stormWarnings: StormWarning[];
  knockScores: Record<string, number>;
  dealScores: Record<string, number>;
  statsByDisp: Record<string, number>;
  knockedCount: number;
  zoomOK: boolean;
  loading: boolean;         // any of knocks/houses/zips in flight
  loadingLabel: string;     // "Loading houses…" etc — the e2e specs match on this
  refresh: () => void;
};

export function useFieldMapData(filters: FieldMapFilters, viewport: Viewport | null): FieldMapData {
  // ... bodies moved verbatim from canvassing-client.tsx:61-375
}
```

Rules while moving:

- Read `repFilter` from `filters.repId`, `statusKey` from `statusesFor(filters).join(",")`, and the layer flags from `filters.showZips` / `filters.showRadar` / `filters.showStormReports` / `filters.showStormWarnings` / `filters.showHeat`.
- **Keep every `React.useMemo`.** `persistedKnocks`, `deals`, `zips`, `knocks`, `statuses` are memoised to keep array identity stable; an unstable array re-renders every marker and crashes Leaflet's popup positioning.
- Keep `refetchOnWindowFocus: false` on the map queries.
- Keep `placeholderData: (prev) => prev`.
- Keep the `?houses=off` escape hatch (`canvassing-client.tsx:266-269`) exactly as written — the e2e suite depends on it.
- `loadingLabel` reproduces the existing string ladder at `canvassing-client.tsx:896` so `e2e/canvassing.spec.ts:23` keeps matching `/Loading (houses|pins)…/`.
- The `minScore` filtering at `canvassing-client.tsx:321-323` stays **out** of this hook — it belongs with the map props in Task 9.

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: clean. The hook is not wired up yet; nothing else imports it.

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/field-map/use-field-map-data.ts
git commit -m "refactor(field-map): extract map data queries into useFieldMapData"
```

---

## Task 4: Filters hook bound to the URL

**Files:**
- Create: `src/components/portal/field-map/use-map-filters.ts`

- [ ] **Step 1: Create the hook**

```ts
"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  activeFilterCount,
  type FieldMapFilters,
} from "@/lib/field-map-filters";

export type MapFilters = {
  filters: FieldMapFilters;
  activeCount: number;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  toggleDisposition: (value: string) => void;
  reset: () => void;
};

export function useMapFilters(): MapFilters {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Recomputed only when the query string actually changes. `dispositions` is a
  // Set, so a fresh object every render would churn every downstream memo and
  // re-render every Leaflet marker.
  const qs = searchParams.toString();
  const filters = React.useMemo(() => parseFilters(new URLSearchParams(qs)), [qs]);

  const push = React.useCallback(
    (next: FieldMapFilters) => {
      // `houses=off` is an E2E escape hatch that lives outside filter state; carry
      // it through so a filter change doesn't switch the live OSM fetch back on.
      const serialized = serializeFilters(next);
      const sp = new URLSearchParams(serialized);
      const houses = new URLSearchParams(qs).get("houses");
      if (houses) sp.set("houses", houses);
      const query = sp.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, qs, router]
  );

  const set = React.useCallback(
    <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => {
      push({ ...filters, [key]: value });
    },
    [filters, push]
  );

  const toggleDisposition = React.useCallback(
    (value: string) => {
      const next = new Set(filters.dispositions);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      push({ ...filters, dispositions: next });
    },
    [filters, push]
  );

  const reset = React.useCallback(() => push(DEFAULT_FILTERS), [push]);

  return { filters, activeCount: activeFilterCount(filters), set, toggleDisposition, reset };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/field-map/use-map-filters.ts
git commit -m "feat(field-map): sync filter state to URL query params"
```

---

## Task 5: Map emits click callbacks instead of rendering house popups

**Files:**
- Modify: `src/components/portal/canvassing-map.tsx:202-234` (props), `:409-432` (knocks), `:440-463` (deals)

- [ ] **Step 1: Change the props type**

In `CanvassingMapProps`, replace these two lines:

```ts
  renderKnockPopup: (k: KnockDTO) => React.ReactNode;
  renderDealPopup?: (d: DealDTO) => React.ReactNode;
```

with:

```ts
  // Houses and deals open a bottom sheet, not a Leaflet popup: popups clip at
  // screen edges, shove the map around, and can't hold a 56px tap target.
  onKnockClick: (k: KnockDTO) => void;
  onDealClick?: (d: DealDTO) => void;
```

`renderTerritoryPopup` stays — territory management is manager-only and desktop-only.

- [ ] **Step 2: Update the destructure**

At `canvassing-map.tsx:246-247`, replace `renderKnockPopup,` / `renderDealPopup,` with `onKnockClick,` / `onDealClick,`.

- [ ] **Step 3: Replace the knock marker's popup with a click handler**

Replace the knock `<Marker>` block (`canvassing-map.tsx:409-432`) with:

```tsx
      {knocks.map((k) => {
        const moving = movingId === k.id;
        return (
          <Marker
            key={k.id}
            position={[k.lat, k.lng]}
            icon={knockIcon(k.disposition)}
            draggable={moving}
            zIndexOffset={moving ? 2000 : 0}
            eventHandlers={
              moving
                ? {
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      onMovePin?.("knock", k.id, ll.lat, ll.lng);
                    },
                  }
                : { click: () => onKnockClick(k) }
            }
          />
        );
      })}
```

- [ ] **Step 4: Replace the deal marker's popup with a click handler**

Replace the deal `<Marker>` block (`canvassing-map.tsx:440-463`) with:

```tsx
      {(deals ?? []).map((d) => {
        const moving = movingId === `deal-${d.id}`;
        return (
          <Marker
            key={`deal-${d.id}`}
            position={[d.lat, d.lng]}
            icon={dealIcon(d.stageColor)}
            draggable={moving}
            zIndexOffset={moving ? 2100 : 1000}
            eventHandlers={
              moving
                ? {
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      onMovePin?.("deal", d.id, ll.lat, ll.lng);
                    },
                  }
                : { click: () => onDealClick?.(d) }
            }
          />
        );
      })}
```

- [ ] **Step 5: Keep the old caller compiling**

`canvassing-client.tsx` still passes `renderKnockPopup`. Change its `<CanvassingMap>` call (`canvassing-client.tsx:930-931`) to:

```tsx
          onKnockClick={(k) => void openDetails(k)}
          onDealClick={(d) => router.push(`/portal/leads/${d.id}`)}
```

and delete the now-unused `renderKnockPopup` / `renderDealPopup` function definitions (`canvassing-client.tsx:517-640`). This file is deleted in Task 9; this step only keeps the tree green in between.

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/portal/canvassing-map.tsx src/components/portal/canvassing-client.tsx
git commit -m "refactor(field-map): map emits knock/deal clicks instead of rendering popups"
```

---

## Task 6: Knock bottom sheet

**Files:**
- Create: `src/components/portal/field-map/knock-sheet.tsx`

- [ ] **Step 1: Create the sheet**

```tsx
"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { KNOCKED_DISPOSITIONS, dispositionMeta } from "@/lib/canvassing";
import type { KnockDTO } from "@/server/modules/canvassing/queries";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HouseStormInfo } from "@/components/portal/storm/house-storm-info";
import { UserSearch, Move, UserPlus, Check, Trash2 } from "lucide-react";
import { usd } from "./dialogs";

export type KnockSheetProps = {
  knock: KnockDTO | null;
  ownerLookupEnabled: boolean;
  canManage: boolean;
  onClose: () => void;
  onDisposition: (k: KnockDTO, disposition: string) => Promise<void>;
  onOpenDetails: (k: KnockDTO) => void;
  onLookupOwner: (k: KnockDTO) => void;
  onConvert: (k: KnockDTO) => void;
  onMove: (k: KnockDTO) => void;
  onDelete: (k: KnockDTO) => void;
};

const isHouseDot = (k: KnockDTO) => k.id.startsWith("house:");

export function KnockSheet({
  knock,
  ownerLookupEnabled,
  canManage,
  onClose,
  onDisposition,
  onOpenDetails,
  onLookupOwner,
  onConvert,
  onMove,
  onDelete,
}: KnockSheetProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [saving, setSaving] = React.useState<string | null>(null);

  // Collapse back to peek height whenever a different house is opened.
  React.useEffect(() => {
    if (knock) setExpanded(false);
  }, [knock?.id]);

  if (!knock) return null;
  const k = knock;

  async function pick(disposition: string) {
    setSaving(disposition);
    try {
      await onDisposition(k, disposition);
      onClose();
    } catch {
      toast.error("Couldn't save that knock.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="text-base font-semibold">{k.address ?? "House"}</SheetTitle>
        </SheetHeader>

        <div className="text-xs text-muted-foreground">
          {k.propertyValue != null ? `~${usd(k.propertyValue)} est.` : "Tap More for a value estimate"}
          {k.contactName ? ` · 👤 ${k.contactName}` : ""}
          {canManage && k.repName ? ` · knocked by ${k.repName}` : ""}
        </div>

        {/* The whole point of the redesign: one tap logs the knock. */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {KNOCKED_DISPOSITIONS.map((d) => {
            const active = k.disposition === d.value;
            return (
              <button
                key={d.value}
                type="button"
                disabled={saving !== null}
                onClick={() => void pick(d.value)}
                aria-pressed={active}
                className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 text-xs font-semibold leading-tight transition-transform active:scale-95 disabled:opacity-50"
                style={{
                  borderColor: d.color,
                  background: active ? d.color : "transparent",
                  color: active ? "#fff" : undefined,
                }}
              >
                <span aria-hidden className="text-base">{d.glyph}</span>
                {d.label}
              </button>
            );
          })}
        </div>

        {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 w-full py-2 text-xs font-medium text-muted-foreground"
          >
            ⌃ More — owner, value, notes, appointment
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 border-t border-border pt-3"
          >
            <HouseStormInfo lat={k.lat} lng={k.lng} />
            {!k.contactName && ownerLookupEnabled && k.address && (
              <button
                onClick={() => onLookupOwner(k)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gold"
              >
                <UserSearch className="size-4" /> Look up owner
              </button>
            )}
            {k.notes && <p className="text-sm text-muted-foreground">{k.notes}</p>}
            <div className="flex flex-wrap items-center gap-3">
              {k.leadId ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gold">
                  <Check className="size-4" /> Appointment created
                </span>
              ) : (
                <button
                  onClick={() => onConvert(k)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-gold"
                >
                  <UserPlus className="size-4" /> Convert to appointment
                </button>
              )}
              <button
                onClick={() => onOpenDetails(k)}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Details
              </button>
              <button
                onClick={() => onMove(k)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Move className="size-4" /> Move pin
              </button>
              {!isHouseDot(k) && (
                <button
                  onClick={() => onDelete(k)}
                  aria-label="Delete pin"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

Note: the "Details" button label is kept verbatim because `e2e/canvassing.spec.ts:39` and `:111` locate it by that exact name.

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/portal/field-map/knock-sheet.tsx
git commit -m "feat(field-map): two-tap knock bottom sheet"
```

---

## Task 7: Deal sheet, layers panel, filters sheet

**Files:**
- Create: `src/components/portal/field-map/deal-sheet.tsx`
- Create: `src/components/portal/field-map/layers-panel.tsx`
- Create: `src/components/portal/field-map/filters-sheet.tsx`

- [ ] **Step 1: Create `deal-sheet.tsx`**

Export a component named `DealSheet`. Same `Sheet side="bottom"` shell as Task 6. Renders the fields from the old `renderDealPopup` (`canvassing-client.tsx:596-640`): name, stage badge coloured by `d.stageColor`, address, rep, `usd(d.value)`, `appointmentAt`, phone, note, `<HouseStormInfo lat={d.lat} lng={d.lng} />`, an "Open deal" button routing to `/portal/leads/${d.id}`, and a "Move pin" button calling `onMove(d)`.

Props:

```ts
export type DealSheetProps = {
  deal: DealDTO | null;
  onClose: () => void;
  onMove: (d: DealDTO) => void;
};
```

- [ ] **Step 2: Create `layers-panel.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";
import { MAX_SCORE, type FieldMapFilters } from "@/lib/field-map-filters";

export type LayersPanelProps = {
  filters: FieldMapFilters;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  /** Managers additionally get ZIP codes, Reports and Warnings. */
  canManage: boolean;
};

type Toggle = { key: keyof FieldMapFilters; label: string; managerOnly?: boolean };

const TOGGLES: Toggle[] = [
  { key: "showRadar", label: "Hail" },
  { key: "showHeat", label: "Heat" },
  { key: "showZips", label: "ZIP codes", managerOnly: true },
  { key: "showStormReports", label: "Reports", managerOnly: true },
  { key: "showStormWarnings", label: "Warnings", managerOnly: true },
];

export function LayersPanel({ filters, set, canManage }: LayersPanelProps) {
  return (
    <div className="space-y-3">
      <div className="inline-flex w-full overflow-hidden rounded-lg border border-border">
        {(["satellite", "street"] as const).map((b) => (
          <button
            key={b}
            onClick={() => set("basemap", b)}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium capitalize transition-colors",
              filters.basemap === b ? "bg-foreground text-background" : "hover:bg-muted"
            )}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TOGGLES.filter((t) => canManage || !t.managerOnly).map((t) => {
          const on = filters[t.key] as boolean;
          return (
            <button
              key={t.key}
              onClick={() => set(t.key, !on as FieldMapFilters[typeof t.key])}
              aria-pressed={on}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {filters.showHeat && (
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Score ≥</span>
          <input
            type="range"
            min={0}
            max={MAX_SCORE}
            step={10}
            value={filters.minScore}
            onChange={(e) => set("minScore", Number(e.target.value))}
            className="flex-1 accent-[#F4631E]"
          />
          <span className="w-6 tabular-nums font-medium">{filters.minScore}</span>
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `layers-sheet.tsx`**

The rep's `≡` button needs somewhere to put `LayersPanel`. Managers get it inside the rail instead, so this file is rep-only.

```tsx
"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LayersPanel } from "./layers-panel";
import type { FieldMapFilters } from "@/lib/field-map-filters";

export type LayersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FieldMapFilters;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
};

export function LayersSheet({ open, onOpenChange, filters, set }: LayersSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="text-base font-semibold">Layers</SheetTitle>
        </SheetHeader>
        {/* canManage={false}: ZIP codes, Reports and Warnings are manager tools. */}
        <LayersPanel filters={filters} set={set} canManage={false} />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Create `filters-sheet.tsx`**

A `Sheet side="bottom"` containing, in order:

1. `<DateRangeFilter>` from `../canvassing-filters`, wired to `filters.datePreset` / `filters.dateFrom` / `filters.dateTo` via `set`.
2. A "Remaining only" toggle button (`set("remainingOnly", !filters.remainingOnly)`), label kept verbatim — `e2e/canvassing.spec.ts:76` matches it.
3. A "Deals" toggle button (`set("showDeals", !filters.showDeals)`).
4. The `DISPOSITIONS` chip row lifted from `canvassing-client.tsx:847-872`, unchanged: each chip keeps its `d.label` text, its coloured dot, its `statsByDisp[d.value] ?? 0` count, and is `disabled` when `filters.remainingOnly`. The e2e suite matches these by accessible name (`/Sold/`, `/Not Knocked/`).
5. When `canManage && reps.length > 0`, the rep `<select>` from `canvassing-client.tsx:874-885` with its "All reps" option, wired to `set("repId", ...)`.
6. A "Reset filters" button calling `reset()`, shown only when `activeCount > 0`.

Props:

```ts
export type FiltersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FieldMapFilters;
  activeCount: number;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  toggleDisposition: (value: string) => void;
  reset: () => void;
  statsByDisp: Record<string, number>;
  reps: { id: string; name: string }[];
  canManage: boolean;
};
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/portal/field-map/deal-sheet.tsx src/components/portal/field-map/layers-panel.tsx src/components/portal/field-map/layers-sheet.tsx src/components/portal/field-map/filters-sheet.tsx
git commit -m "feat(field-map): deal sheet, layers panel/sheet, filters sheet"
```

---

## Task 8: Manager rail and map overlays

**Files:**
- Create: `src/components/portal/field-map/manager-rail.tsx`
- Create: `src/components/portal/field-map/map-overlays.tsx`

- [ ] **Step 1: Create `map-overlays.tsx`**

Four small floating components, all absolutely positioned inside the map container, all at `z-[1000]` (Leaflet panes sit below 1000):

```tsx
"use client";

import { Loader2, Crosshair, X, Move, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingPill({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[1000] inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow">
      <Loader2 className="size-3.5 animate-spin" /> {label}
    </div>
  );
}

export function TopBar({
  children,
  onLocate,
  className,
}: {
  children: React.ReactNode;
  onLocate: () => void;
  className?: string;
}) {
  return (
    <div className={cn("absolute inset-x-3 top-3 z-[1000] flex items-center gap-2", className)}>
      <div className="flex-1">{children}</div>
      <button
        onClick={onLocate}
        aria-label="Locate me"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-background/95 shadow ring-1 ring-border backdrop-blur"
      >
        <Crosshair className="size-4" />
      </button>
    </div>
  );
}

export function StatusBar({
  today,
  remaining,
  activeCount,
  onOpenFilters,
}: {
  today: number;
  remaining: number;
  activeCount: number;
  onOpenFilters: () => void;
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-[1000] flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 shadow ring-1 ring-border backdrop-blur">
      <span className="text-sm font-medium tabular-nums">
        {today} today · {remaining} left
      </span>
      <button
        onClick={onOpenFilters}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <SlidersHorizontal className="size-4" /> Filters
        {activeCount > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold text-white tabular-nums">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  );
}

export function MovingBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="absolute bottom-20 left-1/2 z-[1000] inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-gold px-3 py-1.5 text-xs font-medium text-white shadow">
      <Move className="size-3.5" /> Drag the pin onto the right house, then drop it.
      <button onClick={onCancel} className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5">
        <X className="size-3" /> Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `manager-rail.tsx`**

A `w-80` panel absolutely positioned at `left-0 top-0 bottom-0 z-[1000]`, `overflow-y-auto`, collapsible to a 44px strip with a chevron button. Persist the open/closed boolean under `localStorage` key `field-map-rail`, read inside a `useEffect` so SSR and the first client render agree.

Four `<details>`-style sections, all closed by default except Filters:

| Section | Contents |
|---|---|
| Layers | `<LayersPanel canManage />` |
| Filters | Same controls as `filters-sheet.tsx` (date, dispositions, rep select, remaining, deals) |
| Territories | "Draw territory" button calling `onStartDraw`; then `territories.map(...)` rendering name, colour dot, `{t.knocked}/{t.total}` and a progress bar, plus the rep checkbox list, "Re-sync house pins" and "Delete territory" actions lifted from `renderTerritoryPopup` (`canvassing-client.tsx:642-696`) |
| Storm | Links that switch the shell's tab to storm leads / address checker / storm zones |

Keep the button label **"Draw territory"** verbatim — `e2e/canvassing.spec.ts:65`, `:82` and `:159` match it.

Props:

```ts
export type ManagerRailProps = {
  filters: FieldMapFilters;
  activeCount: number;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  toggleDisposition: (value: string) => void;
  reset: () => void;
  statsByDisp: Record<string, number>;
  reps: { id: string; name: string }[];
  territories: TerritoryDTO[];
  drawing: boolean;
  drawPointCount: number;
  onStartDraw: () => void;
  onFinishDraw: () => void;
  onCancelDraw: () => void;
  onGeneratePins: (territoryId: string) => void;
  onDeleteTerritory: (t: TerritoryDTO) => void;
  onSetTerritoryReps: (t: TerritoryDTO, repIds: string[]) => void;
  onOpenStormTab: (tab: "storm-leads" | "storm-checker" | "storm-zones") => void;
};
```

While drawing, the Territories section swaps the Draw button for **"Finish ({drawPointCount})"** and **"Cancel"** — labels kept verbatim for `e2e/canvassing.spec.ts:164`.

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/field-map/manager-rail.tsx src/components/portal/field-map/map-overlays.tsx
git commit -m "feat(field-map): manager rail and floating map overlays"
```

---

## Task 9: The shell — wire it all together

**Files:**
- Create: `src/components/portal/field-map/field-map.tsx`
- Delete: `src/components/portal/canvassing-client.tsx`
- Modify: `src/components/portal/canvassing-shell.tsx`

- [ ] **Step 1: Create `field-map.tsx`**

Composes everything. Structure:

```tsx
"use client";

import "leaflet/dist/leaflet.css";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Map as LeafletMap } from "leaflet";
import { Loader2 } from "lucide-react";
import type { LatLng } from "@/lib/canvassing";
import type { KnockDTO, DealDTO, TerritoryDTO } from "@/server/modules/canvassing/queries";
import type { Viewport } from "../canvassing-map";
import { FieldMapLegend } from "@/components/portal/storm/field-map-legend";
import { useMapFilters } from "./use-map-filters";
import { useFieldMapData, MIN_PIN_ZOOM } from "./use-field-map-data";
import { KnockSheet } from "./knock-sheet";
import { DealSheet } from "./deal-sheet";
import { FiltersSheet } from "./filters-sheet";
import { LayersSheet } from "./layers-sheet";
import { ManagerRail } from "./manager-rail";
import { LoadingPill, TopBar, StatusBar, MovingBanner } from "./map-overlays";
import { AddressSearch, TerritoryDialog, ConvertDialog, KnockDetailDialog } from "./dialogs";
import { /* server actions, same list as canvassing-client.tsx:26-41 */ } from "@/server/modules/canvassing/actions";

const CanvassingMap = dynamic(() => import("../canvassing-map").then((m) => m.CanvassingMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 size-5 animate-spin" /> Loading map…
    </div>
  ),
});

export type StormTab = "storm-leads" | "storm-checker" | "storm-zones";

export function FieldMap({ onOpenStormTab }: { onOpenStormTab: (tab: StormTab) => void }) {
  const { filters, activeCount, set, toggleDisposition, reset } = useMapFilters();
  const [viewport, setViewport] = React.useState<Viewport | null>(null);
  const data = useFieldMapData(filters, viewport);
  // ... local UI state, actions, render
}
```

Requirements for this file:

- **Layout.** Root element is `<div className="relative -m-4 h-[calc(100dvh-4rem)] overflow-hidden sm:-m-6 lg:-m-8">` — the negative margins cancel `<main className="p-4 sm:p-6 lg:p-8">` (`portal-shell.tsx:188`) and `4rem` is the `h-16` header. The map fills it with `h-full w-full`.
- **Local state carried over from `canvassing-client.tsx`:** `mode`, `drawPoints`, `generating`, `searchPin`, `searchTarget`, `movingId`, `pendingTerritory`, `pendingTerritoryName`, `convertTarget`, `detailId`. Add `sheetKnock: KnockDTO | null`, `sheetDeal: DealDTO | null`, `filtersOpen: boolean`, `layersOpen: boolean`.
- **Move these functions across unchanged** from `canvassing-client.tsx`: `handleMapReady` (must stay a `useCallback` — `:120-124`), `onMapClick`, `locate`, `goToAddress`, `handleMovePin`, `startMoveKnock`, `startMoveDeal`, `finishDrawing`, `cancelDrawing`, `generatePins`, `isHouseDot`, `ensureHouse`, `openDetails`, `lookupOwnerForKnock`, `startConvert`, `changeDisposition`, `removeKnock`, `setTerritoryReps`, `removeTerritory`, `onZipClick`, and the search-snap `useEffect` (`:328-339`).
- **`changeDisposition` must still call `ensureHouse` first** for synthetic `house:` dots. This is the two-tap path — getting it wrong silently drops every knock on an auto-loaded house.
- **`minScore` filtering** moves here (from `canvassing-client.tsx:321-323`):

```tsx
  const mapKnocks = filters.minScore > 0
    ? data.knocks.filter((k) => (data.knockScores[k.id] ?? -1) >= filters.minScore)
    : data.knocks;
  const visibleDeals = filters.showDeals ? data.deals : [];
  const mapDeals = filters.minScore > 0
    ? visibleDeals.filter((d) => (data.dealScores[d.id] ?? -1) >= filters.minScore)
    : visibleDeals;
```

- **`center`** and **`highlightTerritoryIds`** memos move across unchanged (`:349-360`).
- **Role branch.** `data.canManage ? <ManagerRail … /> : (<><StatusBar … /><FiltersSheet … /><LayersSheet … /></>)`. The `<TopBar>` with `<AddressSearch onSelect={goToAddress} />` renders for both; its `≡` button sets `layersOpen` for reps and toggles the rail for managers.
- **Wire the map:** `onKnockClick={setSheetKnock}` and `onDealClick={setSheetDeal}`. Pass `knockScores`/`dealScores` only when `filters.showHeat`, matching `canvassing-client.tsx:940-941`.
- Render `<FieldMapLegend showHail={filters.showRadar || filters.showStormReports} showHeat={filters.showHeat} />`, `<LoadingPill>` when `data.loading`, `<MovingBanner>` when `movingId`, and the four dialogs at the end.

- [ ] **Step 2: Delete the old client and update the shell**

```bash
git rm src/components/portal/canvassing-client.tsx
```

In `canvassing-shell.tsx`, replace the `CanvassingClient` import with `FieldMap` from `./field-map/field-map`, and pass `onOpenStormTab={setTab}` (see Task 10 for the controlled tab state).

- [ ] **Step 3: Verify it compiles and builds**

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: all clean. `grep -rn "canvassing-client" src/` must return nothing.

- [ ] **Step 4: Look at it in a browser**

```bash
npm run dev
```

Open `http://localhost:3000/portal/canvassing`. Confirm by eye: no toolbars above the map; the map fills the viewport; tapping a house dot opens the bottom sheet; one tap on a disposition closes it and recolours the dot.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/portal/field-map src/components/portal/canvassing-shell.tsx
git commit -m "feat(field-map): full-bleed map-first shell, replacing canvassing-client"
```

---

## Task 10: Tabs collapse to three

**Files:**
- Modify: `src/components/portal/canvassing-shell.tsx`
- Create: `src/components/portal/canvassing-insights.tsx`

- [ ] **Step 1: Create `canvassing-insights.tsx`**

```tsx
"use client";

import { CanvassingDashboard } from "./canvassing-dashboard";
import { CanvassingLeaderboard } from "./canvassing-leaderboard";

export function CanvassingInsights() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Leaderboard</h2>
        <CanvassingLeaderboard />
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Activity</h2>
        <CanvassingDashboard />
      </section>
    </div>
  );
}
```

Leaderboard sits first: it is the section reps actually open.

- [ ] **Step 2: Rewrite the shell**

Make `Tabs` controlled so the manager rail's Storm links can switch tabs. Tab list becomes **Map · List · Insights**, plus the three storm tabs — rendered but visually hidden from the list (`className="hidden"` on those `TabsTrigger`s), reachable only from the rail. Keep `canStorm` gating them.

Header/tab chrome must not push the map down: wrap the page heading and `TabsList` in a `<div className="space-y-4">` that renders **only when `tab !== "map"`**, and give the map tab the bare `<FieldMap>`.

The map view gets a floating switcher instead, rendered inside `FieldMap`'s root so it sits over the map. Add it to `map-overlays.tsx`:

```tsx
export function ViewSwitcher({
  tab,
  onChange,
}: {
  tab: string;
  onChange: (t: "map" | "list" | "insights") => void;
}) {
  return (
    <div className="absolute left-1/2 top-16 z-[1000] inline-flex -translate-x-1/2 overflow-hidden rounded-full bg-background/95 shadow ring-1 ring-border backdrop-blur">
      {(["map", "list", "insights"] as const).map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn(
            "px-4 py-1.5 text-xs font-semibold capitalize transition-colors",
            tab === t ? "bg-foreground text-background" : "hover:bg-muted"
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
```

`FieldMap` takes `tab` and `onChangeTab` props alongside `onOpenStormTab` and renders `<ViewSwitcher>` from them.

`TabsContent value="map"` keeps `forceMount className="data-[state=inactive]:hidden"` — removing it reintroduces the `_leaflet_pos` crash (`canvassing-shell.tsx:48`).

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/portal/canvassing-shell.tsx src/components/portal/canvassing-insights.tsx
git commit -m "feat(field-map): collapse seven tabs into Map, List, Insights"
```

---

## Task 11: Tests

**Files:**
- Create: `e2e/field-map-mobile.spec.ts`
- Modify: `e2e/canvassing.spec.ts`

- [ ] **Step 1: Write the mobile spec**

Create `e2e/field-map-mobile.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

// The redesign targets a rep on a phone, so these run at phone size with touch.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function settledMap(page: Page) {
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });
  await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 20000 });
  const loader = page.getByText(/Loading (houses|pins)…/);
  for (let t = 0; t < 30; t++) {
    if (!(await loader.isVisible().catch(() => false))) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000);
}

test("field map: rep logs a knock in two taps", async ({ page }) => {
  test.setTimeout(120000);
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await settledMap(page);

  // Tap 1 — a house dot opens the bottom sheet.
  const pins = page.locator(".anexa-knock-pin");
  await expect(pins.first()).toBeVisible({ timeout: 10000 });
  let opened = false;
  const n = await pins.count();
  for (let i = 0; i < n; i++) {
    const bb = await pins.nth(i).boundingBox().catch(() => null);
    if (!bb) continue;
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForTimeout(300);
    if (await page.getByRole("button", { name: "Not Home" }).isVisible().catch(() => false)) {
      opened = true;
      break;
    }
  }
  expect(opened).toBe(true);

  // Tap 2 — one disposition button logs it and the sheet closes.
  await page.getByRole("button", { name: "Not Home" }).click();
  await expect(page.getByText("Knock updated")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Not Home" })).toBeHidden({ timeout: 10000 });
});

test("field map: the map is not pushed below the fold", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible({ timeout: 10000 });
  const box = (await map.boundingBox())!;
  // The map starts near the top of the viewport and owns most of the screen.
  expect(box.y).toBeLessThan(120);
  expect(box.height).toBeGreaterThan(500);
});

test("field map: filters survive a reload via the URL", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("button", { name: /Remaining only/ }).click();
  await expect(page).toHaveURL(/remaining=1/, { timeout: 10000 });

  await page.reload();
  await expect(page).toHaveURL(/remaining=1/);
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("button", { name: /Remaining only/ })).toHaveAttribute("aria-pressed", "true");
});

test("field map: reps do not get manager tooling", async ({ page }) => {
  await login(page, "rep@anexahomes.com");
  await page.goto("/portal/canvassing?houses=off");
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Draw territory/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ZIP codes/ })).toHaveCount(0);
});
```

For the third test to pass, the "Remaining only" control in `filters-sheet.tsx` must carry `aria-pressed={filters.remainingOnly}`. Add it if Task 7 left it off.

- [ ] **Step 2: Run the mobile spec**

```bash
npx playwright test e2e/field-map-mobile.spec.ts --reporter=line
```

Expected: 4 passed. If the two-tap test fails at "tap 1", check that Task 5's `click` handler survived and that `pointer-events` on the floating overlays is not covering the map (only `LoadingPill` sets `pointer-events-none`; the others are meant to be clickable but must not span the full map area).

- [ ] **Step 3: Retarget the existing spec**

`e2e/canvassing.spec.ts` targets controls this redesign moves. Apply these edits:

| Line | Now | Change to |
|---|---|---|
| `:61` | `heading "Canvassing"` | Delete the assertion — the map view no longer renders a page heading. (This assertion is already failing on baseline; the heading has said "Field Map" since the storm fusion.) |
| `:63` | `button /Sold/` contains "1" | Open filters first: `await page.getByRole("button", { name: /Filters/ }).click();` then assert. |
| `:72` | `button /Not Knocked/` contains "4" | Same — open the Filters sheet first. |
| `:73-74` | `getByText("Houses")` / `getByText("Knocked")` pill lookups | Replace with the status bar: `await expect(page.getByText(/\d+ today · \d+ left/)).toBeVisible();` |
| `:76` | `button "Remaining only"` visible | Open the Filters sheet first. |
| `:84` | `combobox` with "All reps" | Manager only, now in the rail — assert after the rail's Filters section is expanded. |
| `:159`, `:164` | `Draw territory` / `Finish (3)` | Expand the rail's Territories section first, then click. |
| `:175` | `tab "Leaderboard"` | `tab "Insights"`. |

Leave `openADotDetail` (`:18-56`) alone apart from the click target: after the sheet opens, `Details` is now inside the expanded section, so insert `await page.getByRole("button", { name: /More —/ }).click();` before clicking `Details`.

- [ ] **Step 4: Run the full canvassing suite**

```bash
npx playwright test e2e/canvassing.spec.ts e2e/field-map-mobile.spec.ts --reporter=line
```

Expected: all pass. Note that eight Playwright specs elsewhere in the suite already fail on this baseline — do not attribute those to this work, and do not "fix" them here.

- [ ] **Step 5: Commit**

```bash
git add e2e/field-map-mobile.spec.ts e2e/canvassing.spec.ts
git commit -m "test(field-map): mobile two-tap knock spec; retarget moved selectors"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run everything**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: four clean runs.

- [ ] **Step 2: Confirm the old file is gone and unreferenced**

```bash
grep -rn "canvassing-client" src/ e2e/ ; echo "exit=$?"
```

Expected: no matches (`exit=1`).

- [ ] **Step 3: Check the file sizes came down**

```bash
wc -l src/components/portal/field-map/*.tsx src/components/portal/field-map/*.ts
```

Expected: no file over ~400 lines. If `field-map.tsx` is well past 200, the action handlers should move into a `use-knock-actions.ts` hook.

- [ ] **Step 4: Verify on a real phone viewport**

With `npm run dev` running, open Chrome DevTools device emulation at iPhone 14 (390×844) on `/portal/canvassing`. Check specifically:

- The bottom sheet's disposition buttons sit above the home-bar inset (`env(safe-area-inset-bottom)` is applied in Task 6).
- Scrolling the page does not reveal whitespace under the map — `100dvh` behaves against the collapsing Safari URL bar.
- The status bar does not sit under the sheet when the sheet is open.

- [ ] **Step 5: Commit any fixes and push**

```bash
git add -A && git commit -m "fix(field-map): mobile viewport polish"
git push origin HEAD
```

---

## Notes for the implementer

- The branch is `feat/multi-vertical`. Another session may be committing with `git add -A` on this same branch — a clean `git status` can mean your work landed in someone else's commit. Check `git log` before assuming something was lost.
- No schema changes and no new dependencies. If you find yourself reaching for `vaul` or `@testing-library/react`, stop — `sheet.tsx` and Playwright cover both needs.
- Every feature in the old UI must still exist somewhere. Before Task 12, re-read the spec's control inventory and point at where each one now lives.
