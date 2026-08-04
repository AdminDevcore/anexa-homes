# Deal stage: Advance & Cancel buttons

**Date:** 2026-08-04
**Status:** Approved

## Problem

Moving a deal forward takes three interactions — open the stage dropdown, scroll a
list of twenty-two entries, find the one that happens to sit directly below the
current stage. That is a picker built for jumping, being used for the thing
people actually do ninety percent of the time: step forward by one.

Killing a deal is worse. There is no cancel action at all. A coordinator scrolls
to the bottom of the same dropdown, guesses which stage means dead, and the deal
keeps counting as open revenue afterwards because nothing else changes: the
lead's status stays `open` and the job stays in production.

## Design

Both actions live on the stage bar (`deal-stage-bar.tsx`), the row that already
states where the deal is:

```
● Insurance Claim Opened  4/22    [Advance → Adjuster Meeting]  [Change ▾]  [Cancel deal]
  Next: Adjuster Meeting Scheduled
```

### Advance

A primary button labelled with the stage it moves to. One click, no dialog — it
calls the existing `moveLeadStage` with the next stage's id, so there is no new
server code. Hidden on the final stage, and hidden when the deal already sits on
the cancelled stage.

**Advance skips lost stages.** "Next" is the next stage *not* flagged lost, so a
deal at step 21 of 22 does not advance itself into Cancelled.

### Cancel

A destructive-styled button opening a confirm dialog with a required reason.

**Target stage:** the stage flagged `isLost` in Settings → Pipeline, resolved per
pipeline, so Roofing and Solar each cancel to their own stage with no stage name
hardcoded anywhere. If a pipeline has no stage flagged lost, the button does not
render.

**Prod prerequisite:** the 22-stage roofing pipeline's Cancelled stage must be
toggled to "Lost" in Settings → Pipeline (the switch already exists in
`pipeline-stages-manager.tsx`). Until then the button stays hidden. The dev seed
gains a flagged `Cancelled` stage on both pipelines so the feature is testable
locally.

### Server: `cancelLeadAction({ leadId, reason })`

New action in `src/server/modules/leads/actions.ts`, gated by the same
`can(user, "update", "Lead")` that guards every other stage move. In one
transaction:

1. Move the lead to the lost stage, resetting the SLA and follow-up clocks
   exactly as `moveLeadStage` does. That field block is factored into a shared
   helper so the two paths cannot drift.
2. Set `Lead.status = "lost"` — funnel and conversion reports read that field,
   and no stage move has ever touched it.
3. Set the linked `Project.status = "cancelled"` if the deal has a job, so it
   drops out of production reports and revenue totals.
4. Write the reason as a note on the deal.
5. Log `"<name> cancelled the deal — <reason>"` to the activity log.

Then fire the existing `stage_changed` notification event, matching
`moveLeadStage`.

### Reversal

Cancelling is reversible through the Change dropdown, but `Lead.status` and
`Project.status` do **not** auto-revert on that move. A deal moved back off
Cancelled stays `lost` / `cancelled` until edited. Deliberate: inferring intent
from a stage move is how a deal quietly re-enters revenue totals nobody meant to
change.

## Testing

Playwright spec covering:

- Advance moves the deal one stage forward and the bar reflects it.
- Cancel requires a reason before it will submit.
- Cancel lands the deal on the Cancelled stage and writes the reason as a note.
