# Settings: one navigation column

**Date:** 2026-09-03
**Status:** approved

## The problem

Opening a Settings screen puts three navigation columns between the user and the
thing they came to edit:

1. the dark app sidebar (`PortalShell`, 16rem),
2. the light "All settings" rail (`SettingsChrome`, 13.5–15rem), and
3. the screen's own item rail (`RailLayout`, 16rem).

Two of those three carry their own search box. On the lenders screen the item
rail holds one lender and a New button above roughly 900px of empty background,
so the column reads as broken rather than sparse. The lender panel then states
the same three numbers twice: the header pills say "2 programmes / 67-104
equipment / 3 deals" and the "At a glance" box beside the form repeats all
three.

The hub at `/portal/settings` is twenty near-identical cards whose descriptions
are full sentences, so card heights are ragged and the grid scans as a
directory rather than a control panel.

## The shape

**Settings does not get a nav column of its own. It takes over the one that
already exists.** Entering Settings turns the dark app sidebar into the settings
directory; leaving restores it. This is how Linear, Vercel and Stripe behave and
it is what the "Back to app" affordance is for.

That single decision removes column 2 entirely, which is what makes the
remaining two columns read as an ordinary master-detail screen.

## 1. `PortalShell` gains a settings mode

Mode is derived from `usePathname().startsWith("/portal/settings")`. `usePathname`
resolves during the server render of a client component, so the correct sidebar
is in the first paint — no flash, no `useEffect` swap.

In settings mode the sidebar renders:

- **← Back to app**, returning to the last non-settings pathname. The shell never
  unmounts while navigating within the portal, so a ref can hold that value;
  `/portal/dashboard` is the fallback on a cold load straight into Settings.
- the **Find a setting** box (the `/` shortcut binds here),
- `visibleSettingsGroups(vertical)` as grouped rows, each with its inventory
  label and an amber dot when the section has never been set up.

The rows are restyled for the dark surface — `text-white/55`, `bg-white/[0.08]`
for the active row with the existing gold leading rule, `amber-400` for
attention — rather than reusing the light rail's `border-gold/50 bg-gold/[0.08]`.

### Getting counts to the sidebar

The sidebar lives in `portal/layout.tsx`; the counts are fetched one level down
in `settings/layout.tsx`. Rather than move the query up (it would then run on
every portal page) or refetch over HTTP, `PortalShell` owns a small context
store and `settings/layout.tsx` renders a client publisher that writes
`{inventory, gapKeys}` into it and clears on unmount.

Sections come from the client-side registry and render immediately; the counts
and dots arrive on hydration. The registry has no per-section RBAC — the layout
already guards Settings wholesale — so the client can build the list alone.

`SettingsChrome`, `SettingsRail` and `RailBody` are deleted.

## 2. The item rail reads as a panel

Two changes in `settings-kit/item-rail.tsx`, inherited by all 13 screens that
use `RailLayout`:

- the rail sits on a **card surface** (border + `bg-card`), so a short list is a
  small panel rather than rows floating in grey background;
- its top **aligns with the panel header's**, instead of sitting ~15px above it;
- the stacking breakpoint drops `xl:` → `lg:`. It stacked late because Settings
  spent a column on its own nav. That column is gone.

## 3. The lender panel stops repeating itself

`solar-lender/detail.tsx`: delete the "At a glance" box. Its two facts that are
not already pills — rep pay mode, adders on top — move to the header, where they
are visible from every tab instead of only from Details. Adders already appear
as the "Extra work 1/5" tab badge, so only **Rep pay** becomes a new pill.

The two `Caution` callouts stay: they are actionable and stated once. With the
stat box gone, the Details grid drops from `xl:grid-cols-[minmax(0,1fr)_18rem]`
to full width, so the form fields get the window.

## 4. `/portal/settings` becomes an overview

`settings-hub.tsx` → `settings-overview.tsx`. The card grid goes; the sidebar is
the directory now, and a grid restating it would say the same thing twice.

The overview holds:

- the identity strip (company, workspace, user count) — kept, tightened;
- **Needs attention**: each `SetupGap` with its hint and a Fix → link into the
  section that resolves it. Admin-only, as today;
- a company-wide row for Team and Branding — the two things that are not
  per-workspace;
- an "everything in this workspace is set up" state when there are no gaps.

## Deliberately cut

**Recently changed.** Nothing writes settings edits to `ActivityLog`, so it would
require either audit writes across ~20 server actions or fanning `updatedAt`
queries over 15 models to decorate a strip. Out of scope; a follow-up with real
audit writes is the honest version.

## Files

| File | Change |
|---|---|
| `components/portal/portal-shell.tsx` | settings mode, dark settings nav, context store |
| `components/portal/settings-nav.tsx` | rewritten: `SettingsSidebarNav` + `PublishSettingsNav`; chrome deleted |
| `app/portal/settings/layout.tsx` | no chrome wrapper; fetches and publishes |
| `components/portal/settings-hub.tsx` | → `settings-overview.tsx` |
| `app/portal/settings/page.tsx` | renders the overview |
| `components/portal/settings-kit/item-rail.tsx` | card surface, top alignment, `lg:` breakpoint |
| `components/portal/solar-lender/detail.tsx` | glance strip folded into the header |

## Risk

No e2e spec references the rail chrome ("All settings", "Settings menu", "Find a
setting") — the settings specs navigate by URL — so the nav change carries no
test debt. A concurrent session holds uncommitted work in `solar-panels.tsx`,
`solar-proposal-builder.tsx` and `amos-actions.ts`; none of the files above
overlap it.
