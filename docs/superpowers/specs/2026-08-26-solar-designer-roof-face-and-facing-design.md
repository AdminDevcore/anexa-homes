# Trace the roof, fill it, and point the panels — solar layout designer

Date: 2026-08-26

## The complaint

Three things, from a rep drawing 404 Shoreline Street:

1. Clicking a panel inside an array splits it out of the array.
2. Setting the facing is guesswork — there should be an arrow you move.
3. There should be a button that covers the roof in panels, and then you take
   off the ones the house does not need.

## Why the third one does not exist today

It does exist. `autoFillRoof` covers every plane Google has modelled and
`pruneToTarget` takes the worst-facing panels back off until the system just
clears the home's usage. The button is only rendered when `planes` is non-null,
and `planes` is null on every house, because the Solar API is switched off:

```
GET solar.googleapis.com/v1/buildingInsights:findClosest
403 PERMISSION_DENIED — "Solar API has not been used in project
1048785747692 before or it is disabled."
```

That is also why the amber banner in the screenshot says three arrays have no
facing. Nothing reads the roof, so nothing can answer.

**We are building for the API being off.** A traced roof face is the source of
truth instead. If the API is ever enabled, the plane-based path takes priority
again and this becomes the fallback for houses Google cannot model — which is
the better arrangement anyway, since rural addresses and new construction come
back empty even with the API on.

## What gets built

### 1. Roof face → Max Roof

A new **Roof face** tool. Click the corners of one roof plane; click the first
dot to close the shape. That is the same closing gesture `setbackVertexAt`
already implements for setbacks, reused so it is one thing to learn, not two.

On close, in one pass:

- **The eave is the traced edge whose midpoint is farthest from the house pin.**
  The pin is the ground origin `(0, 0)` and leads are geocoded to ROOFTOP, so it
  really is the middle of the building. On a gable face the ridge edge and the
  eave edge are the two long parallels and the outer one is the eave; on a hip
  triangle the single long edge is the eave. Both are the common case.
- `rotationDeg` = the eave edge's bearing, so panel rows run along the eave.
- `azimuthDeg` = the perpendicular to that edge pointing **away** from the pin.
  Of the two candidates 180° apart, take the one whose dot product with
  (edge midpoint − pin) is positive.
- The face fills with as many whole panels as fit. Both orientations are tried
  and four grid phases on each axis, exactly as `autoFillRoof` does — a grid
  shifted a third of a panel picks up a whole extra column, and it is worth
  about a panel a roof.
- A cell is kept only if its centre and all four corners (pulled in by
  `CORNER_INSET`, as the plane fill already does) are inside the traced polygon
  **shrunk by the edge setback**, default 0.914 m / 3 ft, editable per face.
- Traced setback bands are subtracted as well.

The result is one ordinary `LayoutBlock`. It drags, rotates, takes knocked-out
cells and gets deleted like any other. It is not a locked object.

**Max Roof** fills every traced face at once. **Trim to usage** is a separate
button — the fill is maximal until you ask for it, which is what was asked for:
max the roof, then remove what is not needed *as an option*. The existing
`− N panels +` stepper stays and re-fills at that count using `pruneToCount`.

Because the polygon is stored on the block, the stepper and Max Roof keep
working when the deal is reopened weeks later. No re-tracing.

### 2. The facing arrow

- Drawn on the selected array **always**, including when the facing is unset —
  grey and dashed at the off-the-rows bearing, labelled *facing not set*. Today
  `drawFacing` returns early when `azimuthDeg` is null, so there is nothing on
  screen to grab until you have already typed the number the arrow exists to
  save you typing.
- **Grab the head and swing it.** Snaps to 5°, and to the eight compass points
  when within 4° of one. Shift drags free. Double-click the head flips 180°.
- The head carries a live readout: `186° SSW · 97% of the site's best`.
- `[` and `]` nudge the facing 5° from the keyboard.
- The grip is added to `handlePositions` next to rotate and resize, so the
  painter and the hit test agree by construction. That is the rule the file
  already states: a grip drawn where the hit test does not look is a control
  that silently does nothing.

### 3. Panels stop falling out of arrays

Cause, exactly: `onPointerDown` under `tool === "movePanel"` calls
`detachPanel` before any movement has happened, and nothing ever puts the panel
back. A click is a permanent split.

