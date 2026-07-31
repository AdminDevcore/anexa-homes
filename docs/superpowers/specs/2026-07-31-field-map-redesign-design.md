# Field Map redesign — map-first, role-split

Date: 2026-07-31
Status: Approved

## Problem

`/portal/canvassing` stacks roughly forty interactive controls above the map:

- 7 page tabs (Map, List, Dashboard, Leaderboard, Storm leads, Address checker, Storm zones)
- 11 toolbar buttons (Search, Satellite/Street, Locate me, ZIP codes, Hail, Reports, Warnings, Heat, score slider, Knock, Draw territory)
- 6 date presets
- ~14 stat pills and filter chips (Today, Knocked, Houses, Remaining only, Deals, 8 disposition chips, rep selector)

All of them render at the same visual weight, always. The map — the product — starts about 600px down the page and receives `min(75vh, 800px)` of what's left. On a phone it occupies roughly a third of the screen.

The primary user is a rep knocking doors on a phone, outdoors, one-handed. Most of what crowds the screen is manager tooling that a rep never touches, and the single most-repeated action — logging a disposition — costs four or more taps through a native `<select>` inside a Leaflet popup (`canvassing-client.tsx:548`).

## Goals

- The map fills the screen. Nothing stacks above it.
- A rep logs a knock in two taps.
- A rep sees only rep controls; manager tooling appears only for `canManage`.
- No feature is removed, no schema changes, no new dependencies.

## Non-goals

- Changing knock/territory/storm data models or API routes.
- Redesigning List, Dashboard, or Leaderboard internals (they only get regrouped).
- Native mobile app work.

## Design

### Layout

`PortalShell` wraps content in `p-4 sm:p-6 lg:p-8` (`portal-shell.tsx:188`) and the header is `h-16`. The Field Map cancels that padding with negative margins and sizes itself `h-[calc(100dvh-4rem)]`. The Leaflet container fills 100% of it. Every control floats over the map or lives in a sheet.

### Rep view (`canManage === false`)

```
┌──────────────────────────┐
│ ⌕ Search an address   ⊙ ≡│  floating pill, top
│                          │
│           MAP            │
│       (full bleed)       │
│                          │
│ 47 today · 128 left  ⚙ 2 │  floating status bar, bottom
└──────────────────────────┘
```

Controls, total:

| Control | Contents |
|---|---|
| ⌕ Search | Collapses to an icon until tapped. Existing `AddressSearch`. |
| ⊙ Locate me | Unchanged behaviour. |
| ≡ Layers | Satellite/Street, Hail, Heat + score slider. |
| ⚙ Filters | Badge = count of active filters. Sheet holds date range, 8 disposition chips, Remaining only, Deals. |

ZIP codes, Reports and Warnings do not render for reps. The three stat pills collapse to one line of text in the bottom bar.

### Knock loop

Tapping a house dot opens a bottom sheet (`sheet.tsx` already supports `side="bottom"`):

- Peek height: address, contact/property-value line, and a 3-column grid of the seven `KNOCKED_DISPOSITIONS` (`src/lib/canvassing.ts:13`) at a minimum 56px tap target, coloured from each entry's `color`. One tap writes the disposition and closes the sheet. Two taps total.
- Swipe up expands to the full detail view — owner lookup, property value, storm info, notes, Convert to appointment, Move pin. Same capabilities as today's `KnockDetailDialog`, reached by swipe instead of a "Details" link.

House and deal Leaflet popups are replaced by this sheet. Popups clip at screen edges, reposition the map, and cannot hold a 56px target. Territory popups stay as popups — manager-only, desktop-only, and they work.

`canvassing-map.tsx` keeps its shape; `renderKnockPopup` / `renderDealPopup` become `onKnockClick` / `onDealClick` callbacks.

### Manager view (`canManage === true`)

Same full-bleed map plus a collapsible 320px left rail overlaying it. Rail sections, collapsed by default except Filters:

- **Layers** — basemap, ZIP codes, Hail, Reports, Warnings, Heat + score slider
- **Filters** — date range, dispositions, rep selector, Remaining only, Deals
- **Territories** — Draw button, territory list with knocked/total progress and rep assignment (today this is buried in a Leaflet popup)
- **Storm** — zones, leads, address checker

Stats render as a small floating card, top-right. Rail collapsed/expanded state persists in `localStorage`.

### Tabs

| Now | After |
|---|---|
| Map | Map |
| List | List |
| Dashboard, Leaderboard | Insights (one scroll) |
| Storm leads, Address checker, Storm zones | manager rail panels |

Leaderboard remains reachable for reps inside Insights.

### Code structure

`canvassing-client.tsx` is 1,739 lines holding filter state, six queries, four dialogs, three popup renderers and the toolbar. Split into `src/components/portal/field-map/`:

| File | Responsibility |
|---|---|
| `field-map.tsx` | Layout shell, role branch. ~150 lines. |
| `use-field-map-data.ts` | The six queries (knocks, houses, deals, territories, zips, storm). |
| `use-map-filters.ts` | Filter state, synced to URL query params. |
| `knock-sheet.tsx` | Bottom sheet, disposition grid, expanded detail. |
| `filters-sheet.tsx` | Rep filter sheet. |
| `layers-panel.tsx` | Layer toggles, shared by rep sheet and manager rail. |
| `manager-rail.tsx` | Collapsible rail and its sections. |
| `territory-dialog.tsx`, `convert-dialog.tsx`, `knock-detail-dialog.tsx` | Extracted from `canvassing-client.tsx` unchanged. |

Filter state moves to URL query params so a refresh preserves the view and managers can share a link.

`framer-motion` (already a dependency) drives the swipe-to-expand. No new packages.

## Testing

Playwright at 390×844:

- Rep logs a knock in two taps and the dot changes colour.
- Filters survive a page reload (URL param round-trip).
- A `canManage` user sees the rail; a rep does not.
- Existing `e2e/canvassing.spec.ts` still passes.

Eight Playwright specs already fail on this baseline and are unrelated to this work.

## Risks

- The map is `forceMount`ed to avoid a `_leaflet_pos` crash on tab switch (`canvassing-shell.tsx:48`). That must stay.
- `100dvh` interacts badly with the iOS Safari URL bar; verify on a real device or emulation before calling it done.
- Replacing popups with a sheet changes how Leaflet click handlers are wired. Confirm no handler leaks across re-renders.
