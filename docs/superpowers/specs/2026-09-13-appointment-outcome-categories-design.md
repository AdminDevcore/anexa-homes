# Appointment outcome categories, reschedule tracking, and status filters (Solar)

Date: 2026-09-13 · Status: approved in conversation · Scope: **Solar only**

## Problem

On the Solar workspace, the Appointments list cannot answer "did this
appointment run?".

- An outcome is only a label and a group. Nothing says that "No show — nobody
  home" means the visit did not happen, so it sits beside "Signed" and never
  reaches the Not ran chip.
- "Not ran" today means only *the time has passed and nobody recorded
  anything*. That is a gap in data entry, not a result.
- "Cancelled" today means only *the deal sits in a stage flagged `isLost`*. An
  appointment cancelled before arrival on a live deal has nowhere to go.
- Moving an appointment overwrites `Lead.appointmentAt`. No reschedule is ever
  recorded, so "Rescheduled" cannot be counted.
- There is no way to filter by whether a rep is assigned.

## Decisions

1. **Solar only.** Roofing's Appointments list, outcome settings and date
   saves behave exactly as before. The owner treats the verticals as separate
   products (see the solar-only-scope note), and the page and settings code are
   shared, so every change below is gated on the vertical.
2. Every solar outcome carries a **Counts as** category: `ran`, `not_ran`,
   `rescheduled` or `cancelled`. Set per outcome in Settings → Appointment
   Outcomes.
3. Reschedules are recorded **automatically** whenever a solar appointment time
   moves (chosen over "outcome only", so the history survives a later
   "Signed"). An outcome tagged Rescheduled also counts.
4. Past-with-nothing-recorded becomes its own status, **Needs outcome**, so an
   unrecorded visit never pollutes the ran / not-ran split.
5. One **Cancelled** chip covers both dead deals and outcomes tagged Cancelled.
6. A **Rep** filter (Any / Assigned / Unassigned) combines with every chip.

## 1. Outcome categories (no migration)

`Disposition` in `src/lib/dispositions.ts` becomes
`{ group: string | null; label: string; countsAs: OutcomeCategory }`.

**Reading.** A stored outcome with no valid `countsAs` gets one inferred from
its wording by `inferCountsAs(label)`, first match wins:

| Wording (case-insensitive) | Counts as |
|---|---|
| `reschedul` | rescheduled |
| `no show`, `no-show`, `noshow`, `nobody home`, `no one home`, `not home`, `not ran`, `didn't run` | not_ran |
| `cancel` | cancelled |
| anything else | ran |

This happens in `parseDispositions` for both verticals. It is in-memory only,
and roofing never displays or stores the value.

**Writing.** `updateAppointmentDispositionsAction` accepts an optional
`countsAs`.
- On **solar** it stores `countsAs`, inferring it if missing, so an older client
  can never write a list without one.
- On **roofing** it stores `{ group, label }` exactly as today.

**Defaults.** The solar default list gains a "Didn't run" group: "No show —
nobody home" → not_ran, "Rescheduled" → rescheduled, "Cancelled before arrival"
→ cancelled. These are the wordings already live in production. Every other
solar default is `ran`. The roofing default list keeps the same twelve labels in
the same order; each carries `countsAs: "ran"` in memory only.

**Settings screen.**
- On solar, each row gains a "Counts as" select beside the group input, with a
  hint explaining it.
- On roofing, nothing is added and the save payload is unchanged.
- The "Standard list" button now loads the vertical's own defaults. It used to
  load roofing's "Hail Damage" list even on solar, a solar-side bug fixed in
  passing.

**A retired outcome** (recorded on a deal, since deleted from Settings) is
categorised by `inferCountsAs`, so it still lands in a status.

## 2. Reschedule tracking (one additive migration)

```prisma
/// One row per time a solar deal's appointment moved from one time to another.
model LeadAppointmentReschedule {
  id             String   @id @default(uuid())
  leadId         String
  lead           Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  fromAt         DateTime
  toAt           DateTime
  /// The outcome the old visit carried, cleared by this move. Null if none.
  clearedOutcome String?
  movedById      String?
  movedBy        User?    @relation("LeadAppointmentRescheduleMovedBy", fields: [movedById], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())

  @@index([leadId, createdAt])
  @@map("lead_appointment_reschedules")
}
```

A child of `Lead` with no vertical column, exactly like `LeadStageEvent`, and
only ever reached through a deal the caller has already scoped.

**The rule** is a pure function, `planAppointmentMove`, in
`src/lib/appointment-reschedule.ts`:

- vertical is not solar (`tracksReschedules`) → nothing recorded
- previous or next time is null → nothing (a first booking, or a clear)
- same minute → nothing (a full-form save that re-sends the same time)
- current outcome counts as `ran` → a **correction**: nothing recorded, outcome kept
- otherwise → a reschedule. Any current outcome (not_ran / cancelled /
  rescheduled) is cleared from the deal and copied to `clearedOutcome`.

**Write paths.** One non-RPC server module,
`src/server/modules/leads/appointment-moves.ts`:
- `planLeadAppointmentMove` runs before the caller's update. It loads the
  outcome category and applies the rule.
