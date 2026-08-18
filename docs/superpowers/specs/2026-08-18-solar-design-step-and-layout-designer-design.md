# Solar system-design step: strip it to the bill, and draw the array

**Date:** 2026-08-18
**Status:** approved

## The problem

Step 1 of the solar proposal builder asks a rep for fourteen things. Most of them
are not decisions a rep makes, and several are not decisions anybody makes at
proposal time:

- **Utility account #, meter #** — stored, never shown to a customer, never used
  in a calculation. Interconnection paperwork that landed on a sales form.
- **Rate plan / tariff** — printed on the proposal, used in no maths. The
  customer's rate is derived from bill ÷ usage (`deriveUtilityRateMills`).
- **Net-metering programme** — set by the utility, identical for every house on
  that utility. Typed per deal.
- **TSRF %** — a shading figure that real design tools compute from a 3D model.
  Here it is typed from memory, and it multiplies straight into the customer's
  quoted kWh (`year1Production`, `solar-money.ts:66`). 85 vs 100 is a 17%
  difference in what the homeowner is promised.
- **Module, inverter, battery** — equipment is committed when the job is built,
  not when it is sold. The proposal lists hardware nobody has ordered.
- **Module quantity** — typed. It is the output of drawing an array on a roof,
  not an input to it.

What is left, and what actually drives every number on the proposal, is: annual
usage, the monthly bill, and how many panels fit on the roof.

The layout itself is an upload from an external tool today, and usually missing —
which is why the builder currently warns "No layout attached. The proposal will
not show the customer where the panels go."

## What we are building

The step becomes: **enter the bill, draw the array, read the numbers.**

```
UTILITY & USAGE
  Utility provider          Annual usage (kWh)
  Average monthly bill ($)

SITE
  Mount type  [Roof ▾]

PANEL LAYOUT
  ┌──────────────────────────────────────┐
  │  satellite view of this deal's roof  │
  │  with the array drawn on it          │
  └──────────────────────────────────────┘
  24 panels · 9.60 kW-DC · 13,900 kWh/yr · 99% offset
```

Nothing else.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where panel wattage comes from | The company's **default module** in the catalogue (`SolarEquipment.isDefault`, already exists) | Sizing needs watts. The AVL turns over once a year; a rep should not restate it per deal. |
| Layout tool scope (v1) | **Array blocks with per-panel edits** | A 24-panel roof is one drag, not 24 placements, and knocking out a chimney is one click. |
| TSRF | **Removed** from form and maths | A typed guess that moves the customer's kWh by up to 17%. Company-wide `derateFactor` in Solar Settings carries system losses. |
| Utility account # / meter # | Move to the deal's **Operations card** | They are needed after the sale, for interconnection. |
| Net-metering programme | Move to **Solar Settings**, company-wide | Set by the utility, not the house. |
| Rate plan / tariff | **Deleted**, form and proposal | Used by nothing. |
| Inverter / battery | Move to the deal's **Operations card**, set at build time | The customer proposal stops promising hardware nobody has committed to. |

### Two consequences agreed explicitly

1. **No layout means no quote.** Module count has no other source once the field
   is read-only, so `layout.missing` is promoted from a warning to a **blocking**
   validation issue, with an action link to the designer.
2. **Quoted production rises** for any deal whose TSRF was below 100. Before this
   ships to production, compare one installed system's actual annual output
   against its proposal; if `kwhPerKwYear` (default 1450) was tuned with TSRF in
   the mix, it must come down to compensate. This is a settings change, not a
   code change, and it is the responsibility of whoever ships Phase 1.

## Phase 1 — strip the form, rehome the fields

### 1.1 `SolarDesignPanel` (`src/components/portal/solar-panels.tsx`)

Remove the inputs for `ratePlan`, `utilityAccountNo`, `meterNo`,
`netMeteringProgram`, `tsrfPct`, `moduleId`, `inverterId` and `batteryId`. Keep
`utilityProvider`, `annualUsageKwh`, `avgMonthlyBill`, `mountType`, the derived
strip, and `PanelLayoutPanel`.

`moduleQty` stays an editable field in Phase 1 — with no designer yet it is still
the only source of a panel count. Phase 2 replaces it with read-only text inside
the layout section: "24 panels".

The `EquipmentOption[]` props (`modules`, `inverters`, `batteries`) drop off
`SolarDesignPanel` and `SolarProposalBuilder`, and the page stops querying them.

### 1.2 `saveSolarDesignAction` (`src/server/modules/solar/actions.ts`)

The action no longer accepts `ratePlan`, `utilityAccountNo`, `meterNo`,
`netMeteringProgram`, `tsrfPct`, `moduleId`, `inverterId`, `batteryId` or
`moduleQty` from this caller. Sizing resolves the module server-side:

```ts
// The catalogue's default panel is the sizing basis. A rep does not choose
// hardware on a sales call; the AVL does, once a year.
const defaultModule = await prisma.solarEquipment.findFirst({
  where: { companyId, kind: "module", isActive: true, isDefault: true },
  select: { id: true, ratingW: true },
});
```

- `moduleId` is set to the default module's id, so the proposal snapshot and the
  spec table keep working unchanged.
- If a design already has a `moduleId`, it is **kept** — a design saved against
  last year's panel keeps its own basis rather than silently re-pricing when the
  AVL turns over. The default only fills a design that has none.
- `moduleQty` is still accepted in Phase 1, and stops being accepted in Phase 2
  when `saveSolarLayoutAction` becomes its only writer.
- `year1Production(size, assumptions, null)` — TSRF is no longer passed. The
  column stays on the table (existing rows keep their history) and stops being
  read.

`resolveEquipment` stays: `saveSolarLayoutAction` and the ops-card action still
need it, and it is the only thing stopping a retired product being attached.

### 1.3 Validation (`src/lib/solar-validation.ts`)

- `equipment.no_module` message becomes: "No default solar panel is set in the
  catalogue, so a system cannot be sized." Action link → Settings → Solar
  equipment.
- `equipment.module_qty_zero` keeps its wording in Phase 1. In Phase 2 it becomes
  "No panels have been placed on the roof", linking to the designer.
- `design.tsrf_missing`, `design.tsrf_shaded`, `design.tsrf_out_of_range` are
  deleted, along with `TSRF_MIN_PCT` / `TSRF_WARN_PCT` / `TSRF_MAX_PCT` and the
  `tsrfPct` field on `DesignForValidation`.
- `utility.rate_plan_missing` is deleted.

### 1.4 Schema (one migration)

```prisma
model SolarSettings {
  /// Net-metering / buyback programme, e.g. "Oncor 1:1 net metering". Set by
  /// the utility and identical for every house on it, so it belongs to the
  /// company, not to a deal. Printed on every proposal; the FAQ answer about
  /// surplus production points at it.
  netMeteringProgram String?
}

model SolarEquipment {
  /// Modules only: physical size in mm, so a panel can be drawn on a roof at
  /// true scale. Defaults are a standard 60-cell residential module.
  widthMm  Int? // 1134
  heightMm Int? // 1762
}

model SolarDesign {
  /// The array as drawn: see `src/lib/solar-layout.ts` for the shape.
  layoutBlocks Json @default("[]")
}
```

Backfill in the same migration: copy each company's most common non-null
`solar_designs.net_metering_program` into `solar_settings.net_metering_program`
where that is currently null, so no company loses the value it had.

No columns are dropped. `ratePlan`, `tsrfPct`, `utilityAccountNo`, `meterNo` and
`netMeteringProgram` stay on `SolarDesign` as history for proposals already sent.

### 1.5 Operations card (`src/components/portal/solar-ops-card.tsx`)

A new "Interconnection & equipment" block, visible with the same `canEdit` rule
the card already uses: utility account #, meter #, inverter picker, battery
picker. Saved by a new `saveSolarBuildDetailsAction` that writes the same
`SolarDesign` columns and runs `resolveEquipment` on the two selectors.

Inverter and battery changes do **not** touch `systemSizeKwDc` — only the module
sizes the system — so an ops edit cannot move a customer's quoted numbers.

### 1.6 Settings and the customer proposal

- Solar Settings form gains "Net-metering programme".
- `proposal-actions.ts` snapshot: `netMeteringProgram` reads from settings, not
  the design. `ratePlan` is dropped from the snapshot type.
- `solar-proposal-view.tsx`: the "Rate plan" row goes; the "Solar resource
  (TSRF)" row and the TSRF clause in the assumptions paragraph go; the equipment
  table renders panels only, since inverter and battery are unset at send time.
  Existing sent proposals render from their frozen snapshot and are unaffected —
  the view must keep tolerating the fields being present.

## Phase 2 — the panel layout designer

### 2.1 Where it lives

Full-width panel inside step 1, replacing the upload-only `PanelLayoutPanel`.
Upload stays available as a fallback for a layout drawn elsewhere.

### 2.2 Imagery

`/api/property/satellite?leadId=…&zoom=21`, which already proxies Google Static
Maps server-side with the API key never reaching the browser, centred on the
lead's ROOFTOP-accurate coordinate.

- Requested at zoom 21, scale 2 (1280 px). Max zoom varies by area and Google
  answers an unavailable zoom with a grey tile and HTTP 200, so the designer
  offers a 20/21 toggle rather than assuming.
- Same-origin, so drawing it into a `<canvas>` does not taint it — which is what
  makes "Save renders the drawing" possible without a server-side compositor.

