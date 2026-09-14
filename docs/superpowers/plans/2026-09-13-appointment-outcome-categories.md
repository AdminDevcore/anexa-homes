# Appointment Outcome Categories (Solar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Solar workspace, sort appointments by whether they ran (Scheduled / Needs outcome / Ran / Not ran / Rescheduled / Unscheduled / Cancelled), with a per-outcome "Counts as" setting, automatic reschedule tracking, and an Assigned / Unassigned rep filter. Roofing stays byte-for-byte as it is.

**Architecture:**
- Outcome categories live in the existing per-vertical outcome JSON; no migration.
- Reschedules get one additive child table of `Lead`, written through one non-RPC server module from the four places a date moves.
- The solar list uses a new pure filter module, `appointment-status.ts`, beside roofing's untouched `appointment-filters.ts`. `AppointmentsList` picks between them by `vertical`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 6 / Postgres, zod v3, Vitest, Playwright, Tailwind v4.

Spec: `docs/superpowers/specs/2026-09-13-appointment-outcome-categories-design.md`

Work in the worktree `wt-appt` (branch `feat/appointment-outcome-categories`, based on `origin/main` c83ddce). Stage explicit paths only; never `git add -A`.

## File map

| File | Responsibility |
|---|---|
| `src/lib/dispositions.ts` (modify) | `OutcomeCategory`, `inferCountsAs`, `outcomeCategory`; `countsAs` on `Disposition`; solar "Didn't run" defaults |
| `src/lib/__tests__/dispositions.test.ts` (create) | inference, parsing, defaults |
| `src/lib/appointment-reschedule.ts` (create) | pure rule: `tracksReschedules`, `planAppointmentMove` |
| `src/lib/__tests__/appointment-reschedule.test.ts` (create) | the rule |
| `prisma/schema.prisma` (modify) | `LeadAppointmentReschedule` + back-relations |
| `prisma/migrations/20260914000000_lead_appointment_reschedules/migration.sql` (create) | CREATE TABLE |
| `src/server/modules/leads/appointment-moves.ts` (create) | plan / patch / record, used by the 4 write paths |
| `src/server/modules/leads/manage.ts` (modify) | full form + Summary card paths |
| `src/server/modules/canvassing/actions.ts` (modify) | Field Map booking + calendar Reschedule |
| `src/lib/appointment-status.ts` (create) | solar status chips, Rescheduled, rep filter |
| `src/lib/__tests__/appointment-status.test.ts` (create) | the solar filters |
| `src/server/modules/leads/appointment-rows.ts` (modify) | `outcomeCategory`, `rescheduleCount`, `assigned` |
| `src/app/portal/leads/page.tsx` (modify) | `_count`, pass dispositions + vertical |
| `src/components/portal/appointments-list.tsx` (modify) | solar chips, rep control, tinted pills |
| `src/server/modules/settings/actions.ts` (modify) | store `countsAs` on solar only |
| `src/components/portal/appointment-dispositions-manager.tsx` (modify) | Counts as select (solar), vertical defaults |
| `src/app/portal/settings/appointment-outcomes/page.tsx` (modify) | pass `showCategories` + `defaults` |
| `e2e/appointment-outcome-categories.spec.ts` (create) | roofing untouched, solar settings, solar list |

**Must stay unchanged:** `src/lib/appointment-filters.ts`, `src/lib/__tests__/appointment-filters.test.ts`.

---

### Task 1: Outcome categories in `dispositions.ts`

**Files:**
- Modify: `src/lib/dispositions.ts`
- Test: `src/lib/__tests__/dispositions.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/lib/__tests__/dispositions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_APPOINTMENT_DISPOSITIONS,
  DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS,
  inferCountsAs,
  outcomeCategory,
  parseDispositions,
} from "@/lib/dispositions";

describe("inferCountsAs", () => {
  it.each([
    ["No show — nobody home", "not_ran"],
    ["No-show", "not_ran"],
    ["Homeowner not home", "not_ran"],
    ["Cancelled before arrival", "cancelled"],
    ["Customer canceled", "cancelled"],
    ["Rescheduled", "rescheduled"],
    ["Rescheduled — no show", "rescheduled"],
    ["Signed — proposal accepted", "ran"],
    ["Not interested", "ran"],
    ["Homeowner Not Interested", "ran"],
    ["Renter / not the owner", "ran"],
    ["No Damage", "ran"],
  ])("%s → %s", (label, expected) => {
    expect(inferCountsAs(label)).toBe(expected);
  });
});

describe("parseDispositions", () => {
  it("infers a category for a legacy string list", () => {
    expect(parseDispositions(["Signed", "No show"])).toEqual([
      { group: null, label: "Signed", countsAs: "ran" },
      { group: null, label: "No show", countsAs: "not_ran" },
    ]);
  });

  it("infers for a stored object saved before categories existed", () => {
    expect(parseDispositions([{ group: "Didn't run", label: "Cancelled before arrival" }])).toEqual([
      { group: "Didn't run", label: "Cancelled before arrival", countsAs: "cancelled" },
    ]);
  });

  // A company may decide a no-show still counts as a sit. Its choice wins.
  it("keeps an explicit countsAs over the wording", () => {
    expect(parseDispositions([{ group: null, label: "No show", countsAs: "ran" }])[0].countsAs).toBe("ran");
  });

  it("ignores an unknown countsAs and falls back to the wording", () => {
    expect(parseDispositions([{ group: null, label: "No show", countsAs: "maybe" }])[0].countsAs).toBe(
      "not_ran"
    );
  });
});

describe("outcomeCategory", () => {
  const list = parseDispositions([{ group: null, label: "No show", countsAs: "ran" }]);

  it("uses the configured category, case-insensitively", () => {
    expect(outcomeCategory("no show", list)).toBe("ran");
  });

  it("falls back to the wording for an outcome no longer configured", () => {
    expect(outcomeCategory("Cancelled before arrival", list)).toBe("cancelled");
  });
});

describe("default lists", () => {
  it("solar can record every category out of the box", () => {
    const cats = new Set(DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS.map((d) => d.countsAs));
    expect([...cats].sort()).toEqual(["cancelled", "not_ran", "ran", "rescheduled"]);
  });

  // Solar only: the roofing picker must offer exactly what it offered before.
  it("roofing keeps the same twelve labels in the same order", () => {
    expect(DEFAULT_APPOINTMENT_DISPOSITIONS.map((d) => d.label)).toEqual([
      "Hail Damage",
      "Wind Damage",
      "Mixed Storm Damage",
      "Adjuster Needed",
      "Retail Roof",
      "Retail Gutters",
      "Retail Exterior",
      "No Damage",
      "Too New",
      "Existing Contractor",
      "Homeowner Not Interested",
      "Bad Lead",
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/__tests__/dispositions.test.ts`
Expected: FAIL. `inferCountsAs` / `outcomeCategory` are not exported.

- [ ] **Step 3: Implement** — replace the top of `src/lib/dispositions.ts`, down to the end of `parseDispositions`, with:

