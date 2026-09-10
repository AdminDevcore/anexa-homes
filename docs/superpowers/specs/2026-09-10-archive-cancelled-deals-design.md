# Archive cancelled deals

**Date:** 2026-09-10
**Status:** approved

## The problem

`/portal/leads` (Appointments) lists every lead in the active vertical with no
status filter. Cancelled deals never leave. A ten-row list carried four dead
deals — Shayan Salman, MOMOS JUSGRN, 222 222, momo nahal — none of which a rep
will ever work again.

## What "cancelled" means

Two paths put a deal in a Cancelled stage, and they do not agree:

- `cancelLeadAction` moves the deal to the pipeline's `isLost` stage **and**
  sets `Lead.status = "lost"`.
- `moveLeadStage` — dragging a card into the Cancelled column on the Pipeline
  board — moves the stage and leaves `status` alone, deliberately: inferring
  "this is dead" from a drag is how a live deal quietly leaves revenue totals.

So `Lead.status` is not the flag. The **stage's `isLost`** is true down both
paths, and it is exactly what the red "Cancelled" chip in the list already
renders. That is what everything here keys on.

## The predicate

One exported constant, `src/server/modules/leads/cancelled.ts`:

```ts
export const NOT_CANCELLED = {
  OR: [{ stageId: null }, { stage: { is: { isLost: false } } }],
} satisfies Prisma.LeadWhereInput;
```

Written as an explicit `OR` rather than `NOT: { stage: { is: … } }` so a lead
with no stage at all — a brand-new lead, a lead on a pipeline-less company — is
unambiguously *not* cancelled rather than depending on how Prisma resolves a
negated nullable relation.

Every surface that hides cancelled deals composes this same constant. One
definition means "cancelled" cannot drift between the map, the calendar and the
list.

## Appointments list

The page keeps fetching every lead — the Cancelled chip needs them — and now
selects `stage.isLost` so each row carries `isCancelled`.

`src/lib/appointment-filters.ts` gains a `CANCELLED` filter key and these rules:

- The `Cancelled` chip joins the state row (All / Not ran / Upcoming /
  Unscheduled), last, and only when its count is non-zero — the same
  "a chip that matches nothing is noise" rule the other state chips follow.
- `All` and every outcome chip mean *all active*: cancelled rows are excluded
  from their counts. Otherwise `Signed — proposal accepted 1` could be counting
  a deal the list is not showing.
- **A non-empty search spans cancelled deals regardless of the active chip.**
  Typing "momo" from the default view finds momo nahal, carrying the red
  Cancelled stage badge it already has. Hidden from browsing, present in search
  — the archive rule people already know from mail clients. Without this, a
  search for a cancelled customer returns "No appointments match", which reads
  as data loss.

The header count reports active deals, not the raw row count.

## Other surfaces

| Surface | File | Change |
|---|---|---|
| Field Map pins | `server/modules/canvassing/queries.ts` → `getDealsInBounds` | Cancelled houses stop plotting, so nobody re-knocks a dead door |
| Calendar | `server/modules/calendar/queries.ts` | The `appointment` source, **and** install / inspection visits whose lead is cancelled — a cancelled job holding an install date on the calendar is the same confusion in a different place |
| Global search | `app/api/search/route.ts` | Cancelled deals drop out of ⌘K |
| Task / deal picker | `app/api/leads/lookup/route.ts` | Cancelled deals not offered |
| Send-for-signature picker | `app/portal/documents/page.tsx` | A contract must never be sendable to a dead deal |

### Deliberately untouched

- **Pipeline board.** The Cancelled column is the point of that column, and it
  is now one of the two recovery paths.
- **Reports** — funnel, lead sources, delinquency, rep scorecard. Hiding a dead
  deal from a work list is a UI decision. Hiding it from the numbers would be a
  lie about what happened.
- **`Lead.status`.** Nothing here writes it. This is a read-side filter only:
  no migration, no new column, no backfill, and cancelling stays exactly as
  reversible as it is today.

## Recovery

A deal cancelled by mistake is reachable two ways: the **Cancelled chip** on
Appointments, and the **Cancelled column** on the Pipeline board. Dragging it
back to a live stage restores it everywhere at once, because every surface reads
the same stage flag. `status` does not follow it back out — reopening a
written-off deal stays deliberate.

⌘K will not find a cancelled deal. That is the accepted cost of the change.

## Tests

- `src/lib/__tests__/appointment-filters.test.ts` — extend: the Cancelled chip
  and its count, cancelled rows excluded from `All` and from outcome counts,
  search spanning cancelled rows.
- A test asserting `NOT_CANCELLED` matches a lead with `stageId: null`, so a
  new lead is never mistaken for a cancelled one.