### 2.3 Geometry (`src/lib/solar-layout.ts`, pure and unit-tested)

```ts
/** Web Mercator ground resolution. The whole tool's accuracy rests here. */
metresPerPixel(lat: number, zoom: number, scale: 1 | 2): number
```

Panel positions are stored in **metres east/north of the lead's coordinate**, not
pixels — the memory of dots landing on the wrong corner is exactly this: a
pixel-space layout re-opened at a different zoom is a layout in the wrong place.

```ts
type LayoutBlock = {
  id: string;
  /** Block's top-left corner, metres east/north of the lead's lat/lng. */
  originE: number;
  originN: number;
  rotationDeg: number;      // clockwise from north, to match the ridge
  cols: number;
  rows: number;
  orientation: "portrait" | "landscape";
  /** Grid indices the user knocked out — chimneys, vents, setbacks. */
  omitted: number[];
};

panelCount(blocks: LayoutBlock[]): number
panelRects(block, moduleMm, metresPerPixel): Rect[]  // for both canvas and hit-testing
```

Module gap: 20 mm between panels in a block, a constant in this module.

### 2.4 Interactions

| Action | Behaviour |
|---|---|
| Drag on empty imagery | Rubber-band a rectangle; on release it becomes a block filled with as many whole panels as fit. |
| Drag a block's rotate handle | Rotates the whole block; snaps to 5° with a modifier to go free. |
| Drag a block's edge handle | Adds/removes whole rows or columns. |
| Click a panel | Omits it. Click the empty cell again to restore it. |
| Click a block, press Delete | Removes the block. |
| `P` | Toggles portrait/landscape for the selected block. |
| Scroll / pinch, drag background | Zoom and pan the view (CSS transform only, no re-fetch). |
| Cmd-Z | Undo, from a client-side stack. No autosave. |

The panel count and a live kW-DC estimate sit in the toolbar so the rep can size
against the bill while drawing.

### 2.5 Saving

One explicit Save, two steps:

1. `saveSolarLayoutAction(leadId, blocks)` — validates the blocks (≤ 40 blocks,
   ≤ 500 panels, finite coordinates), writes `layoutBlocks`, sets
   `moduleQty = panelCount(blocks)`, and recomputes size / production / offset
   through the same server-side path as `saveSolarDesignAction`. **The client
   never sends a panel count**; the server counts the geometry it was given.
2. The canvas is exported with `toBlob()` and posted through the existing
   `uploadPanelLayoutAction` with `designProvider = "Anexa Designer"`, so the
   proposal, the preliminary/final approval flag and the file plumbing all work
   unchanged.

If step 2 fails, step 1 still stands: the count is saved and the rep is told the
image did not attach. The reverse is not possible, because the count is what the
quote depends on.

### 2.6 Out of scope for v1

Per-face azimuth and tilt, shade or obstruction modelling, setback enforcement,
string design, 3D, DXF/PDF export, and any Google Solar API integration. Roof
faces are a later phase if per-face production is ever worth the survey time.

## Testing

**Unit** (`src/lib/__tests__/solar-layout.test.ts`)
- `metresPerPixel` against known values at zoom 20/21 and two latitudes.
- Grid fill: a rectangle of a known size yields the expected rows × cols, in both
  orientations, and never a partial panel.
- Rotation is rigid: panel count and spacing are unchanged by any rotation.
- `panelCount` excludes `omitted`, and ignores out-of-range indices.
- Round trip: blocks → metres → pixels at zoom 20 and 21 land in the same place.

**Integration** (`src/server/modules/solar/__tests__/`)
- `saveSolarLayoutAction` sets `moduleQty` from geometry and ignores any count in
  the payload.
- Size and production recompute from the default module's rating.
- A design with no `layoutBlocks` and no uploaded layout produces the blocking
  `layout.missing` issue and cannot generate a proposal.
- A design whose `moduleId` is already set keeps it when the catalogue default
  changes.
- Ops-card action writes account #, meter #, inverter, battery and leaves
  `systemSizeKwDc` untouched.

**E2E** (`e2e/`)
- Seeded solar deal → step 1 → drag a block → count and kW-DC appear → Save →
  reload shows the same array → proposal generates.
- Assert the removed fields are gone from step 1.

## Build order

Phase 1 ships alone: the form is smaller, the fields have homes, module quantity
stays typed for the days in between. Phase 2 makes it read-only and turns the
missing-layout warning into a blocker.

## Branch note

`feat/solar-equipment-retire-and-avl-year` has another session's uncommitted work
in `schema.prisma`, `solar-proposal/page.tsx`, `solar-equipment-manager.tsx` and
`solar/actions.ts` — most of the surface this touches. This work goes on its own
branch off that tree once those changes land, to avoid two sessions editing the
same four files.