```ts
// Appointment outcomes ("dispositions") a rep records after running an
// inspection/appointment. Each outcome can belong to a GROUP (e.g. Insurance,
// Retail, No Sale) so the picker shows them under headers. Fully customizable
// per company in Settings → Appointment Outcomes (stored on CompanySettings).

/**
 * What an outcome says about the visit itself: did it happen?
 *
 * Solar sorts its Appointments list by this (see appointment-status.ts).
 * Roofing carries the field in memory only. Its screens never show it and its
 * saves never write it, because the owner asked for this on solar alone.
 */
export const OUTCOME_CATEGORIES = ["ran", "not_ran", "rescheduled", "cancelled"] as const;
export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number];

export const OUTCOME_CATEGORY_LABELS: Record<OutcomeCategory, string> = {
  ran: "Ran",
  not_ran: "Not ran",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

export type Disposition = { group: string | null; label: string; countsAs: OutcomeCategory };

export function isOutcomeCategory(value: unknown): value is OutcomeCategory {
  return typeof value === "string" && (OUTCOME_CATEGORIES as readonly string[]).includes(value);
}

const NOT_RAN_WORDING = /no[\s-]?show|nobody home|no one home|not home|not ran|didn[’']?t run/;

/**
 * A best guess from the wording, for an outcome saved before categories
 * existed. Order matters: "Rescheduled — no show" is a reschedule, and
 * everything that is not obviously a missed or moved visit is one that ran
 * ("Not interested" still sat down with the homeowner).
 */
export function inferCountsAs(label: string): OutcomeCategory {
  const l = label.toLowerCase();
  if (l.includes("reschedul")) return "rescheduled";
  if (NOT_RAN_WORDING.test(l)) return "not_ran";
  if (l.includes("cancel")) return "cancelled";
  return "ran";
}

/** What a recorded outcome counts as: the configured value, else the wording's. */
export function outcomeCategory(outcome: string, list: Disposition[]): OutcomeCategory {
  const key = outcome.trim().toLowerCase();
  return list.find((d) => d.label.toLowerCase() === key)?.countsAs ?? inferCountsAs(outcome);
}

export const DEFAULT_APPOINTMENT_DISPOSITIONS: Disposition[] = [
  { group: "Insurance", label: "Hail Damage", countsAs: "ran" },
  { group: "Insurance", label: "Wind Damage", countsAs: "ran" },
  { group: "Insurance", label: "Mixed Storm Damage", countsAs: "ran" },
  { group: "Insurance", label: "Adjuster Needed", countsAs: "ran" },
  { group: "Retail", label: "Retail Roof", countsAs: "ran" },
  { group: "Retail", label: "Retail Gutters", countsAs: "ran" },
  { group: "Retail", label: "Retail Exterior", countsAs: "ran" },
  { group: "No Sale", label: "No Damage", countsAs: "ran" },
  { group: "No Sale", label: "Too New", countsAs: "ran" },
  { group: "No Sale", label: "Existing Contractor", countsAs: "ran" },
  { group: "No Sale", label: "Homeowner Not Interested", countsAs: "ran" },
  { group: "No Sale", label: "Bad Lead", countsAs: "ran" },
];

/**
 * Solar appointment outcomes.
 *
 * Solar has no adjuster, no storm damage and no insurance claim, so it shares
 * none of the roofing wording. What a solar rep records after a consult is
 * whether the home qualifies and what is blocking it, and, for a visit that
 * never happened, why.
 */
export const DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS: Disposition[] = [
  { group: "Sold", label: "Signed — proposal accepted", countsAs: "ran" },
  { group: "Sold", label: "Verbal yes — sending proposal", countsAs: "ran" },
  { group: "Pipeline", label: "Proposal presented — deciding", countsAs: "ran" },
  { group: "Pipeline", label: "Needs co-owner present", countsAs: "ran" },
  { group: "Pipeline", label: "Awaiting utility bill", countsAs: "ran" },
  { group: "Not Qualified", label: "Credit not approved", countsAs: "ran" },
  { group: "Not Qualified", label: "Roof needs replacement first", countsAs: "ran" },
  { group: "Not Qualified", label: "Too much shade", countsAs: "ran" },
  { group: "Not Qualified", label: "Usage too low to justify", countsAs: "ran" },
  { group: "Not Qualified", label: "Renter / not the owner", countsAs: "ran" },
  { group: "No Sale", label: "Not interested", countsAs: "ran" },
  { group: "No Sale", label: "Going with another installer", countsAs: "ran" },
  { group: "Didn't run", label: "No show — nobody home", countsAs: "not_ran" },
  { group: "Didn't run", label: "Rescheduled", countsAs: "rescheduled" },
  { group: "Didn't run", label: "Cancelled before arrival", countsAs: "cancelled" },
];

// Normalize whatever is stored (JSON) into a clean, de-duped Disposition list.
// Accepts both the legacy string[] format and the grouped object[] format, with
// or without a category. Falls back to the defaults when nothing valid is stored.
export function parseDispositions(
  value: unknown,
  fallback: Disposition[] = DEFAULT_APPOINTMENT_DISPOSITIONS
): Disposition[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const list: Disposition[] = [];
    for (const item of value) {
      let label = "";
      let group: string | null = null;
      let countsAs: OutcomeCategory | null = null;
      if (typeof item === "string") {
        label = item.trim();
      } else if (item && typeof item === "object") {
        const o = item as { group?: unknown; label?: unknown; countsAs?: unknown };
        label = typeof o.label === "string" ? o.label.trim() : "";
        group = typeof o.group === "string" && o.group.trim() ? o.group.trim() : null;
        countsAs = isOutcomeCategory(o.countsAs) ? o.countsAs : null;
      }
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ group, label, countsAs: countsAs ?? inferCountsAs(label) });
    }
    if (list.length) return list;
  }
  return fallback.map((d) => ({ ...d }));
}
```

(`dispositionLabels` and `groupDispositions` below it are unchanged.)

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/__tests__/dispositions.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dispositions.ts src/lib/__tests__/dispositions.test.ts
git commit -m "feat(solar): an appointment outcome says whether the visit ran"
```

(Type errors in the settings manager and action from the new required field are expected until Task 7. Typecheck runs at the end of Task 7.)

---

### Task 2: The reschedule rule

**Files:**
- Create: `src/lib/appointment-reschedule.ts`
- Test: `src/lib/__tests__/appointment-reschedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { planAppointmentMove, tracksReschedules } from "@/lib/appointment-reschedule";

const prevAt = new Date("2026-09-20T17:00:00Z");
const nextAt = new Date("2026-09-22T17:00:00Z");
const base = {
  vertical: "solar" as const,
  prevAt,
  nextAt,
  outcome: null as string | null,
  outcomeCategory: null as "ran" | "not_ran" | "rescheduled" | "cancelled" | null,
};