- `appointmentMovePatch` is the `{ appointmentDisposition: null }` the caller
  spreads into that update.
- `recordAppointmentReschedule` writes the history row after the update. It is
  non-throwing, like `recordStageEntry`.

| Path | File |
|---|---|
| Full edit form | `updateLeadAction`, `src/server/modules/leads/manage.ts` |
| Deal Summary card | `updateLeadPatchAction`, same file |
| Field Map booking on a deal that already had a time | `convertKnockToAppointmentAction`, `src/server/modules/canvassing/actions.ts` |
| Calendar Reschedule button | `rescheduleAppointmentAction`, same file |

`createLeadAction` and website intake only ever set a first time, so they are
untouched.

**The calendar Reschedule button moves only the knock and its task today.** On a
solar deal that already has an appointment time, it now also moves the deal's
`appointmentAt` and records the reschedule, so the deal, the calendar and the
list agree. Roofing keeps the knock-only behaviour. That roofing gap is a
separate question for the owner.

No backfill: past reschedules were never stored, so every existing appointment
starts at zero.

## 3. Appointments page (solar)

`src/lib/appointment-filters.ts` and its tests stay **byte-identical** and keep
serving roofing. Solar gets a sibling, `src/lib/appointment-status.ts`, that
reuses only the search matcher. `AppointmentsList` takes the page's `vertical`
and picks one or the other.

Each solar appointment lands in **exactly one** status. First match wins:

1. Deal in a stage flagged `isLost` → **Cancelled**
2. Outcome counts as cancelled → **Cancelled**
3. Outcome counts as ran → **Ran**
4. Outcome counts as not_ran → **Not ran**
5. No appointment time → **Unscheduled**
6. Time has passed → **Needs outcome**
7. Otherwise → **Scheduled**

An outcome tagged Rescheduled falls through to 5–7: the visit is still owed.

**Rescheduled** is an extra chip: rows with at least one reschedule row OR an
outcome tagged Rescheduled, excluding dead deals. It overlaps the statuses, so
its count does not add up with theirs.

**Status row, in order:** All · Scheduled · Needs outcome · Ran · Not ran ·
Rescheduled · Unscheduled · Cancelled. Every chip always shows, with zero counts
recessed rather than hidden.

**All** keeps its meaning: live deals while browsing, everything while a search
is running. Outcome-cancelled appointments on live deals are part of All; only
dead deals are hidden.

**Outcome chips** count live deals carrying that outcome. They now overlap the
statuses (a "Signed" deal is in Ran and in "Signed").

**Rep filter.**
- A segmented control, Any rep / Assigned / Unassigned, sits beside the search
  box.
- It narrows the rows **before** the chips are counted, exactly as the search
  does.
- Its own counts describe what All would show, so they match the All chip.

**Row display (solar)**
- The outcome pill is tinted by category: ran green, not ran amber, cancelled
  red, rescheduled blue.
- A past appointment with no outcome reads **Needs outcome**.
- A reschedule count shows as a badge: "Rescheduled" once, "Rescheduled ×2" after that.
- The mobile card gets the same treatment.

**Layout.** Solar: the search and Rep control in the first row, statuses in the
second, outcomes in the third. Roofing keeps its current single top row.

**Data.**
- The page query adds `_count: { select: { appointmentReschedules: true } }`.
  This is a read, invisible on roofing.
- `AppointmentRow` gains `outcomeCategory`, `rescheduleCount` and `assigned`,
  resolved on the server by `buildAppointmentRows(leads, fmt, dispositions)`.

## Not included

- A ran rate on the Rep Scorecard or dashboard.
- The calendar's Cancel button. It still clears only the knock; an appointment
  is recorded as cancelled through its outcome.
- The calendar Reschedule gap on roofing.
- A per-visit outcome history beyond `clearedOutcome`.
- Backfilling past reschedules. They were never stored.

## Testing

- **Vitest, `appointment-status`:** the seven-way precedence; a dead deal beats
  a recorded outcome; Rescheduled overlaps; statuses partition the rows; chips
  always render; All while searching; rep counts and matching.
- **Vitest, `dispositions`:** `inferCountsAs` across the wording table; legacy
  string and object lists; an explicit `countsAs` beats inference; solar
  defaults cover all four categories; roofing defaults keep their twelve labels.
- **Vitest, `appointment-reschedule`:** null → time, time → null, same minute, a
  ran outcome is a correction, each non-ran category is cleared and carried, and
  roofing is never tracked.
- **Roofing untouched:** `appointment-filters.test.ts` passes unmodified, and
  `git diff origin/main -- src/lib/appointment-filters.ts
  src/lib/__tests__/appointment-filters.test.ts` is empty.
- **E2E:**
  - Roofing's Appointments page shows no Needs outcome chip and no Rep filter.
  - Solar's Counts as persists across a reload.
  - Solar's Appointments page renders all status chips, and the Rep filter
    narrows the rows.
- **Hands-on:** move a local solar deal's time, then see the history row in
  psql and the badge on the list.