- **Detach only after 4 px of travel.** A pointer-down on a panel records a
  pending detach — block id, cell index, start point. The first `pointermove`
  past the threshold performs the detach and hands the drag over. A pointer-up
  with no movement selects the array and changes nothing.
- **Re-absorb on release.** If the loose panel is dropped onto a free cell of
  its home array's lattice, it rejoins that array instead of leaving a 1×1
  behind. `sharesLattice` and `addPanelAtCell` already do the hard part.
- The same travel threshold guards the array-move drag, so a plain click no
  longer records a no-op undo step.

### 4. Three tools instead of six

Palette: **Roof face · Draw array · Setbacks**. Everything else is the default
pointer:

| gesture | does |
| --- | --- |
| click an array | select it |
| drag an array | move it |
| ⌘/Ctrl-drag a panel | slide that one panel out |
| ⌥/Alt-click a panel | knock it out |
| click bare roof beside a selected array | add a panel on its lattice |
| click empty space | deselect |

The last two do not collide. `cellDistance` already decides whether a click is
close enough to join an array; within two cells of the selected array it adds,
farther away it deselects. Adding only ever happens when something is selected.

A hint strip along the bottom names the modifiers, so nobody learns them from a
manual. `R` / `A` / `S` pick tools; Esc returns to the pointer.

## Data

**No migration.** A traced face rides inside the existing `layoutBlocks` JSON
column, on the block it produced:

```ts
type RoofFace = {
  /** A closed ring in ground metres, first point NOT repeated. */
  points: { e: number; n: number }[];
  /** How far in from the traced edge panels must stay, metres. */
  insetM: number;
};
```

`LayoutBlock` gains `face?: RoofFace | null`, parsed by `parseLayoutBlocks` and
accepted by the `saveSolarLayoutAction` zod schema. A block with no face is
every block that exists today and behaves exactly as it does now.

`facingSource` gains a third value, `"traced"`, alongside `"roof"` and
`"footprint"`. A facing inferred from a rep's trace is not a measurement of the
building and not the rep's own stated figure; it is a third kind of claim and
the badge says so — **from your trace**, distinct from the blue **from the
roof**. Typing over the number or swinging the arrow clears it to null, as
editing already does everywhere else in this file.

`applyFootprintFacing` only fills blocks whose azimuth is null, so a traced
facing is never overwritten by the OSM ridge.

## Modules

| file | change |
| --- | --- |
| `src/lib/solar-layout.ts` | `RoofFace` type, `face` on `LayoutBlock`, `"traced"` in `facingSource`, parsing for both |
| `src/lib/solar-face-fill.ts` | **new** — eave detection, polygon inset, point-in-polygon, the phase-search fill |
| `src/server/modules/solar/layout-actions.ts` | zod accepts `face` and `"traced"` |
| `src/components/portal/solar-layout-designer.tsx` | the tool, the arrow, the detach fix, the modeless pointer |

`solar-face-fill.ts` is pure and network-free like every other `solar-*` lib, so
the fill can be tested without a canvas.

## What deliberately does not change

- Positions stay in ground metres. Panels stay true-scale.
- Every figure stays live. There is no Calculate button and there will not be.
- The panel count still comes from geometry — never from anything the browser
  can type.
- `systemTotals`, pricing, the proposal snapshot and PVWatts are untouched.
- The plane-based `autoFillRoof` path is untouched and still takes priority.
- Roofing is untouched, proven with a diff rather than an assurance.

## Tests

Unit (`vitest`):

- eave detection on a gable quad, a hip triangle and a rotated face
- the facing points away from the pin, not into the house
- polygon inset shrinks, and a face too small for one panel after inset yields
  zero panels rather than a panel over the eave
- cells outside the trace are omitted, cells inside are kept
- the phase search finds a strictly better fill than a corner-anchored grid on
  at least one shape
- `parseLayoutBlocks` round-trips a face; a malformed face reads as absent
- drop-back re-absorb: a detached panel dropped on its old cell rejoins, and one
  dropped a metre away stays loose

E2E (`playwright`), against the seeded solar deal:

- trace a face → Max Roof → the panel count metric is greater than zero
- drag the facing arrow → the azimuth readout changes and the production figure
  moves
- click a panel inside an array → the array is still one array (the selected-array
  label still reads `Array · C × R`, not `Panel`)

Known trap from previous work in this file: the e2e must not select by
`aria-label` where the visible badge is what changed, and a required custom
field on lead create will time out the fixture if the seed is not used.