describe("planAppointmentMove", () => {
  it("moving a solar appointment to another time is a reschedule", () => {
    expect(planAppointmentMove(base)).toEqual({ fromAt: prevAt, toAt: nextAt, clearedOutcome: null });
  });

  it("booking a first time is not", () => {
    expect(planAppointmentMove({ ...base, prevAt: null })).toBeNull();
  });

  it("clearing the time is not", () => {
    expect(planAppointmentMove({ ...base, nextAt: null })).toBeNull();
  });

  // The full edit form re-sends the time on every save.
  it("re-saving the same minute is not", () => {
    expect(planAppointmentMove({ ...base, nextAt: new Date("2026-09-20T17:00:30Z") })).toBeNull();
  });

  // Fixing the time on a visit that happened is a correction, not a reschedule.
  it("leaves an appointment that already ran alone", () => {
    expect(
      planAppointmentMove({ ...base, outcome: "Signed — proposal accepted", outcomeCategory: "ran" })
    ).toBeNull();
  });

  it.each(["not_ran", "cancelled", "rescheduled"] as const)(
    "clears a %s outcome and carries it on the reschedule",
    (category) => {
      expect(planAppointmentMove({ ...base, outcome: "Old result", outcomeCategory: category })).toEqual({
        fromAt: prevAt,
        toAt: nextAt,
        clearedOutcome: "Old result",
      });
    }
  );

  it("never tracks roofing", () => {
    expect(tracksReschedules("roofing")).toBe(false);
    expect(planAppointmentMove({ ...base, vertical: "roofing" })).toBeNull();
    expect(
      planAppointmentMove({ ...base, vertical: "roofing", outcome: "No Show", outcomeCategory: "not_ran" })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/__tests__/appointment-reschedule.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — create `src/lib/appointment-reschedule.ts`:

```ts
import type { Vertical } from "@prisma/client";
import type { OutcomeCategory } from "@/lib/dispositions";

/**
 * Whether moving an appointment in this workspace is recorded as a reschedule.
 *
 * Solar only, by the owner's call. Roofing's date saves write exactly what they
 * wrote before this existed: no history row, and never a cleared outcome.
 */
export function tracksReschedules(vertical: Vertical): boolean {
  return vertical === "solar";
}

export type AppointmentReschedule = {
  fromAt: Date;
  toAt: Date;
  /** The outcome the old visit carried. The move clears it from the deal. */
  clearedOutcome: string | null;
};

const MINUTE = 60_000;

/**
 * Decide whether a change to a deal's appointment time is a reschedule.
 *
 * A reschedule moves an EXISTING time to a DIFFERENT one. A first booking and a
 * cleared date are not reschedules, and neither is a save that re-sends the
 * same minute. A visit that already ran is being corrected, not moved, so it
 * keeps its outcome. Any other outcome described the visit that is no longer
 * happening, so it comes off the deal and onto the history row.
 */
export function planAppointmentMove(input: {
  vertical: Vertical;
  prevAt: Date | null;
  nextAt: Date | null;
  outcome: string | null;
  outcomeCategory: OutcomeCategory | null;
}): AppointmentReschedule | null {
  const { prevAt, nextAt, outcome } = input;
  if (!tracksReschedules(input.vertical)) return null;
  if (!prevAt || !nextAt) return null;
  if (Math.floor(prevAt.getTime() / MINUTE) === Math.floor(nextAt.getTime() / MINUTE)) return null;
  if (outcome && input.outcomeCategory === "ran") return null;
  return { fromAt: prevAt, toAt: nextAt, clearedOutcome: outcome };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/__tests__/appointment-reschedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/appointment-reschedule.ts src/lib/__tests__/appointment-reschedule.test.ts
git commit -m "feat(solar): the rule for when a moved appointment counts as rescheduled"
```

---

### Task 3: The reschedule history table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260914000000_lead_appointment_reschedules/migration.sql`

- [ ] **Step 1: Schema.** Directly after `model LeadStageEvent { … }` add:

```prisma
/// One row per time a solar deal's appointment moved from one time to another.
///
/// Written by server/modules/leads/appointment-moves.ts from every path that
/// moves a time. A child of Lead with no vertical column, like LeadStageEvent:
/// only ever reached through a deal the caller has already scoped.
model LeadAppointmentReschedule {
  id             String   @id @default(uuid())
  leadId         String
  lead           Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  fromAt         DateTime
  toAt           DateTime
  /// The outcome the old visit carried, cleared off the deal by this move.
  clearedOutcome String?
  /// SetNull: removing a user must not erase that the appointment moved.
  movedById      String?
  movedBy        User?    @relation("LeadAppointmentRescheduleMovedBy", fields: [movedById], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())

  @@index([leadId, createdAt])
  @@map("lead_appointment_reschedules")
}
```

In `model User`, beside `stageMoves LeadStageEvent[] @relation("LeadStageEventMovedBy")` add:

```prisma
  appointmentMoves LeadAppointmentReschedule[] @relation("LeadAppointmentRescheduleMovedBy")
```

In `model Lead`, beside `stageEvents LeadStageEvent[]` add:

```prisma
  appointmentReschedules LeadAppointmentReschedule[]
```

- [ ] **Step 2: Generate the DDL from migration history** (never `migrate dev`: it offers to reset the local mirror of live)

```bash
BASE=$(grep '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s#?.*$##')
psql "$BASE" -c "CREATE DATABASE anexa_shadow_appt;"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "${BASE%/*}/anexa_shadow_appt" --script
psql "$BASE" -c "DROP DATABASE anexa_shadow_appt;"
```

Expected: exactly this SQL (CREATE TABLE, one index, two FKs). Save it as `prisma/migrations/20260914000000_lead_appointment_reschedules/migration.sql`:

```sql
-- One row per time a solar deal's appointment moved. Additive only.
CREATE TABLE "lead_appointment_reschedules" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "clearedOutcome" TEXT,
    "movedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_appointment_reschedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_appointment_reschedules_leadId_createdAt_idx" ON "lead_appointment_reschedules"("leadId", "createdAt");

ALTER TABLE "lead_appointment_reschedules" ADD CONSTRAINT "lead_appointment_reschedules_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_appointment_reschedules" ADD CONSTRAINT "lead_appointment_reschedules_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

If the diff prints anything beyond this table (someone else's drift), use only these statements.

- [ ] **Step 3: Apply locally and verify in psql**

```bash
npx prisma migrate deploy
npx prisma generate
psql "$BASE" -c '\d lead_appointment_reschedules'
```

Expected: the table with 7 columns and both foreign keys.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914000000_lead_appointment_reschedules/migration.sql
git commit -m "feat(solar): a table that remembers every time an appointment moved"
```

---

### Task 4: The server helper and the four write paths

**Files:**
- Create: `src/server/modules/leads/appointment-moves.ts`
- Modify: `src/server/modules/leads/manage.ts`, `src/server/modules/canvassing/actions.ts`

- [ ] **Step 1: Create `src/server/modules/leads/appointment-moves.ts`**

```ts
import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { outcomeCategory } from "@/lib/dispositions";
import {
  planAppointmentMove,
  tracksReschedules,
  type AppointmentReschedule,
} from "@/lib/appointment-reschedule";

/**
 * The server half of reschedule tracking.
 *
 * Every path that moves an existing deal's appointment time goes through here:
 * the full edit form, the deal's Summary card, a Field Map booking, the
 * calendar's Reschedule button. A reschedule count with holes in it is one
 * nobody can use.
 *
 * NOT a "use server" module, on purpose. Its callers have already decided the
 * user may touch this deal; exporting these as RPC endpoints would hand that
 * decision to the browser.
 */

type LeadForMove = {
  vertical: Vertical;
  appointmentAt: Date | null;
  appointmentDisposition: string | null;
};

/**
 * Plan the move BEFORE the caller's update, so a cleared outcome rides in the
 * same write as the new time. Null when there is nothing to record.
 */
export async function planLeadAppointmentMove(
  companyId: string,
  lead: LeadForMove,
  nextAt: Date | null
): Promise<AppointmentReschedule | null> {
  // Cheap exits first: roofing never tracks, and most saves don't move the
  // time. Neither should cost a settings read.
  if (!tracksReschedules(lead.vertical) || !lead.appointmentAt || !nextAt) return null;
  const category = lead.appointmentDisposition
    ? outcomeCategory(lead.appointmentDisposition, await getAppointmentDispositions(companyId, lead.vertical))
    : null;
  return planAppointmentMove({
    vertical: lead.vertical,
    prevAt: lead.appointmentAt,
    nextAt,
    outcome: lead.appointmentDisposition,
    outcomeCategory: category,
  });
}

/** What a planned move adds to the caller's lead update. */
export function appointmentMovePatch(move: AppointmentReschedule | null): { appointmentDisposition?: null } {
  return move?.clearedOutcome ? { appointmentDisposition: null } : {};
}

/**
 * Write the history row AFTER the deal's update has landed.
 *
 * Non-throwing, like recordStageEntry: the rep's save has already succeeded,
 * and reporting it as failed (so they retry) would do more harm than a
 * missing row.
 */
export async function recordAppointmentReschedule(
  leadId: string,
  move: AppointmentReschedule | null,
  movedById: string | null
): Promise<void> {
  if (!move) return;
  try {
    await prisma.leadAppointmentReschedule.create({
      data: {
        leadId,
        fromAt: move.fromAt,
        toAt: move.toAt,
        clearedOutcome: move.clearedOutcome,
        movedById,
      },
    });
  } catch (err) {
    console.error("[appointment-moves] failed to record reschedule", { leadId, err });
  }
}
```

- [ ] **Step 2: `manage.ts` imports.** After `import { leadContactFields } from "./contact-fields";` add:

```ts
import {
  appointmentMovePatch,
  planLeadAppointmentMove,
  recordAppointmentReschedule,
} from "./appointment-moves";
import type { AppointmentReschedule } from "@/lib/appointment-reschedule";
```

- [ ] **Step 3: `updateLeadAction`.** Its `existing` select ends with `vertical: true,`. Add after it:

```ts
      // Moving the time on a solar deal is recorded as a reschedule.
      appointmentAt: true,
      appointmentDisposition: true,
```

Replace

```ts
  const stageChanged = stageId !== existing.stageId;

  const tz = await companyTimeZone(user.companyId);
```

with

```ts
  const stageChanged = stageId !== existing.stageId;

  const tz = await companyTimeZone(user.companyId);
  const appointmentAt = d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null;
  const move = await planLeadAppointmentMove(user.companyId, existing, appointmentAt);
```

Replace (in the same function)

```ts
      appointmentAt: d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null,
      notes: d.notes || null,
      customFields: d.customFields as Prisma.InputJsonValue,
    },
  });

  if (stageChanged) await recordStageEntry({ leadId: id, stageId, movedById: user.userId });
```

with

```ts
      appointmentAt,
      ...appointmentMovePatch(move),
      notes: d.notes || null,
      customFields: d.customFields as Prisma.InputJsonValue,
    },
  });

  if (stageChanged) await recordStageEntry({ leadId: id, stageId, movedById: user.userId });
  await recordAppointmentReschedule(id, move, user.userId);
```

- [ ] **Step 4: `updateLeadPatchAction`.** Its select is

```ts
    select: {
      id: true, assignedRepId: true, pipelineId: true, stageId: true,
      address: true, city: true, state: true, zip: true,
    },
  });
  if (!existing) return { ok: false as const, error: "Lead not found or access denied." };

  const data: Prisma.LeadUpdateInput = {};
```

Change it to

```ts
    select: {
      id: true, assignedRepId: true, pipelineId: true, stageId: true,
      address: true, city: true, state: true, zip: true,
      vertical: true, appointmentAt: true, appointmentDisposition: true,
    },
  });
  if (!existing) return { ok: false as const, error: "Lead not found or access denied." };

  const data: Prisma.LeadUpdateInput = {};
```

Replace

```ts
  let movedTo: string | null = null;
  if ("appointmentAt" in d) {
    const tz = await companyTimeZone(user.companyId);
    data.appointmentAt = d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null;
```

with

```ts
  let movedTo: string | null = null;
  let move: AppointmentReschedule | null = null;
  if ("appointmentAt" in d) {
    const tz = await companyTimeZone(user.companyId);
    const nextAt = d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null;
    data.appointmentAt = nextAt;
    move = await planLeadAppointmentMove(user.companyId, existing, nextAt);
    Object.assign(data, appointmentMovePatch(move));
```

Replace

```ts
  if (movedTo) await recordStageEntry({ leadId: existing.id, stageId: movedTo, movedById: user.userId });
```

with

```ts
  if (movedTo) await recordStageEntry({ leadId: existing.id, stageId: movedTo, movedById: user.userId });
  await recordAppointmentReschedule(existing.id, move, user.userId);
```

- [ ] **Step 5: `canvassing/actions.ts` imports.** After `import { recordStageEntry } from "@/server/modules/pipeline/stage-history";` add:

```ts
import {
  appointmentMovePatch,
  planLeadAppointmentMove,
  recordAppointmentReschedule,
} from "@/server/modules/leads/appointment-moves";
import { tracksReschedules } from "@/lib/appointment-reschedule";
```

- [ ] **Step 6: `convertKnockToAppointmentAction`.** Replace

```ts
      select: { id: true, pipelineId: true, stageId: true },
    });
    if (lead) {
      const stageId = await resolveStageForAppointment({
        pipelineId: lead.pipelineId,
        candidateStageId: lead.stageId,
        hasAppointment: true,
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          appointmentAt: when,
          assignedRepId: ownerRepId,
          stageId,
          ...(stageId !== lead.stageId ? { stageChangedAt: new Date() } : {}),
        },
      });
      if (stageId !== lead.stageId) await recordStageEntry({ leadId: lead.id, stageId, movedById: me.userId });
```

with

```ts
      select: {
        id: true, pipelineId: true, stageId: true,
        vertical: true, appointmentAt: true, appointmentDisposition: true,
      },
    });
    if (lead) {
      const stageId = await resolveStageForAppointment({
        pipelineId: lead.pipelineId,
        candidateStageId: lead.stageId,
        hasAppointment: true,
      });
      // Booking again from the map on a deal that already had a time moves it.
      const move = await planLeadAppointmentMove(me.companyId, lead, when);
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          appointmentAt: when,
          assignedRepId: ownerRepId,
          stageId,
          ...(stageId !== lead.stageId ? { stageChangedAt: new Date() } : {}),
          ...appointmentMovePatch(move),
        },
      });
      if (stageId !== lead.stageId) await recordStageEntry({ leadId: lead.id, stageId, movedById: me.userId });
      await recordAppointmentReschedule(lead.id, move, me.userId);
```

- [ ] **Step 7: `rescheduleAppointmentAction`.** Replace

```ts
      data: { dueAt: when },
    });
  }
  await prisma.knockEvent.create({
    data: {
      companyId: me.companyId, knockId: knock.id, type: "status_change", disposition: "appointment",
      body: `Appointment rescheduled to ${when.toLocaleString("en-US")}`, authorId: me.userId, authorName: me.fullName,
```

with

```ts
      data: { dueAt: when },
    });
  }
  // Solar: the deal carries the time the Appointments list and the deal page
  // read. Moving only the knock left both showing the old time and the
  // reschedule uncounted. Only a deal that already HAS a time is moved, so no
  // stage needs re-deriving. Roofing keeps the knock-only behaviour it had.
  if (knock.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: knock.leadId, companyId: me.companyId },
      select: { id: true, vertical: true, appointmentAt: true, appointmentDisposition: true },
    });
    if (lead?.appointmentAt && tracksReschedules(lead.vertical)) {
      const move = await planLeadAppointmentMove(me.companyId, lead, when);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { appointmentAt: when, ...appointmentMovePatch(move) },
      });
      await recordAppointmentReschedule(lead.id, move, me.userId);
    }
  }
  await prisma.knockEvent.create({
    data: {
      companyId: me.companyId, knockId: knock.id, type: "status_change", disposition: "appointment",
      body: `Appointment rescheduled to ${when.toLocaleString("en-US")}`, authorId: me.userId, authorName: me.fullName,
```

- [ ] **Step 8: Guards still green**

Run: `npx vitest run src/lib/__tests__/row-scope-boundary.test.ts src/lib/__tests__/appointment-reschedule.test.ts`
Expected: PASS. `appointment-moves.ts` is not `"use server"`, and both canvassing exports are already allowlisted as "Authorised against the knock."

- [ ] **Step 9: Commit**

```bash
git add src/server/modules/leads/appointment-moves.ts src/server/modules/leads/manage.ts src/server/modules/canvassing/actions.ts
git commit -m "feat(solar): every path that moves an appointment records the reschedule"
```

---

### Task 5: Solar status filters

**Files:**
- Create: `src/lib/appointment-status.ts`
- Test: `src/lib/__tests__/appointment-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  ALL,
  CANCELLED,
  NEEDS_OUTCOME,
  NOT_RAN,
  RAN,
  RESCHEDULED,
  SCHEDULED,
  UNSCHEDULED,
  buildStatusFilters,
  matchesRepFilter,
  matchesStatusFilter,
  repCounts,
  statusOf,
  visibleStatusRows,
  type StatusRow,
} from "@/lib/appointment-status";

const row = (o: Partial<StatusRow> = {}): StatusRow => ({
  outcome: null,
  outcomeCategory: null,
  when: "Sep 20",
  isPast: false,
  isCancelled: false,
  rescheduleCount: 0,
  assigned: true,
  ...o,
});

const SIGNED = "Signed — proposal accepted";
const scheduled = row();
const needsOutcome = row({ isPast: true });
const signed = row({ outcome: SIGNED, outcomeCategory: "ran", isPast: true });
const noShow = row({ outcome: "No show — nobody home", outcomeCategory: "not_ran", isPast: true });
const cancelledBefore = row({ outcome: "Cancelled before arrival", outcomeCategory: "cancelled", isPast: true });
const rescheduledOutcome = row({ outcome: "Rescheduled", outcomeCategory: "rescheduled", isPast: true });
const unscheduled = row({ when: null });
/** Sold, then the deal died. */
const deadSigned = row({ outcome: SIGNED, outcomeCategory: "ran", isPast: true, isCancelled: true });
/** Moved twice, then signed: both Ran AND Rescheduled. */
const movedThenSigned = row({ outcome: SIGNED, outcomeCategory: "ran", isPast: true, rescheduleCount: 2 });

const ROWS = [
  scheduled,
  needsOutcome,
  signed,
  noShow,
  cancelledBefore,
  rescheduledOutcome,
  unscheduled,
  deadSigned,
  movedThenSigned,
];
const STATUS_KEYS = [SCHEDULED, NEEDS_OUTCOME, RAN, NOT_RAN, UNSCHEDULED, CANCELLED];
const CONFIGURED = [SIGNED, "Not interested", "No show — nobody home", "Rescheduled", "Cancelled before arrival"];

describe("statusOf", () => {
  it("puts each appointment where it stands", () => {
    expect(statusOf(scheduled)).toBe(SCHEDULED);
    expect(statusOf(needsOutcome)).toBe(NEEDS_OUTCOME);
    expect(statusOf(signed)).toBe(RAN);
    expect(statusOf(noShow)).toBe(NOT_RAN);
    expect(statusOf(cancelledBefore)).toBe(CANCELLED);
    expect(statusOf(unscheduled)).toBe(UNSCHEDULED);
  });

  it("a dead deal is Cancelled even though it carries a Ran outcome", () => {
    expect(statusOf(deadSigned)).toBe(CANCELLED);
  });

  // A Rescheduled outcome is not a result: the visit is still owed.
  it("a Rescheduled outcome falls through to the appointment time", () => {
    expect(statusOf(rescheduledOutcome)).toBe(NEEDS_OUTCOME);
    expect(statusOf({ ...rescheduledOutcome, isPast: false })).toBe(SCHEDULED);
    expect(statusOf({ ...rescheduledOutcome, when: null })).toBe(UNSCHEDULED);
  });

  it("a recorded result wins over a missing time", () => {
    expect(statusOf(row({ outcome: SIGNED, outcomeCategory: "ran", when: null }))).toBe(RAN);
  });
});

describe("buildStatusFilters", () => {
  it("always shows every status, in order, even with nothing to count", () => {
    const { states } = buildStatusFilters([], CONFIGURED);
    expect(states.map((f) => f.label)).toEqual([
      "All",
      "Scheduled",
      "Needs outcome",
      "Ran",
      "Not ran",
      "Rescheduled",
      "Unscheduled",
      "Cancelled",
    ]);
    expect(states.every((f) => f.count === 0)).toBe(true);
  });

  it("counts each status, with Rescheduled overlapping them", () => {
    const counts = Object.fromEntries(buildStatusFilters(ROWS, CONFIGURED).states.map((f) => [f.key, f.count]));
    expect(counts).toEqual({
      [ALL]: 8, // every live deal; deadSigned is hidden while browsing
      [SCHEDULED]: 1,
      [NEEDS_OUTCOME]: 2, // needsOutcome + rescheduledOutcome
      [RAN]: 2, // signed + movedThenSigned
      [NOT_RAN]: 1,
      [RESCHEDULED]: 2, // rescheduledOutcome + movedThenSigned
      [UNSCHEDULED]: 1,
      [CANCELLED]: 2, // cancelledBefore + deadSigned
    });
  });

  it("counts everything in All while a search is running", () => {
    expect(buildStatusFilters(ROWS, CONFIGURED, true).states[0].count).toBe(ROWS.length);
  });

  it("lists every configured outcome, counts live deals only, and appends retired ones", () => {
    const { outcomes } = buildStatusFilters([...ROWS, row({ outcome: "Old outcome", outcomeCategory: "ran" })], CONFIGURED);
    expect(outcomes.map((f) => f.label)).toEqual([...CONFIGURED, "Old outcome"]);
    expect(outcomes.find((f) => f.label === SIGNED)!.count).toBe(2);
    expect(outcomes.find((f) => f.label === "Not interested")!.count).toBe(0);
  });
});

describe("matchesStatusFilter", () => {
  it("the statuses partition the rows: each row is in exactly one", () => {
    for (const r of ROWS) {
      expect(STATUS_KEYS.filter((k) => matchesStatusFilter(r, k))).toHaveLength(1);
    }
  });

  it("Rescheduled overlaps the statuses and skips dead deals", () => {
    expect(matchesStatusFilter(movedThenSigned, RESCHEDULED)).toBe(true);
    expect(matchesStatusFilter(movedThenSigned, RAN)).toBe(true);
    expect(matchesStatusFilter(rescheduledOutcome, RESCHEDULED)).toBe(true);
    expect(matchesStatusFilter(row({ rescheduleCount: 1, isCancelled: true }), RESCHEDULED)).toBe(false);
    expect(matchesStatusFilter(signed, RESCHEDULED)).toBe(false);
  });

  it("an outcome chip matches live deals with that exact outcome", () => {
    expect(matchesStatusFilter(signed, SIGNED)).toBe(true);
    expect(matchesStatusFilter(deadSigned, SIGNED)).toBe(false);
    expect(matchesStatusFilter(noShow, SIGNED)).toBe(false);
  });
});

describe("visibleStatusRows", () => {
  const rows = [scheduled, deadSigned];

  it("hides dead deals while browsing and reaches them while searching", () => {
    expect(visibleStatusRows(rows, ALL, false)).toEqual([scheduled]);
    expect(visibleStatusRows(rows, ALL, true)).toEqual(rows);
  });

  it("a search does not widen a chosen chip", () => {
    expect(visibleStatusRows(rows, SCHEDULED, true)).toEqual([scheduled]);
  });
});

describe("rep filter", () => {
  const rows = [row({ assigned: false }), row(), row({ assigned: false, isCancelled: true })];

  it("matches by whether a rep is assigned", () => {
    expect(rows.filter((r) => matchesRepFilter(r, "unassigned"))).toHaveLength(2);
    expect(rows.filter((r) => matchesRepFilter(r, "assigned"))).toHaveLength(1);
    expect(rows.filter((r) => matchesRepFilter(r, "any"))).toHaveLength(3);
  });

  // The rep counts must agree with the All chip beside them.
  it("counts live deals while browsing, everything while searching", () => {
    expect(repCounts(rows, false)).toEqual({ any: 2, assigned: 1, unassigned: 1 });
    expect(repCounts(rows, true)).toEqual({ any: 3, assigned: 1, unassigned: 2 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/__tests__/appointment-status.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — create `src/lib/appointment-status.ts`:

```ts
import type { OutcomeCategory } from "@/lib/dispositions";

/**
 * Solar's Appointments list: where each appointment STANDS, and who has it.
 *
 * Roofing's list is appointment-filters.ts and is deliberately untouched; the
 * owner asked for this on solar only.
 *
 * Every appointment lands in exactly one STATUS. Rescheduled is not a status:
 * it is history, and it overlaps them. A deal moved twice and then signed is
 * both Ran and Rescheduled.
 */

export const ALL = "__all__";
/** A time in the future. */
export const SCHEDULED = "__scheduled__";
/** The time has passed and nobody recorded what happened: the chase list. */
export const NEEDS_OUTCOME = "__needs_outcome__";
/** The outcome counts as ran. */
export const RAN = "__ran__";
/** The outcome counts as not ran (a no-show). */
export const NOT_RAN = "__not_ran__";
/** Moved at least once, or carrying an outcome tagged Rescheduled. Overlaps. */
export const RESCHEDULED = "__rescheduled__";
/** No appointment time at all. */
export const UNSCHEDULED = "__unscheduled__";
/** The deal is dead, or the outcome counts as cancelled. */
export const CANCELLED = "__cancelled__";

export type StatusFilter = { key: string; label: string; count: number };
export type StatusFilterGroups = { states: StatusFilter[]; outcomes: StatusFilter[] };

export type StatusRow = {
  outcome: string | null;
  /** What `outcome` counts as, resolved on the server. Null exactly when outcome is. */
  outcomeCategory: OutcomeCategory | null;
  when: string | null;
  isPast: boolean;
  /** The deal sits in a stage flagged `isLost`. Hidden while browsing. */
  isCancelled: boolean;
  rescheduleCount: number;
  assigned: boolean;
};

const STATUS_KEYS = new Set([SCHEDULED, NEEDS_OUTCOME, RAN, NOT_RAN, UNSCHEDULED, CANCELLED]);

/** The one status a row belongs to. First match wins. */
export function statusOf(row: StatusRow): string {
  if (row.isCancelled || row.outcomeCategory === "cancelled") return CANCELLED;
  if (row.outcomeCategory === "ran") return RAN;
  if (row.outcomeCategory === "not_ran") return NOT_RAN;
  // A Rescheduled outcome is not a result: the visit is still owed.
  if (!row.when) return UNSCHEDULED;
  return row.isPast ? NEEDS_OUTCOME : SCHEDULED;
}

export function isRescheduled(row: StatusRow): boolean {
  return !row.isCancelled && (row.rescheduleCount > 0 || row.outcomeCategory === "rescheduled");
}

/**
 * @param rows        appointments in view (already search- and rep-filtered)
 * @param configured  outcome labels from Settings, in configured order
 * @param searching   the search box is non-empty, so All shows dead deals too
 */
export function buildStatusFilters(
  rows: StatusRow[],
  configured: string[] = [],
  searching = false
): StatusFilterGroups {
  const byStatus = new Map<string, number>();
  const byOutcome = new Map<string, number>();
  let dead = 0;
  let rescheduled = 0;
  for (const r of rows) {
    const s = statusOf(r);
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    if (r.isCancelled) dead++;
    if (isRescheduled(r)) rescheduled++;
    if (r.outcome && !r.isCancelled) byOutcome.set(r.outcome, (byOutcome.get(r.outcome) ?? 0) + 1);
  }
  const n = (key: string) => byStatus.get(key) ?? 0;

  // Every status always shows. The owner wants to see all of them, and a zero
  // is an answer.
  const states: StatusFilter[] = [
    { key: ALL, label: "All", count: searching ? rows.length : rows.length - dead },
    { key: SCHEDULED, label: "Scheduled", count: n(SCHEDULED) },
    { key: NEEDS_OUTCOME, label: "Needs outcome", count: n(NEEDS_OUTCOME) },
    { key: RAN, label: "Ran", count: n(RAN) },
    { key: NOT_RAN, label: "Not ran", count: n(NOT_RAN) },
    { key: RESCHEDULED, label: "Rescheduled", count: rescheduled },
    { key: UNSCHEDULED, label: "Unscheduled", count: n(UNSCHEDULED) },
    { key: CANCELLED, label: "Cancelled", count: n(CANCELLED) },
  ];

  // Configured order first; an outcome recorded on a deal but since deleted
  // from Settings is appended, or those deals would be unreachable by chip.
  const configuredSet = new Set(configured);
  const retired = [...byOutcome.keys()].filter((k) => !configuredSet.has(k)).sort();
  const outcomes = [...configured, ...retired].map((label) => ({
    key: label,
    label,
    count: byOutcome.get(label) ?? 0,
  }));

  return { states, outcomes };
}

export function matchesStatusFilter(row: StatusRow, filter: string): boolean {
  if (filter === ALL) return !row.isCancelled;
  if (filter === RESCHEDULED) return isRescheduled(row);
  if (STATUS_KEYS.has(filter)) return statusOf(row) === filter;
  return !row.isCancelled && row.outcome === filter;
}

/** Browsing hides dead deals; a search on All reaches them, as on roofing. */
export function visibleStatusRows<T extends StatusRow>(rows: T[], filter: string, searching: boolean): T[] {
  if (searching && filter === ALL) return rows;
  return rows.filter((r) => matchesStatusFilter(r, filter));
}

export type RepFilter = "any" | "assigned" | "unassigned";

export const REP_FILTERS: { key: RepFilter; label: string }[] = [
  { key: "any", label: "Any rep" },
  { key: "assigned", label: "Assigned" },
  { key: "unassigned", label: "Unassigned" },
];

export function matchesRepFilter(row: { assigned: boolean }, rep: RepFilter): boolean {
  return rep === "any" || row.assigned === (rep === "assigned");
}

/** Counted over what All shows, so "Any rep" always equals the All chip. */
export function repCounts(
  rows: { assigned: boolean; isCancelled: boolean }[],
  searching: boolean
): Record<RepFilter, number> {
  const pool = searching ? rows : rows.filter((r) => !r.isCancelled);
  const assigned = pool.filter((r) => r.assigned).length;
  return { any: pool.length, assigned, unassigned: pool.length - assigned };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/__tests__/appointment-status.test.ts src/lib/__tests__/appointment-filters.test.ts`
Expected: PASS for both (roofing's file untouched).

- [ ] **Step 5: Commit**

```bash
git add src/lib/appointment-status.ts src/lib/__tests__/appointment-status.test.ts
git commit -m "feat(solar): appointment statuses that say whether the visit ran"
```

---

### Task 6: Rows, page and list UI

**Files:**
- Modify: `src/server/modules/leads/appointment-rows.ts`, `src/app/portal/leads/page.tsx`, `src/components/portal/appointments-list.tsx`

- [ ] **Step 1: `appointment-rows.ts`.**
  - Add `import { outcomeCategory, type Disposition } from "@/lib/dispositions";`.
  - In `LeadForRow`, after `assignedRep: …;`, add `_count: { appointmentReschedules: number };`.
  - Change the signature to `export function buildAppointmentRows(leads: LeadForRow[], fmt: Formatters, dispositions: Disposition[] = [], now: number = Date.now()): AppointmentRow[]`.
  - Add these after `outcome: l.appointmentDisposition,`:

```ts
    // Solar sorts by these; roofing's list never reads them.
    outcomeCategory: l.appointmentDisposition ? outcomeCategory(l.appointmentDisposition, dispositions) : null,
    rescheduleCount: l._count.appointmentReschedules,
    assigned: l.assignedRep !== null,
```

- [ ] **Step 2: `leads/page.tsx`.**
  - In the `include`, after `assignedRep: …,`, add:

```ts
      // Solar's Rescheduled chip. A read only; roofing's list never shows it.
      _count: { select: { appointmentReschedules: true } },
```

  - Change `buildAppointmentRows(leads, fmt)` to `buildAppointmentRows(leads, fmt, dispositions)`.
  - Add `vertical={vertical}` to `<AppointmentsList … />`.

- [ ] **Step 3: `appointments-list.tsx`.**

  **Imports and row type.**
  - Add imports:

```ts
import type { Vertical } from "@prisma/client";
import { OUTCOME_CATEGORY_LABELS, type OutcomeCategory } from "@/lib/dispositions";
import {
  REP_FILTERS,
  buildStatusFilters,
  matchesRepFilter,
  repCounts,
  visibleStatusRows,
  type RepFilter,
} from "@/lib/appointment-status";
```

  - Add these to `AppointmentRow`:

```ts
  /** What `outcome` counts as (solar sorts by it). Null when there is no outcome. */
  outcomeCategory: OutcomeCategory | null;
  /** How many times the appointment was moved (solar only; roofing is always 0). */
  rescheduleCount: number;
  /** A rep is assigned. */
  assigned: boolean;
```

  **Component body.** Change the component to take `vertical = "roofing"` (type `vertical?: Vertical`, documented as "Solar sorts by whether each visit ran; roofing keeps its list as it was"). Then replace the body from `const [q, setQ]` through the `visible` memo with:

```tsx
  const solar = vertical === "solar";
  const [q, setQ] = React.useState(initialQuery);
  const [filter, setFilter] = React.useState<string>(ALL_OUTCOMES);
  const [rep, setRep] = React.useState<RepFilter>("any");

  const searching = q.trim().length > 0;
  const searched = React.useMemo(
    () => (searching ? rows.filter((r) => matchesAppointmentQuery(r, q)) : rows),
    [rows, q, searching]
  );

  // Solar's rep filter narrows BEFORE the chips count, exactly as the search
  // does, so every number describes what is on screen.
  const narrowed = React.useMemo(
    () => (solar ? searched.filter((r) => matchesRepFilter(r, rep)) : searched),
    [solar, searched, rep]
  );
  const reps = React.useMemo(() => repCounts(searched, searching), [searched, searching]);

  // Counts reflect the current search, so the chips always add up to what's shown.
  const { states, outcomes } = React.useMemo(
    () =>
      solar
        ? buildStatusFilters(narrowed, configuredOutcomes, searching)
        : buildOutcomeFilters(narrowed, configuredOutcomes, searching),
    [solar, narrowed, configuredOutcomes, searching]
  );

  // A chip can disappear as the search narrows (a roofing state chip, or a
  // retired outcome). Fall back to All by DERIVING the effective filter rather
  // than resetting state in an effect — no cascading render, and the original
  // choice is restored if the search widens again.
  const selectable = React.useMemo(
    () => new Set([...states, ...outcomes].map((f) => f.key)),
    [states, outcomes]
  );
  const active = selectable.has(filter) ? filter : ALL_OUTCOMES;

  const visible = React.useMemo(
    () => (solar ? visibleStatusRows(narrowed, active, searching) : visibleRows(narrowed, active, searching)),
    [solar, narrowed, active, searching]
  );

  const search = (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, address, phone, rep…"
        className="h-9 pl-8"
        aria-label="Search appointments"
      />
    </div>
  );

  const statusChips = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
      {states.map((f) => (
        <FilterChip key={f.key} filter={f} active={active === f.key} onSelect={setFilter} />
      ))}
    </div>
  );
```

  **Header JSX.** Replace the header block (the `lg:flex-row` div holding the search `div` and the "Filter by status" group) with:

```tsx
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {solar ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            {search}
            <RepToggle value={rep} counts={reps} onChange={setRep} />
          </div>
        ) : (
          search
        )}

        {/* Row 1 — where an appointment stands. Solar gives it its own row. */}
        {!solar && statusChips}
      </div>

      {solar && statusChips}
```

  **Table cell and mobile card.**
  - In the table, change `<AppointmentCell row={l} />` to `<AppointmentCell row={l} solar={solar} />`.
  - In the mobile card, replace

```tsx
                  {l.outcome ? (
                    <OutcomePill outcome={l.outcome} />
                  ) : l.isPast ? (
                    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Not ran
                    </span>
                  ) : null}
```

with

```tsx
                  {solar ? (
                    <SolarMarks row={l} />
                  ) : l.outcome ? (
                    <OutcomePill outcome={l.outcome} />
                  ) : l.isPast ? (
                    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Not ran
                    </span>
                  ) : null}
```

  **Helper components.** Replace `AppointmentCell` and `OutcomePill` at the bottom of the file with:

```tsx
function AppointmentCell({ row, solar }: { row: AppointmentRow; solar: boolean }) {
  if (!row.when) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground/50">Not scheduled</span>
        {solar && (row.outcome || row.rescheduleCount > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SolarMarks row={row} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="whitespace-nowrap text-sm">{row.when}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.relative && (
          <span className="text-[11px] text-muted-foreground/70">{row.relative}</span>
        )}
        {solar ? (
          <SolarMarks row={row} />
        ) : row.outcome ? (
          <OutcomePill outcome={row.outcome} />
        ) : row.isPast ? (
          // A past appointment with no outcome is the thing a manager chases.
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Not ran
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Solar: what the outcome counts as, the gap if nothing was recorded, and any moves. */
function SolarMarks({ row }: { row: AppointmentRow }) {
  return (
    <>
      {row.outcome ? (
        <OutcomePill outcome={row.outcome} category={row.outcomeCategory} />
      ) : row.isPast ? (
        <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Needs outcome
        </span>
      ) : null}
      {row.rescheduleCount > 0 && (
        <span className="whitespace-nowrap rounded-full border border-sky-500/30 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
          {row.rescheduleCount > 1 ? `Rescheduled ×${row.rescheduleCount}` : "Rescheduled"}
        </span>
      )}
    </>
  );
}

const CATEGORY_PILL: Record<OutcomeCategory, string> = {
  ran: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  not_ran: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-300",
  rescheduled: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

function OutcomePill({ outcome, category }: { outcome: string; category?: OutcomeCategory | null }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        category ? CATEGORY_PILL[category] : "bg-gold/15 text-gold-muted"
      )}
      title={category ? `Counts as ${OUTCOME_CATEGORY_LABELS[category]}` : undefined}
    >
      {outcome}
    </span>
  );
}

/** Solar: who has the appointment. Combines with every status chip. */
function RepToggle({
  value,
  counts,
  onChange,
}: {
  value: RepFilter;
  counts: Record<RepFilter, number>;
  onChange: (next: RepFilter) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center rounded-lg border border-border bg-card p-0.5"
      role="group"
      aria-label="Filter by rep"
    >
      {REP_FILTERS.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-gold/12 text-gold-muted" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{o.label}</span>
            <span className="text-[10px] font-semibold tabular-nums opacity-70">{counts[o.key]}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck the slice**

Run: `npx tsc --noEmit 2>&1 | grep -E "appointment|leads/page|dispositions" || echo clean`
Expected: `clean` (settings files are fixed in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/leads/appointment-rows.ts src/app/portal/leads/page.tsx src/components/portal/appointments-list.tsx
git commit -m "feat(solar): the appointments list sorts by ran, not ran, rescheduled and who has it"
```

---

### Task 7: Settings — Counts as (solar)

**Files:**
- Modify: `src/server/modules/settings/actions.ts`, `src/components/portal/appointment-dispositions-manager.tsx`, `src/app/portal/settings/appointment-outcomes/page.tsx`

- [ ] **Step 1: `settings/actions.ts`.**
  - Add `import { OUTCOME_CATEGORIES, inferCountsAs, type OutcomeCategory } from "@/lib/dispositions";`.
  - In `dispositionsSchema`'s item object, add `countsAs: z.enum(OUTCOME_CATEGORIES).optional(),`.
  - Replace the body of `updateAppointmentDispositionsAction` from `// De-dupe by label` through the `saveVerticalScopedSetting(…)` call with:

```ts
  // Solar sorts its Appointments list by what each outcome counts as, so a
  // solar save stores it (inferring from the wording if a client sent none).
  // Roofing stores its list exactly as it did before categories existed.
  const vertical = await getActiveVertical(user);
  const solar = vertical === "solar";

  // De-dupe by label (case-insensitive) while preserving order; keep group.
  const seen = new Set<string>();
  const items: { group: string | null; label: string; countsAs?: OutcomeCategory }[] = [];
  for (const raw of parsed.data.items) {
    const label = raw.label.trim();
    const group = raw.group?.trim() || null;
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    items.push(solar ? { group, label, countsAs: raw.countsAs ?? inferCountsAs(label) } : { group, label });
  }
  if (items.length === 0) return fail("Keep at least one outcome.");

  await saveVerticalScopedSetting(user.companyId, vertical, "appointmentDispositions", items);
```

- [ ] **Step 2: `appointment-dispositions-manager.tsx`** — replace the file with:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Hint,
  ListEditor,
  Panel,
  SaveBar,
  type ListRow,
} from "@/components/portal/settings-kit";
import {
  OUTCOME_CATEGORIES,
  OUTCOME_CATEGORY_LABELS,
  inferCountsAs,
  type Disposition,
  type OutcomeCategory,
} from "@/lib/dispositions";
import { updateAppointmentDispositionsAction } from "@/server/modules/settings/actions";

type Row = ListRow & { group: string; countsAs: OutcomeCategory };

/**
 * The outcomes a rep records at the end of an appointment.
 *
 * Every edit used to write straight to the server — a rename on blur, a reorder
 * on the arrow press, a delete behind a browser confirm — so a list being
 * reworked was half-published the whole way through. One draft, one Save.
 *
 * The group is what turns a flat list of fifteen into a menu somebody can read:
 * "Sold", "Not sold", "No show". Left blank, an outcome sits on its own at the
 * top level.
 *
 * On solar each outcome also says what it COUNTS AS — ran, not ran,
 * rescheduled, cancelled — which is how the Appointments list sorts. Roofing
 * shows no such control and saves exactly the shape it always saved.
 */
export function AppointmentDispositionsManager({
  items,
  defaults,
  showCategories,
}: {
  items: Disposition[];
  /** What "Standard list" loads: this workspace's own defaults. */
  defaults: Disposition[];
  showCategories: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  // The shape a save writes, and so the shape "dirty" is measured in. Roofing's
  // has no category, or its parsed (inferred) one would read as an unsaved edit.
  const toStored = React.useCallback(
    (d: { group: string | null; label: string; countsAs: OutcomeCategory }) =>
      showCategories
        ? { group: d.group, label: d.label, countsAs: d.countsAs }
        : { group: d.group, label: d.label },
    [showCategories]
  );

  const seed = React.useCallback(
    (): Row[] =>
      items.map((d, i) => ({
        id: `${i}-${d.label}`,
        label: d.label,
        group: d.group ?? "",
        countsAs: d.countsAs,
      })),
    [items]
  );
  const [rows, setRows] = React.useState(seed);

  const serverKey = JSON.stringify(items.map(toStored));
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setRows(seed());
  }

  const payload = rows
    .filter((r) => r.label.trim() !== "")
    .map((r) => toStored({ group: r.group.trim() || null, label: r.label.trim(), countsAs: r.countsAs }));
  const dirty = JSON.stringify(payload) !== serverKey;

  // Every group already in use, so adding another outcome to one is a matter of
  // recognising the name rather than spelling it the same way twice.
  const groups = Array.from(new Set(rows.map((r) => r.group.trim()).filter(Boolean)));

  async function commit(next: typeof payload, okMsg: string) {
    setBusy(true);
    try {
      const res = await updateAppointmentDispositionsAction({ items: next });
      if (!res.ok) return toast.error(res.error);
      toast.success(okMsg);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        title="Outcomes"
        description="In the order a rep is offered them. Deleting one keeps it on every appointment that already recorded it — the outcome is stored as text on the appointment, not as a pointer to this list."
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setRows(
                defaults.map((d, i) => ({
                  id: `default-${i}`,
                  label: d.label,
                  group: d.group ?? "",
                  countsAs: d.countsAs,
                }))
              );
              toast.info("Standard list loaded — Save to keep it.");
            }}
          >
            <RotateCcw className="size-4" /> Standard list
          </Button>
        }
      >
        <ListEditor
          rows={rows}
          onChange={(next) =>
            setRows(
              next.map((n) => ({
                ...n,
                group: (n as Row).group ?? "",
                // A freshly added row has no category yet: guess from its words.
                countsAs: (n as Row).countsAs ?? inferCountsAs(n.label),
              }))
            )
          }
          addLabel="Add outcome"
          placeholder="e.g. Sold — full replacement"
          disabled={busy}
          renderExtra={(row, i) => (
            <>
              <Input
                value={(row as Row).group}
                disabled={busy}
                list="disposition-groups"
                placeholder="group"
                aria-label={`Group for ${row.label || `outcome ${i + 1}`}`}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, group: e.target.value } : r))
                  )
                }
                className="h-9 w-32 shrink-0"
              />
              {showCategories && (
                <select
                  value={(row as Row).countsAs}
                  disabled={busy}
                  aria-label={`Counts as for ${row.label || `outcome ${i + 1}`}`}
                  onChange={(e) => {
                    const countsAs = e.target.value as OutcomeCategory;
                    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, countsAs } : r)));
                  }}
                  className="h-9 w-32 shrink-0 rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {OUTCOME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {OUTCOME_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        />
        <datalist id="disposition-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Hint>
          Outcomes sharing a group are shown together under it. Leave the group blank and the
          outcome sits on its own.
        </Hint>
        {showCategories && (
          <Hint>
            Counts as decides where an appointment with this outcome lands on the Appointments
            list: Ran, Not ran, Rescheduled or Cancelled.
          </Hint>
        )}
      </Panel>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="appointment outcomes"
        onSave={() => void commit(payload, "Outcomes saved")}
        onDiscard={() => setRows(seed())}
        disabled={payload.length === 0}
        blockedReason={
          payload.length === 0 ? "Keep at least one outcome — the picker needs an answer." : undefined
        }
      />

      {busy && (
        <span className="sr-only" role="status">
          <Loader2 className="size-4 animate-spin" /> Saving
        </span>
      )}
    </>
  );
}
```

- [ ] **Step 3: `appointment-outcomes/page.tsx`.**
  - Add `import { DEFAULT_APPOINTMENT_DISPOSITIONS, DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS } from "@/lib/dispositions";`.
  - Replace the `items` line and the manager element with:

```tsx
  const vertical = await getActiveVertical(user);
  const items = await getAppointmentDispositions(user.companyId, vertical);
  const solar = vertical === "solar";
```

```tsx
      <AppointmentDispositionsManager
        items={items}
        showCategories={solar}
        defaults={solar ? DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS : DEFAULT_APPOINTMENT_DISPOSITIONS}
      />
```

- [ ] **Step 4: Full typecheck, lint on touched files, unit tests**

```bash
pnpm typecheck
npx eslint src/lib/dispositions.ts src/lib/appointment-reschedule.ts src/lib/appointment-status.ts src/server/modules/leads/appointment-moves.ts src/server/modules/leads/manage.ts src/server/modules/canvassing/actions.ts src/server/modules/leads/appointment-rows.ts src/app/portal/leads/page.tsx src/components/portal/appointments-list.tsx src/server/modules/settings/actions.ts src/components/portal/appointment-dispositions-manager.tsx src/app/portal/settings/appointment-outcomes/page.tsx
pnpm test
```

Expected: typecheck clean, eslint clean, vitest all green.

- [ ] **Step 5: Roofing untouched**

Run: `git diff origin/main --stat -- src/lib/appointment-filters.ts src/lib/__tests__/appointment-filters.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/settings/actions.ts src/components/portal/appointment-dispositions-manager.tsx src/app/portal/settings/appointment-outcomes/page.tsx
git commit -m "feat(solar): each appointment outcome is set to count as ran, not ran, rescheduled or cancelled"
```

---

### Task 8: E2E

**Files:**
- Create: `e2e/appointment-outcome-categories.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from "@playwright/test";

/**
 * Solar sorts appointments by whether the visit ran; roofing keeps its list
 * exactly as it was. Both halves are asserted, because the owner asked for
 * this on solar only and has asked before to see roofing proven untouched.
 */
const FLAG_ON =
  process.env.SOLAR_VERTICAL_ENABLED === "1" || process.env.SOLAR_VERTICAL_ENABLED === "true";
const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function toSolar(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.getByRole("menuitem", { name: "Solar" }).click();
  await page.waitForURL(/\/portal\/dashboard/, { timeout: 15000 });
  await expect(page.getByText(/· Solar workspace/)).toBeVisible({ timeout: 15000 });
}

test("roofing keeps its appointment chips, with no Counts as and no rep filter", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/leads");
  const status = page.getByRole("group", { name: "Filter by status" });
  await expect(status.getByRole("button", { name: /^All/ })).toBeVisible({ timeout: 30000 });
  await expect(status.getByRole("button", { name: /^Needs outcome/ })).toHaveCount(0);
  await expect(status.getByRole("button", { name: /^Ran/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter by rep" })).toHaveCount(0);

  await page.goto("/portal/settings/appointment-outcomes");
  await expect(page.getByRole("button", { name: "Add outcome" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel(/^Counts as for /)).toHaveCount(0);
});

test.describe("solar", () => {
  test.skip(!FLAG_ON, "the Solar workspace is behind SOLAR_VERTICAL_ENABLED");

  test("an outcome's Counts as is saved and survives a reload", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    await page.goto("/portal/settings/appointment-outcomes");

    const select = () => page.getByLabel("Counts as for Not interested");
    await expect(select()).toHaveValue("ran", { timeout: 30000 });
    await select().selectOption("not_ran");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Outcomes saved")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 15000 });

    await page.reload();
    await expect(select()).toHaveValue("not_ran", { timeout: 30000 });

    // Put it back: later specs read this list.
    await select().selectOption("ran");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Outcomes saved")).toBeVisible({ timeout: 15000 });
  });

  test("appointments sort by status, and the rep filter narrows them", async ({ page }) => {
    await login(page, "owner@anexahomes.com");
    await toSolar(page);
    await page.goto("/portal/leads");

    const status = page.getByRole("group", { name: "Filter by status" });
    await expect(status.getByRole("button", { name: /^All/ })).toBeVisible({ timeout: 30000 });
    for (const label of ["Scheduled", "Needs outcome", "Ran", "Not ran", "Rescheduled", "Unscheduled", "Cancelled"]) {
      await expect(status.getByRole("button", { name: new RegExp(`^${label}\\s*\\d+$`) })).toBeVisible();
    }

    const reps = page.getByRole("group", { name: "Filter by rep" });
    const unassigned = reps.getByRole("button", { name: /^Unassigned/ });
    const count = Number((await unassigned.innerText()).replace(/\D+/g, ""));
    await unassigned.click();
    await expect(unassigned).toHaveAttribute("aria-pressed", "true");
    if (count === 0) {
      await expect(page.getByText("No appointments match")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(count);
    }
  });
});
```

- [ ] **Step 2: Run on its own port and schema**, after checking that no other Playwright run is live

```bash
ps aux | grep "[p]laywright/chromium_headless" || echo "no other run"
SOLAR_VERTICAL_ENABLED=1 E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_apptcat" \
  npx playwright test e2e/appointment-outcome-categories.spec.ts
grep -ac 'Parsing CSS source code failed' .next-e2e-3017/dev/logs/next-development.log || true
```

Expected: 3 passed, 0 skipped. The CSS-parse grep reads 0; a non-zero count means the run is invalid (Tailwind race) and must be re-run.

- [ ] **Step 3: Commit**

```bash
git add e2e/appointment-outcome-categories.spec.ts
git commit -m "test(solar): appointment statuses on solar, and roofing left as it was"
```

---

### Task 9: Hands-on check on the local mirror

- [ ] **Step 1:** Start a dev server from the worktree: `NEXT_DIST_DIR=.next-dev3019 npx next dev -p 3019`. Log in as `owner@anexahomes.com` / `Passw0rd!`, switch to Solar, and open Appointments. Confirm the status row, the Rep control, and "Needs outcome" in place of "Not ran".
- [ ] **Step 2:** Open the solar deal with an appointment (local: Elena Vasquez). Move its time by a day on the Summary card and save.
- [ ] **Step 3:** Verify in psql: `select "fromAt","toAt","clearedOutcome","movedById" from lead_appointment_reschedules order by "createdAt" desc limit 1;` shows one row, old → new.
- [ ] **Step 4:** Back on Appointments, the row shows "Rescheduled" and the Rescheduled chip counts 1. Move the time back so the mirror is left as it was, then delete both history rows: `delete from lead_appointment_reschedules where "leadId" = '<id>';`
- [ ] **Step 5:** Stop the server and `rm -rf .next-dev3019`.

### Task 10: Ship

- [ ] `git fetch origin` and `git rebase origin/main`; re-run `pnpm typecheck && pnpm test` if main moved.
- [ ] `git show --stat --format="" origin/main..HEAD`: every file is one listed in this plan.
- [ ] `git push origin HEAD:main`, then `vercel ls` until the production row reads `● Ready`. The build applies the additive migration first.
