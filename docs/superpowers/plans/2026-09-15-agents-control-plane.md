# Agents Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Agents control plane — `agents` + `agent_runs`, a handler registry, a per-minute cron runner with a human gate and a reaper, three portal pages, the per-person Agents access switch, a Hello stub agent — plus the approved action-required stage changes, all on `main`.

**Architecture:** Pure, unit-tested modules (schedule, gate, budget, validation, access) sit under `src/server/modules/agents/`. The runner composes them with Prisma, executing each handler inside `runInVertical` and applying the stage changes a handler returns through one applier that mirrors `moveLeadStage`. A Vercel Cron route drives `tick()`; Run now drives the same `executeRun()` through `after()`. Pages are server components reading `queries.ts`; the interactive pieces are small client components calling `"use server"` actions.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 6 on Postgres, zod v3, Vitest (unit + integration), Playwright, Tailwind v4 with the existing shadcn and settings-kit components, `croner` 10.0.1 for cron expressions.

**Spec:** `docs/superpowers/specs/2026-09-15-agents-control-plane-design.md`

**Since approval:** decision 13 — Advance and the progress count use main-line stages only, in both verticals — is confirmed. Open questions 1 (portal credentials) and 3 (runs about deals a manager can't open) stay open; this plan decides neither. See *What this plan assumes* at the end.

---

## Ground rules for this worktree

- **Worktree:** `/Users/mustafajoulani/Desktop/anexa-agents-wt`, branch `feat/agents-control-plane`, based on `origin/main`. Every command block starts with `cd` into it, because the shell's working directory does not persist.
- **Never `git add -A` or `git add .`.** Stage the exact paths each task lists. Sibling sessions share this repository's object store and have been swept into each other's commits before.
- **Never touch the shared databases.** This plan uses its own Postgres schemas on the local instance (`127.0.0.1:5544`):
  - dev server and seed: `agents_dev` (set in the worktree's `.env` by Task 0)
  - integration tests: `vertical_test_agents` — prefix with `VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents"`
  - Playwright: `e2e_agents` on port 3017 — prefix with `E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents"`
- **Never run `prisma migrate dev`** — it wants to reset the local mirror. Migrations are generated with `prisma migrate diff` into a folder and applied with `prisma migrate deploy`.
- **Workspace behaviour is verified on a production build**, never on `next dev` (which loads the workspace context twice and makes `runInVertical` silently no-op).
- **Every commit ends with the trailer** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. The commit commands below pass it as a second `-m`.

## File map

**Created — domain (`src/server/modules/agents/`)**

| File | Responsibility |
|---|---|
| `handler-keys.ts` | The list of handler keys. No imports; read by the build check. |
| `types.ts` | Handler contract, change records, run detail shape. Types only. |
| `handlers/system-hello.ts` | The stub agent. |
| `registry.ts` | `HANDLERS`, `handlerFor`, `handlerOptions`. |
| `schedule.ts` | Cron validation and next-run maths (croner, UTC). |
| `config-guard.ts` | Secret-key detection in config, secret reference parsing. |
| `result.ts` | zod validation of a handler's result; summary truncation. |
| `detail.ts` | Empty/normalised run detail, error text, missing-handler message. |
| `gate.ts` | `decideChange`, `planChanges`, `discardAll`, `finalStatus`. |
| `budget.ts` | Tick limits and deadline maths. |
| `timeout.ts` | `withTimeout`: race a handler against a deadline, abort on expiry. |
| `verticals.ts` | Which workspaces an agent runs in, and who can see it. |
| `access.ts` | `agentCan`, `canEditAgentConfig`, the switch's permission keys. |
| `deal-label.ts` | "Name · address" for a deal. |
| `secrets.ts` | Resolve `env:AGENT_*` / `lender:<id>` references. |
| `deps.ts` | The real, read-only `AgentDeps` for a run. |
| `apply-changes.ts` | Resolve requested changes; move a deal the way `moveLeadStage` does. |
| `notify.ts` | Fire `agent_run_failed` / `agent_needs_human` inside the run's workspace. |
| `runner.ts` | `createRun`, `hasRunInFlight`, `writeMissingHandlerRun`, `executeRun`. |
| `reaper.ts` | `reapStuckRuns`. |
| `tick.ts` | `tick`: reap, start stale queued runs, claim due agents, execute concurrently. |
| `handler-check.ts` | Pure check used by the build script. |
| `validate-agent.ts` | Everything saving an agent must refuse. |
| `queries.ts` | Page reads: agents, runs, the needs-a-human queue. |
| `actions.ts` | `"use server"`: create, update, enable, run now, resolve. |

**Created — elsewhere**

| File | Responsibility |
|---|---|
| `src/lib/agent-labels.ts` | Labels, chip tones, form values, time words. Client-safe. |
| `src/lib/stage-progress.ts` | Main-line progress and the next stage Advance offers. |
| `src/server/modules/pipeline/stage-entry-data.ts` | `stageEntryData`, moved out of `leads/actions.ts`. |
| `src/app/api/cron/agents/route.ts` | The per-minute cron entry point. |
| `scripts/check-agent-handlers.ts` | Production build check for enabled agents with no handler. |
| `src/app/portal/agents/page.tsx` | Agents list. |
| `src/app/portal/agents/new/page.tsx` | Create an agent. |
| `src/app/portal/agents/[id]/page.tsx` | Agent detail: config and run history. |
| `src/app/portal/agents/runs/page.tsx` | Run feed, with the needs-a-human queue first. |
| `src/components/portal/agents/` | `href`, `agent-tabs`, `filter-chips`, `pagination`, `local-time`, `auto-refresh`, `run-status-pill`, `change-list`, `resolve-run`, `run-list`, `needs-human-card`, `run-now-button`, `agent-enabled-switch`, `agent-config-form`, `agents-access-card`, `product-choices`. |
| `prisma/migrations/20260915120000_agents_control_plane/` | Enums, tables, notification event values (generated). |
| `prisma/migrations/20260915120100_action_required_stages/` | Stage flags and three roofing stages. |
| `prisma/migrations/20260915120200_agents_seed_rows/` | Hello Agent and starter notification rules. |
| `e2e/agents.spec.ts` | Browser coverage. |

**Tests created**

- Unit (`pnpm test`): `src/server/modules/agents/__tests__/{schedule,registry,handler-purity,config-guard,result,gate,budget,access,deal-label,cron-route,handler-check,validate-agent}.test.ts`, `src/server/rbac/__tests__/agent-grants.test.ts`, `src/server/modules/pipeline/__tests__/stage-entry-data.test.ts`, `src/lib/__tests__/{stage-progress,agent-labels,agents-href}.test.ts`, `src/server/modules/notifications/__tests__/agent-events.test.ts`.
- Integration (`pnpm test:integration`): `src/server/modules/agents/__tests__/{apply-changes,runner,tick,queries,actions}.itest.ts`, `src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts`, `src/server/modules/pipeline/__tests__/action-required-stages.itest.ts`, `src/server/modules/team/__tests__/agents-access.itest.ts`.

**Modified**

`prisma/schema.prisma` · `prisma/seed.ts` · `prisma/seed-clean.ts` · `src/server/rbac/matrix.ts` · `src/lib/nav.ts` · `src/lib/stage-history.ts` · `src/components/portal/deal-stage-timeline.tsx` · `src/components/portal/deal-stage-bar.tsx` · `src/app/portal/leads/[id]/page.tsx` · `src/server/modules/leads/actions.ts` · `src/server/modules/notifications/{types,actions,engine}.ts` · `src/server/modules/team/actions.ts` · `src/app/portal/team/[id]/page.tsx` · `vercel.json` · `package.json` · `pnpm-lock.yaml`

---

## Task 0: Isolated environment and baselines

**Files:**
- Modify: `.env` (worktree-local, gitignored)

- [ ] **Step 1: Point the worktree's dev database at its own schema**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git check-ignore -q .env && echo ".env is ignored"
sed -i '' 's#^DATABASE_URL=.*#DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=agents_dev"#' .env
grep '^DATABASE_URL' .env
```

Expected: `.env is ignored`, then `DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=agents_dev"`.

- [ ] **Step 2: Migrate and seed `agents_dev` from `main`'s migrations**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec prisma migrate deploy 2>&1 | tail -3
pnpm exec tsx prisma/seed.ts 2>&1 | tail -4
```

Expected: `All migrations have been successfully applied.` then `✅ Seed complete.`

- [ ] **Step 3: Record the unit baseline**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm test 2>&1 | tail -5
```

Expected: `Test Files  152 passed (152)` and `Tests  2334 passed (2334)`. Write the two numbers down; every later "all unit tests pass" means this count plus the tests this plan adds.

- [ ] **Step 4: Record the integration baseline on the isolated schema**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" pnpm test:integration 2>&1 | tail -8
```

Expected: a pass/fail summary. Write it down. Failures present here are pre-existing and are not this plan's to fix; later runs must not add to them.

- [ ] **Step 5: Create the shadow database used to generate migrations**

```bash
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -c 'CREATE DATABASE anexa_agents_shadow;'
```

Expected: `CREATE DATABASE` (or `already exists`, which is fine).

No commit: nothing tracked changed.

---

## Task 1: Cron schedule helpers

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/server/modules/agents/schedule.ts`
- Test: `src/server/modules/agents/__tests__/schedule.test.ts`

- [ ] **Step 1: Add croner**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm add croner@10.0.1 2>&1 | tail -3
grep '"croner"' package.json
```

Expected: `"croner": "10.0.1"` (or `^10.0.1`).

- [ ] **Step 2: Write the failing test**

```ts
// src/server/modules/agents/__tests__/schedule.test.ts
import { describe, it, expect } from "vitest";
import {
  SCHEDULE_PRESETS,
  describeSchedule,
  nextRunAfter,
  nextRunAtFor,
  nextRuns,
  validateSchedule,
} from "../schedule";

describe("validateSchedule", () => {
  it("accepts a 5-field expression and normalises its spacing", () => {
    expect(validateSchedule("  */15   * * * *  ")).toEqual({ ok: true, schedule: "*/15 * * * *" });
  });

  it("refuses 6- and 7-field patterns, which croner would read as seconds and years", () => {
    expect(validateSchedule("0 */15 * * * *").ok).toBe(false);
    expect(validateSchedule("0 0 12 * * * 2027").ok).toBe(false);
  });

  it("refuses an expression croner cannot parse", () => {
    const r = validateSchedule("61 * * * *");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a valid cron expression/i);
  });

  it("accepts every preset", () => {
    for (const p of SCHEDULE_PRESETS) expect(validateSchedule(p.schedule).ok).toBe(true);
  });
});

describe("next runs, in UTC", () => {
  it("rounds up to the next quarter hour", () => {
    const from = new Date("2026-09-15T14:07:30.000Z");
    expect(nextRunAfter("*/15 * * * *", from)?.toISOString()).toBe("2026-09-15T14:15:00.000Z");
  });

  it("skips a weekend for a weekday schedule", () => {
    // 2026-09-19 is a Saturday.
    const from = new Date("2026-09-19T00:00:00.000Z");
    expect(nextRunAfter("0 13 * * 1-5", from)?.toISOString()).toBe("2026-09-21T13:00:00.000Z");
  });

  it("lists the next three", () => {
    const from = new Date("2026-09-15T14:00:00.000Z");
    expect(nextRuns("0 * * * *", from, 3).map((d) => d.toISOString())).toEqual([
      "2026-09-15T15:00:00.000Z",
      "2026-09-15T16:00:00.000Z",
      "2026-09-15T17:00:00.000Z",
    ]);
  });

  it("is null for a broken expression rather than throwing", () => {
    expect(nextRunAfter("nope", new Date())).toBeNull();
  });
});

describe("nextRunAtFor", () => {
  const now = new Date("2026-09-15T14:07:00.000Z");

  it("is null unless the agent is enabled AND scheduled", () => {
    expect(nextRunAtFor({ enabled: false, schedule: "*/5 * * * *" }, now)).toBeNull();
    expect(nextRunAtFor({ enabled: true, schedule: null }, now)).toBeNull();
    expect(nextRunAtFor({ enabled: true, schedule: "*/5 * * * *" }, now)?.toISOString()).toBe(
      "2026-09-15T14:10:00.000Z"
    );
  });
});

describe("describeSchedule", () => {
  it("names presets, calls anything else custom, and says when there is none", () => {
    expect(describeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeSchedule("7 3 * * 2")).toBe("Custom");
    expect(describeSchedule(null)).toBe("Not scheduled");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/schedule.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Failed to resolve import "../schedule"`.

- [ ] **Step 4: Implement**

```ts
// src/server/modules/agents/schedule.ts
import { Cron } from "croner";

/**
 * Agent schedules: 5-field cron expressions, evaluated in UTC like every entry
 * in vercel.json.
 *
 * croner also accepts 6- and 7-field patterns (seconds, years). Those are
 * refused here rather than passed through: the tick runs once a minute, so a
 * seconds field would promise something the runner can never deliver.
 *
 * Every Cron is built `paused` — these objects only answer "when next", they
 * never schedule anything themselves.
 */

const OPTIONS = { paused: true, timezone: "UTC" } as const;

export const SCHEDULE_PRESETS = [
  { label: "Every 5 minutes", schedule: "*/5 * * * *" },
  { label: "Every 15 minutes", schedule: "*/15 * * * *" },
  { label: "Every 30 minutes", schedule: "*/30 * * * *" },
  { label: "Hourly", schedule: "0 * * * *" },
  { label: "Daily at 13:00 UTC", schedule: "0 13 * * *" },
  { label: "Weekdays at 13:00 UTC", schedule: "0 13 * * 1-5" },
] as const;

export function validateSchedule(
  expr: string
): { ok: true; schedule: string } | { ok: false; error: string } {
  const schedule = expr.trim().replace(/\s+/g, " ");
  if (schedule.split(" ").length !== 5) {
    return { ok: false, error: "Use a 5-field cron expression: minute hour day month weekday." };
  }
  try {
    const next = new Cron(schedule, OPTIONS).nextRun(new Date());
    if (!next) return { ok: false, error: "That schedule never runs." };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Not a valid cron expression: ${why}` };
  }
  return { ok: true, schedule };
}

/** The next run strictly after `from`, or null when the expression is unusable. */
export function nextRunAfter(schedule: string, from: Date): Date | null {
  try {
    return new Cron(schedule, OPTIONS).nextRun(from);
  } catch {
    return null;
  }
}

export function nextRuns(schedule: string, from: Date, n: number): Date[] {
  try {
    return new Cron(schedule, OPTIONS).nextRuns(n, from);
  } catch {
    return [];
  }
}

/**
 * The next runs from now. A named helper rather than `new Date()` at the call
 * site: the React purity lint rule refuses an impure call during render, and
 * the config form previews these while the user types.
 */
export function upcomingRuns(schedule: string, n: number): Date[] {
  return nextRuns(schedule, new Date(), n);
}

/** What `Agent.nextRunAt` should hold. */
export function nextRunAtFor(
  agent: { enabled: boolean; schedule: string | null },
  now: Date
): Date | null {
  return agent.enabled && agent.schedule ? nextRunAfter(agent.schedule, now) : null;
}

export function describeSchedule(schedule: string | null): string {
  if (!schedule) return "Not scheduled";
  return SCHEDULE_PRESETS.find((p) => p.schedule === schedule)?.label ?? "Custom";
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/schedule.test.ts 2>&1 | tail -5
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add package.json pnpm-lock.yaml src/server/modules/agents/schedule.ts src/server/modules/agents/__tests__/schedule.test.ts
git commit -m "feat(agents): a schedule is five cron fields in UTC, and says when it runs next" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The schema and the first migration

Every later task imports the generated Prisma types, so the tables land before any code that uses them.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260915120000_agents_control_plane/migration.sql` (generated)

- [ ] **Step 1: Add the two notification events**

In `prisma/schema.prisma`, inside `enum NotificationEvent`, replace:

```prisma
  automation_failed
}
```

with:

```prisma
  automation_failed
  agent_run_failed
  agent_needs_human
}
```

- [ ] **Step 2: Add the back-relations**

Inside `model Company`, directly after the line `  automationRuns           AutomationRun[]`, add:

```prisma
  agents                   Agent[]
  agentRuns                AgentRun[]
```

Inside `model User`, directly after the line `  stageMoves      LeadStageEvent[]     @relation("LeadStageEventMovedBy")`, add:

```prisma
  agentsUpdated      Agent[]    @relation("AgentUpdatedBy")
  agentRunsTriggered AgentRun[] @relation("AgentRunTriggeredBy")
  agentRunsResolved  AgentRun[] @relation("AgentRunResolvedBy")
```

Inside `model Lead`, directly after the line `  automationRuns         AutomationRun[]`, add:

```prisma
  agentRuns              AgentRun[]
```

In `model LeadStageEvent`, replace the `via` doc comment:

```prisma
  /// Why no person is named: "automation" (a rule moved it) or "signature" (the
  /// homeowner's signature did). Null on a person's move.
```

with:

```prisma
  /// Why no person is named: "automation" (a rule moved it), "signature" (the
  /// homeowner's signature did) or "agent" (an agent's change passed the human
  /// gate on its own). Null on a person's move.
```

- [ ] **Step 3: Append the enums and models to the end of the file**

```prisma

// ---------------------------------------------------------------------------
// Agents: back-office automation, registered as rows and run on a clock.
// See docs/superpowers/specs/2026-09-15-agents-control-plane-design.md.
// Both models are SHARED (not in src/server/vertical/models.ts): pages filter by
// the viewer's workspaces, and every handler executes inside runInVertical.
// ---------------------------------------------------------------------------

enum AgentDepartment {
  permit
  operations
  accounting
  sales_escalation
}

enum AgentRunTrigger {
  scheduled
  manual
  event
}

enum AgentRunStatus {
  queued
  running
  success
  failed
  needs_human
}

enum AgentRunResolution {
  applied
  closed
}

/// One registered agent: which handler runs, for which product, on what
/// clock, with what settings. A row, not a page.
model Agent {
  id                String          @id @default(uuid())
  companyId         String
  company           Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name              String
  description       String          @default("")
  /// Key into the handler registry, e.g. "bank.ntp_poll".
  handlerKey        String
  /// "Product" in the UI. NULL = both Roofing and Solar. `others` is refused on save.
  vertical          Vertical?
  department        AgentDepartment
  /// Scheduling only. A disabled agent can still be run by hand, after a confirmation.
  enabled           Boolean         @default(false)
  /// 5-field cron, UTC. NULL = never on the clock (manual or event only).
  schedule          String?
  /// When the tick next picks it up. NULL unless enabled AND scheduled.
  nextRunAt         DateTime?
  /// Ceiling for one run, 5–240 seconds.
  timeoutSeconds    Int             @default(60)
  /// Handler settings. References to secrets only, never secret values.
  config            Json            @default("{}")
  /// True: the agent may flag work, but may move a deal only into an
  /// isActionRequired stage.
  requiresHumanGate Boolean         @default(true)
  updatedById       String?
  updatedBy         User?           @relation("AgentUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  runs AgentRun[]

  @@unique([companyId, name])
  @@index([enabled, nextRunAt])
  @@map("agents")
}

/// One execution of one agent in one workspace. Written for every run —
/// successes, failures, no-ops, and the ones a human has to finish.
/// This table is the audit trail.
model AgentRun {
  id             String              @id @default(uuid())
  companyId      String
  company        Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  /// NoAction: an agent with history cannot be deleted (disable it instead),
  /// while deleting a company still cascades through both tables.
  agentId        String
  agent          Agent               @relation(fields: [agentId], references: [id], onDelete: NoAction)
  /// The deal, when the whole run is about one. SetNull: deleting a deal must
  /// not erase the record of what an agent did to it.
  leadId         String?
  lead           Lead?               @relation(fields: [leadId], references: [id], onDelete: SetNull)
  /// Customer name and address as they read at run time.
  leadLabel      String?
  /// The workspace this run executed in. A "both" agent writes one run per workspace.
  vertical       Vertical
  trigger        AgentRunTrigger
  status         AgentRunStatus
  triggeredById  String?
  triggeredBy    User?               @relation("AgentRunTriggeredBy", fields: [triggeredById], references: [id], onDelete: SetNull)
  createdAt      DateTime            @default(now())
  startedAt      DateTime?
  finishedAt     DateTime?
  summary        String              @default("")
  detail         Json                @default("{}")
  /// Full error text and stack.
  error          String?
  resolvedById   String?
  resolvedBy     User?               @relation("AgentRunResolvedBy", fields: [resolvedById], references: [id], onDelete: SetNull)
  resolvedAt     DateTime?
  resolution     AgentRunResolution?
  resolutionNote String?

  @@index([companyId, createdAt])
  @@index([companyId, status, createdAt])
  @@index([agentId, createdAt])
  @@index([agentId, vertical, status])
  @@index([status, startedAt])
  @@map("agent_runs")
}
```

- [ ] **Step 4: Format and validate**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec prisma format 2>&1 | tail -1
pnpm exec prisma validate 2>&1 | tail -1
```

Expected: `Formatted prisma/schema.prisma …` then `The schema at prisma/schema.prisma is valid 🚀`.

- [ ] **Step 5: Generate the migration from the schema**

`main`'s migrations and schema agreed exactly on 2026-09-15 (the same diff printed `-- This is an empty migration.`), so everything generated here is this task's.

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
F=prisma/migrations/20260915120000_agents_control_plane/migration.sql
mkdir -p "$(dirname "$F")"
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://anexa:anexa@127.0.0.1:5544/anexa_agents_shadow" \
  --script > "$F"
for p in "ADD VALUE" "CREATE TYPE" "CREATE TABLE" "INDEX" "ADD CONSTRAINT"; do printf '%-15s %s\n' "$p" "$(grep -c "$p" "$F")"; done
grep -v -i -E 'agent|^--|^\s*$|^\s+"|^\s*CONSTRAINT|^\);?$' "$F" || echo "only agent statements"
```

Expected:

```
ADD VALUE       2
CREATE TYPE     4
CREATE TABLE    2
INDEX           7
ADD CONSTRAINT  7
only agent statements
```

If any other line prints (a `BEGIN;`, a statement on another table), stop: the schema and migrations have drifted, and that is not this task's to ship.

- [ ] **Step 6: Apply it to `agents_dev` and regenerate the client**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec prisma migrate deploy 2>&1 | grep -E "Applying|applied|Error"
pnpm exec prisma generate 2>&1 | grep -E "Generated|Error"
```

Expected: `Applying migration `20260915120000_agents_control_plane``, `All migrations have been successfully applied.`, `✔ Generated Prisma Client`.

- [ ] **Step 7: Prove the schema and the migrations agree again**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://anexa:anexa@127.0.0.1:5544/anexa_agents_shadow" --script 2>/dev/null | head -1
```

Expected: `-- This is an empty migration.`

- [ ] **Step 8: Typecheck and unit tests**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm test 2>&1 | tail -4
```

Expected: `typecheck exit=0`; tests are the baseline plus Task 1's 10, all passing.

- [ ] **Step 9: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add prisma/schema.prisma prisma/migrations/20260915120000_agents_control_plane/migration.sql
git commit -m "feat(agents): agents and agent_runs tables, and two notification events" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The handler contract, the Hello handler, the registry

**Files:**
- Create: `src/server/modules/agents/handler-keys.ts`, `src/server/modules/agents/types.ts`, `src/server/modules/agents/handlers/system-hello.ts`, `src/server/modules/agents/registry.ts`
- Test: `src/server/modules/agents/__tests__/registry.test.ts`, `src/server/modules/agents/__tests__/handler-purity.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/modules/agents/__tests__/registry.test.ts
import { describe, it, expect } from "vitest";
import { HANDLER_KEYS, isHandlerKey } from "../handler-keys";
import { HANDLERS, handlerFor, handlerOptions } from "../registry";
import type { AgentContext, AgentDeps } from "../types";

const fakeDeps = (now: Date): AgentDeps => ({
  now: () => now,
  secrets: { get: async () => null },
  deals: { get: async () => null, inStages: async () => [] },
});

describe("handler registry", () => {
  it("holds exactly the listed keys, each handler naming itself with its own key", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...HANDLER_KEYS].sort());
    for (const key of HANDLER_KEYS) expect(HANDLERS[key].key).toBe(key);
  });

  it("answers null for a key nobody registered", () => {
    expect(handlerFor("bank.ntp_poll")).toBeNull();
    expect(isHandlerKey("bank.ntp_poll")).toBe(false);
    expect(handlerFor("system.hello")?.key).toBe("system.hello");
  });

  it("offers every handler to the picker", () => {
    expect(handlerOptions()).toContainEqual({ value: "system.hello", label: "Hello (test agent)" });
  });
});

describe("system.hello", () => {
  const hello = HANDLERS["system.hello"];

  it("takes no settings", () => {
    expect(hello.parseConfig({})).toEqual({ ok: true, config: {} });
    expect(hello.parseConfig({ anything: 1 }).ok).toBe(false);
    expect(hello.parseConfig([]).ok).toBe(false);
    expect(hello.parseConfig(null).ok).toBe(false);
  });

  it("logs hello and succeeds without asking for any change", async () => {
    const lines: string[] = [];
    const now = new Date("2026-09-15T14:00:00.000Z");
    const ctx: AgentContext<Record<string, never>> = {
      companyId: "c",
      vertical: "roofing",
      runId: "r",
      trigger: "manual",
      leadId: null,
      config: {},
      signal: new AbortController().signal,
      log: (line) => lines.push(line),
      deps: fakeDeps(now),
    };
    const result = await hello.run(ctx);
    expect(lines).toEqual(["hello"]);
    expect(result).toEqual({
      status: "success",
      summary: "Said hello",
      detail: { greeting: "hello", at: "2026-09-15T14:00:00.000Z" },
    });
  });
});
```

```ts
// src/server/modules/agents/__tests__/handler-purity.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Handlers never write. They read through `ctx.deps` and RETURN the changes
 * they want, so the gate lives in one place (the runner) and every handler can
 * be tested with fakes.
 *
 * This guard is what makes "never" true: a handler that imports the database
 * client, a server module, or Next itself has a way to write that bypasses the
 * gate. Type-only imports are fine.
 */

const DIR = join(__dirname, "..", "handlers");

const FORBIDDEN: { re: RegExp; what: string }[] = [
  { re: /from\s+["']@\/server\//, what: "a server module (reach the world through ctx.deps)" },
  { re: /^import\s+(?!type\b)[^;]*from\s+["']@prisma\/client["']/m, what: "a runtime value from @prisma/client" },
  { re: /from\s+["']next(\/|["'])/, what: "Next.js" },
];

describe("agent handler purity", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("finds the handler files", () => {
    // If the directory moved, every case below would pass vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} imports nothing that can write`, () => {
      const src = readFileSync(join(DIR, file), "utf8");
      for (const rule of FORBIDDEN) {
        expect(rule.re.test(src), `${file} imports ${rule.what}`).toBe(false);
      }
    });
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/registry.test.ts src/server/modules/agents/__tests__/handler-purity.test.ts 2>&1 | tail -6
```

Expected: FAIL — unresolved `../handler-keys`, and `ENOENT` on the `handlers` directory.

- [ ] **Step 3: Implement the key list**

```ts
// src/server/modules/agents/handler-keys.ts
/**
 * Every handler key the code knows about.
 *
 * No imports, on purpose: the production build's check
 * (scripts/check-agent-handlers.ts) reads this file alone, before any server
 * module can load. registry.ts is typed against this list with `satisfies`, so
 * adding a key without a handler — or a handler without a key — fails the type
 * check inside `next build`.
 */
export const HANDLER_KEYS = ["system.hello"] as const;

export type HandlerKey = (typeof HANDLER_KEYS)[number];

export function isHandlerKey(value: unknown): value is HandlerKey {
  return typeof value === "string" && (HANDLER_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Implement the types**

```ts
// src/server/modules/agents/types.ts
import type { AgentRunTrigger, BlockerParty, StageType } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";
import type { HandlerKey } from "./handler-keys";

/**
 * The contract every agent handler implements, and the shapes the runner
 * records about what one did. Types only — safe to import from a handler, a
 * client component, or a test.
 */

export type ParseResult<C> = { ok: true; config: C } | { ok: false; error: string };

export type DealSnapshot = {
  id: string;
  /** Customer name and address. */
  label: string;
  stageKey: string | null;
  stageName: string | null;
  stageChangedAt: Date | null;
};

/** Every door to the outside world. Tests pass fakes; portal clients join here later. */
export type AgentDeps = {
  now(): Date;
  secrets: { get(ref: string): Promise<string | null> };
  deals: {
    get(leadId: string): Promise<DealSnapshot | null>;
    inStages(stageKeys: string[], opts?: { limit?: number }): Promise<DealSnapshot[]>;
  };
};

export type AgentContext<C> = {
  companyId: string;
  vertical: ActiveVertical;
  runId: string;
  trigger: AgentRunTrigger;
  /** Set when the run is about one deal; null for a sweep. */
  leadId: string | null;
  config: C;
  /** Aborted when the run times out. Long I/O must honour it. */
  signal: AbortSignal;
  /** Appends a line to detail.log. */
  log(line: string): void;
  deps: AgentDeps;
};

export type RequestedChange = {
  type: "move_stage";
  leadId: string;
  /** A key in the deal's OWN pipeline, so a roofing key can never move a solar deal. */
  toStageKey: string;
  reason: string;
};

export type AgentResult = {
  status: "success" | "failed" | "needs_human";
  /** One line, e.g. "Submitted NTP for deal 4821". Truncated to 280 characters. */
  summary: string;
  detail?: Record<string, unknown>;
  changes?: RequestedChange[];
  error?: string;
};

/**
 * Declared with METHOD syntax on purpose. Method parameters are checked
 * bivariantly, which is what lets a registry typed `AgentHandler` (config
 * `unknown`) hold handlers with specific config types.
 */
export type AgentHandler<C = unknown> = {
  key: HandlerKey;
  /** Shown in the handler picker. */
  label: string;
  /** Validates Agent.config. Runs on save, and again before every run. */
  parseConfig(raw: unknown): ParseResult<C>;
  run(ctx: AgentContext<C>): Promise<AgentResult>;
};

export type StageRef = { id: string; key: string; name: string };

export type TargetStage = StageRef & {
  position: number;
  isActionRequired: boolean;
  defaultBlocker: BlockerParty | null;
  stageType: StageType;
};

export type ResolvedChange = {
  change: RequestedChange;
  lead: { id: string; label: string } | null;
  fromStage: StageRef | null;
  toStage: TargetStage | null;
};

export type ChangeOutcome = "applied" | "noop" | "held" | "discarded" | "invalid";

export type ChangeRecord = RequestedChange & {
  dealLabel: string | null;
  fromStage: StageRef | null;
  toStage: TargetStage | null;
  outcome: ChangeOutcome;
  note: string | null;
};

/** What `AgentRun.detail` holds. */
export type RunDetail = {
  handlerKey: string;
  configSnapshot: unknown;
  gated: boolean;
  durationMs: number | null;
  log: string[];
  handler: Record<string, unknown> | null;
  changes: ChangeRecord[];
  resolution: { byUserId: string; at: string; changes: ChangeRecord[] } | null;
  lateResult: unknown;
};
```

- [ ] **Step 5: Implement the Hello handler**

```ts
// src/server/modules/agents/handlers/system-hello.ts
import type { AgentHandler } from "../types";

type HelloConfig = Record<string, never>;

/**
 * The control plane's test agent. It proves the loop — registry, runner, run
 * log, pages — end to end, with nothing outside the app involved.
 */
export const systemHelloHandler: AgentHandler<HelloConfig> = {
  key: "system.hello",
  label: "Hello (test agent)",

  parseConfig(raw) {
    const isEmptyObject =
      raw !== null && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length === 0;
    return isEmptyObject
      ? { ok: true, config: {} }
      : { ok: false, error: "The Hello agent takes no settings. Its config must be {}." };
  },

  async run(ctx) {
    ctx.log("hello");
    return {
      status: "success",
      summary: "Said hello",
      detail: { greeting: "hello", at: ctx.deps.now().toISOString() },
    };
  },
};
```

- [ ] **Step 6: Implement the registry**

```ts
// src/server/modules/agents/registry.ts
import type { HandlerKey } from "./handler-keys";
import type { AgentHandler } from "./types";
import { systemHelloHandler } from "./handlers/system-hello";

/**
 * The only file that knows about every handler. Adding an agent is a handler
 * module, its key in handler-keys.ts, and one line here — then a row in
 * `agents` from the Agents page.
 */
export const HANDLERS = {
  "system.hello": systemHelloHandler,
} satisfies Record<HandlerKey, AgentHandler>;

export function handlerFor(key: string): AgentHandler | null {
  return (HANDLERS as Record<string, AgentHandler>)[key] ?? null;
}

export function handlerOptions(): { value: string; label: string }[] {
  return (Object.values(HANDLERS) as AgentHandler[]).map((h) => ({ value: h.key, label: h.label }));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/registry.test.ts src/server/modules/agents/__tests__/handler-purity.test.ts 2>&1 | tail -6
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -c "src/server/modules/agents" || true
```

Expected: PASS (5 + 2 tests); the grep count prints `0`.

- [ ] **Step 8: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/handler-keys.ts src/server/modules/agents/types.ts src/server/modules/agents/handlers/system-hello.ts src/server/modules/agents/registry.ts src/server/modules/agents/__tests__/registry.test.ts src/server/modules/agents/__tests__/handler-purity.test.ts
git commit -m "feat(agents): a handler is a key and a module, and it can only ask for changes" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Config guard, result validation, run detail

**Files:**
- Create: `src/server/modules/agents/config-guard.ts`, `src/server/modules/agents/result.ts`, `src/server/modules/agents/detail.ts`
- Test: `src/server/modules/agents/__tests__/config-guard.test.ts`, `src/server/modules/agents/__tests__/result.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/modules/agents/__tests__/config-guard.test.ts
import { describe, it, expect } from "vitest";
import { findSecretValues, keyNamesSecret, parseSecretRef, readEnvRef } from "../config-guard";

const LENDER = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

describe("parseSecretRef", () => {
  it("reads an AGENT_ env reference and a lender reference", () => {
    expect(parseSecretRef("env:AGENT_BANK_PASSWORD")).toEqual({ kind: "env", name: "AGENT_BANK_PASSWORD" });
    expect(parseSecretRef(`lender:${LENDER}`)).toEqual({ kind: "lender", lenderId: LENDER });
  });

  it("refuses an env var outside the AGENT_ prefix", () => {
    expect(parseSecretRef("env:AUTH_SECRET")).toBeNull();
    expect(parseSecretRef("env:CRON_SECRET")).toBeNull();
  });

  it("refuses anything else", () => {
    expect(parseSecretRef("hunter2")).toBeNull();
    expect(parseSecretRef("lender:not-a-uuid")).toBeNull();
    expect(parseSecretRef("vault:abc")).toBeNull();
  });
});

describe("keyNamesSecret", () => {
  it("matches whole words inside camelCase and snake_case keys", () => {
    for (const key of ["password", "portalPassword", "api_key", "apiKey", "clientSecret", "mfaSeed", "otp", "accessToken", "credentials"]) {
      expect(keyNamesSecret(key), key).toBe(true);
    }
  });

  it("does not trip on words that merely contain the letters", () => {
    for (const key of ["footprint", "bypass", "passport", "tokenizerMode", "keyboard", "stages"]) {
      expect(keyNamesSecret(key), key).toBe(false);
    }
  });
});

describe("findSecretValues", () => {
  it("allows a config with no secret-looking keys", () => {
    expect(findSecretValues({ stages: ["ntp_submitted_9"], maxDeals: 20 })).toBeNull();
  });

  it("refuses a secret value at any depth", () => {
    expect(findSecretValues({ portal: { password: "hunter2" } })).toMatch(/config\.portal\.password/);
    expect(findSecretValues({ logins: [{ apiKey: "sk-live" }] })).toMatch(/config\.logins\[0\]\.apiKey/);
  });

  it("allows a Ref key holding a valid reference, and refuses one holding a value", () => {
    expect(findSecretValues({ passwordRef: "env:AGENT_BANK_PASSWORD" })).toBeNull();
    expect(findSecretValues({ credentialsRef: `lender:${LENDER}` })).toBeNull();
    expect(findSecretValues({ passwordRef: "hunter2" })).toMatch(/must be a reference/);
  });
});

describe("readEnvRef", () => {
  it("returns the value, or null when unset or blank", () => {
    expect(readEnvRef("AGENT_X", { AGENT_X: "v" })).toBe("v");
    expect(readEnvRef("AGENT_X", { AGENT_X: "  " })).toBeNull();
    expect(readEnvRef("AGENT_X", {})).toBeNull();
  });
});
```

```ts
// src/server/modules/agents/__tests__/result.test.ts
import { describe, it, expect } from "vitest";
import { SUMMARY_MAX, parseAgentResult, truncateSummary } from "../result";
import { emptyDetail, errorText, missingHandlerMessage, readDetail } from "../detail";

const LEAD = "0b8f5a8e-2f1e-4d7c-9a6b-1c2d3e4f5a6b";

describe("parseAgentResult", () => {
  it("accepts a well-formed result", () => {
    const r = parseAgentResult({
      status: "needs_human",
      summary: "Stipulation on NTP",
      detail: { observed: "stip" },
      changes: [{ type: "move_stage", leadId: LEAD, toStageKey: "ntp_action_required_10", reason: "stip" }],
    });
    expect(r.ok).toBe(true);
  });

  it("refuses an unknown status, a missing summary, or a malformed change", () => {
    expect(parseAgentResult({ status: "done", summary: "x" }).ok).toBe(false);
    expect(parseAgentResult({ status: "success" }).ok).toBe(false);
    const bad = parseAgentResult({
      status: "success",
      summary: "x",
      changes: [{ type: "delete_deal", leadId: LEAD, toStageKey: "x", reason: "" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/invalid result/i);
  });

  it("refuses a non-object", () => {
    expect(parseAgentResult(undefined).ok).toBe(false);
  });

  it("truncates a long summary", () => {
    const r = parseAgentResult({ status: "success", summary: "x".repeat(400) });
    expect(r.ok && r.result.summary.length).toBe(SUMMARY_MAX);
    expect(truncateSummary("short")).toBe("short");
  });
});

describe("run detail", () => {
  it("starts empty from the agent it ran", () => {
    expect(emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true })).toEqual({
      handlerKey: "system.hello",
      configSnapshot: {},
      gated: true,
      durationMs: null,
      log: [],
      handler: null,
      changes: [],
      resolution: null,
      lateResult: null,
    });
  });

  it("normalises whatever was stored", () => {
    const d = readDetail({ handlerKey: "k", log: ["a", 1], durationMs: "x" });
    expect(d.log).toEqual(["a", "1"]);
    expect(d.durationMs).toBeNull();
    expect(d.changes).toEqual([]);
    expect(readDetail(null).handlerKey).toBe("");
  });

  it("keeps a stack when there is one", () => {
    const err = new Error("boom");
    expect(errorText(err)).toContain("boom");
    expect(errorText("plain")).toBe("plain");
  });

  it("says what to do about a missing handler", () => {
    expect(missingHandlerMessage("bank.ntp_poll")).toBe(
      'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.'
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/config-guard.test.ts src/server/modules/agents/__tests__/result.test.ts 2>&1 | tail -6
```

Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement the config guard**

```ts
// src/server/modules/agents/config-guard.ts
/**
 * Agent config holds REFERENCES to secrets, never secret values.
 *
 * `CompanySettings.bookkeepingApiKey` is stored in plaintext; this is the guard
 * that stops agent config from repeating that. A key that names a secret must
 * end in `Ref` and hold a reference this module can parse.
 */

export type SecretRef = { kind: "env"; name: string } | { kind: "lender"; lenderId: string };

const ENV_REF = /^env:(AGENT_[A-Z0-9_]+)$/;
const LENDER_REF = /^lender:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * `env:` is limited to AGENT_-prefixed variables so a config can never point a
 * handler at AUTH_SECRET, CRON_SECRET, or any other key the app itself runs on.
 */
export function parseSecretRef(ref: string): SecretRef | null {
  const env = ENV_REF.exec(ref);
  if (env) return { kind: "env", name: env[1] };
  const lender = LENDER_REF.exec(ref);
  if (lender) return { kind: "lender", lenderId: lender[1] };
  return null;
}

export function readEnvRef(name: string, env: Record<string, string | undefined>): string | null {
  const value = env[name];
  return value && value.trim() ? value : null;
}

const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "passcode",
  "secret",
  "token",
  "credential",
  "credentials",
  "otp",
  "totp",
  "mfa",
  "apikey",
]);

/** "portalApiKey" → ["portal", "api", "key"]; "client_secret" → ["client", "secret"]. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** True when the key names a secret as a whole word — "footprint" is not "otp". */
export function keyNamesSecret(key: string): boolean {
  const w = words(key);
  if (w.some((x) => SECRET_WORDS.has(x))) return true;
  return w.some((x, i) => x === "api" && w[i + 1] === "key");
}

/** The first place `config` holds a secret value, as a message; null when clean. */
export function findSecretValues(config: unknown, path = "config"): string | null {
  if (Array.isArray(config)) {
    for (let i = 0; i < config.length; i++) {
      const hit = findSecretValues(config[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (config === null || typeof config !== "object") return null;

  for (const [key, value] of Object.entries(config)) {
    const here = `${path}.${key}`;
    if (keyNamesSecret(key)) {
      const w = words(key);
      if (w[w.length - 1] !== "ref") {
        return `${here} looks like a secret. Store a reference instead: a key ending in "Ref" holding env:AGENT_NAME or lender:<id>.`;
      }
      if (typeof value !== "string" || !parseSecretRef(value)) {
        return `${here} must be a reference: env:AGENT_NAME or lender:<id>.`;
      }
      continue;
    }
    const hit = findSecretValues(value, here);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Implement result validation**

```ts
// src/server/modules/agents/result.ts
import { z } from "zod";
import type { AgentResult } from "./types";

export const SUMMARY_MAX = 280;

const changeSchema = z.object({
  type: z.literal("move_stage"),
  leadId: z.string().uuid(),
  toStageKey: z.string().min(1).max(200),
  reason: z.string().max(1000),
});

const resultSchema = z.object({
  status: z.enum(["success", "failed", "needs_human"]),
  summary: z.string(),
  detail: z.record(z.unknown()).optional(),
  changes: z.array(changeSchema).max(500).optional(),
  error: z.string().optional(),
});

export function truncateSummary(summary: string): string {
  return summary.length <= SUMMARY_MAX ? summary : `${summary.slice(0, SUMMARY_MAX - 1)}…`;
}

/** A handler is code, but its result is still input: nothing it returns is trusted unparsed. */
export function parseAgentResult(
  raw: unknown
): { ok: true; result: AgentResult } | { ok: false; error: string } {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(result)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Handler returned an invalid result — ${issues}` };
  }
  return { ok: true, result: { ...parsed.data, summary: truncateSummary(parsed.data.summary) } };
}
```

- [ ] **Step 5: Implement run detail helpers**

```ts
// src/server/modules/agents/detail.ts
import type { RunDetail } from "./types";

export function emptyDetail(agent: {
  handlerKey: string;
  config: unknown;
  requiresHumanGate: boolean;
}): RunDetail {
  return {
    handlerKey: agent.handlerKey,
    configSnapshot: agent.config ?? {},
    gated: agent.requiresHumanGate,
    durationMs: null,
    log: [],
    handler: null,
    changes: [],
    resolution: null,
    lateResult: null,
  };
}

/** Whatever is in the column, as a RunDetail — old or partial rows included. */
export function readDetail(raw: unknown): RunDetail {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<RunDetail>;
  return {
    handlerKey: typeof o.handlerKey === "string" ? o.handlerKey : "",
    configSnapshot: o.configSnapshot ?? {},
    gated: o.gated === true,
    durationMs: typeof o.durationMs === "number" ? o.durationMs : null,
    log: Array.isArray(o.log) ? o.log.map((l) => String(l)) : [],
    handler: o.handler && typeof o.handler === "object" ? o.handler : null,
    changes: Array.isArray(o.changes) ? o.changes : [],
    resolution: o.resolution ?? null,
    lateResult: o.lateResult ?? null,
  };
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}

export function missingHandlerMessage(handlerKey: string): string {
  return `No handler is registered for "${handlerKey}". Deploy the handler or disable this agent.`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/config-guard.test.ts src/server/modules/agents/__tests__/result.test.ts 2>&1 | tail -6
```

Expected: PASS (9 + 8 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/config-guard.ts src/server/modules/agents/result.ts src/server/modules/agents/detail.ts src/server/modules/agents/__tests__/config-guard.test.ts src/server/modules/agents/__tests__/result.test.ts
git commit -m "feat(agents): config holds references to secrets, and a handler's result is checked before it is believed" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Gate, budget, timeout, workspaces

**Files:**
- Create: `src/server/modules/agents/gate.ts`, `src/server/modules/agents/budget.ts`, `src/server/modules/agents/timeout.ts`, `src/server/modules/agents/verticals.ts`
- Test: `src/server/modules/agents/__tests__/gate.test.ts`, `src/server/modules/agents/__tests__/budget.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/modules/agents/__tests__/gate.test.ts
import { describe, it, expect } from "vitest";
import { decideChange, discardAll, finalStatus, planChanges } from "../gate";
import { agentRunVerticals, agentVisibleTo, viewerRunVerticals } from "../verticals";
import type { RequestedChange, ResolvedChange, TargetStage } from "../types";

const LEAD = "0b8f5a8e-2f1e-4d7c-9a6b-1c2d3e4f5a6b";
const change: RequestedChange = { type: "move_stage", leadId: LEAD, toStageKey: "to", reason: "why" };
const from = { id: "s1", key: "from", name: "NTP Submitted" };
const target = (over: Partial<TargetStage> = {}): TargetStage => ({
  id: "s2",
  key: "to",
  name: "NTP Action Required",
  position: 3,
  isActionRequired: true,
  defaultBlocker: null,
  stageType: "internally_owned",
  ...over,
});
const resolved = (over: Partial<ResolvedChange> = {}): ResolvedChange => ({
  change,
  lead: { id: LEAD, label: "Maria Lopez · 12 Elm St" },
  fromStage: from,
  toStage: target(),
  ...over,
});

describe("decideChange", () => {
  it.each([
    [{ alreadyInTarget: true, requiresHumanGate: true, targetIsActionRequired: false }, "noop"],
    [{ alreadyInTarget: false, requiresHumanGate: true, targetIsActionRequired: false }, "held"],
    [{ alreadyInTarget: false, requiresHumanGate: true, targetIsActionRequired: true }, "applied"],
    [{ alreadyInTarget: false, requiresHumanGate: false, targetIsActionRequired: false }, "applied"],
    [{ alreadyInTarget: false, requiresHumanGate: false, targetIsActionRequired: true }, "applied"],
  ] as const)("%o → %s", (input, expected) => {
    expect(decideChange(input)).toBe(expected);
  });
});

describe("planChanges", () => {
  it("applies a move into an action-required stage even when gated", () => {
    const [c] = planChanges([resolved()], true);
    expect(c.outcome).toBe("applied");
    expect(c.dealLabel).toBe("Maria Lopez · 12 Elm St");
    expect(c.fromStage).toEqual(from);
  });

  it("holds a gated move onto the main line, and says why", () => {
    const [c] = planChanges([resolved({ toStage: target({ isActionRequired: false, name: "NTP Approved" }) })], true);
    expect(c.outcome).toBe("held");
    expect(c.note).toMatch(/NTP Approved is not an Action Required stage/);
  });

  it("is a noop when the deal is already there", () => {
    const [c] = planChanges([resolved({ fromStage: { id: "s2", key: "to", name: "NTP Action Required" } })], true);
    expect(c.outcome).toBe("noop");
  });

  it("marks a missing deal or stage invalid, and discards every change that would have applied", () => {
    const planned = planChanges([resolved({ lead: null }), resolved()], false);
    expect(planned.map((c) => c.outcome)).toEqual(["invalid", "discarded"]);
    const noStage = planChanges([resolved({ toStage: null })], false);
    expect(noStage[0].note).toMatch(/No stage "to"/);
  });
});

describe("discardAll and finalStatus", () => {
  it("records every change as discarded with the reason", () => {
    const [c] = discardAll([change], "handler failed");
    expect(c).toMatchObject({ outcome: "discarded", note: "handler failed", dealLabel: null });
  });

  it("failed beats needs_human beats success", () => {
    const held = planChanges([resolved({ toStage: target({ isActionRequired: false }) })], true);
    const invalid = planChanges([resolved({ lead: null })], true);
    const applied = planChanges([resolved()], true);
    expect(finalStatus("success", applied)).toBe("success");
    expect(finalStatus("success", held)).toBe("needs_human");
    expect(finalStatus("needs_human", applied)).toBe("needs_human");
    expect(finalStatus("success", invalid)).toBe("failed");
    expect(finalStatus("failed", held)).toBe("failed");
  });
});

describe("workspaces", () => {
  it("a both-agent runs in every live workspace; a scoped one only in its own, if live", () => {
    expect(agentRunVerticals(null, ["roofing", "solar"])).toEqual(["roofing", "solar"]);
    expect(agentRunVerticals("solar", ["roofing", "solar"])).toEqual(["solar"]);
    expect(agentRunVerticals("solar", ["roofing"])).toEqual([]);
    expect(agentRunVerticals("others", ["roofing", "solar"])).toEqual([]);
  });

  it("Run now narrows to the workspaces the viewer holds", () => {
    expect(viewerRunVerticals(null, ["roofing", "solar"], ["roofing"])).toEqual(["roofing"]);
  });

  it("a both-agent is visible to everyone; a scoped one to holders of its workspace", () => {
    expect(agentVisibleTo(null, ["roofing"])).toBe(true);
    expect(agentVisibleTo("solar", ["roofing"])).toBe(false);
    expect(agentVisibleTo("solar", ["roofing", "solar"])).toBe(true);
  });
});
```

```ts
// src/server/modules/agents/__tests__/budget.test.ts
import { describe, it, expect } from "vitest";
import {
  APPLY_DEADLINE_MS,
  CRON_MAX_DURATION_SECONDS,
  HANDLER_BUDGET_MS,
  MAX_RUNS_PER_TICK,
  MAX_TIMEOUT_SECONDS,
  MIN_START_MS,
  canStart,
  handlerDeadlineMs,
  pastApplyDeadline,
} from "../budget";
import { withTimeout } from "../timeout";

describe("tick budget", () => {
  it("fits five concurrent 240 s runs, their apply and their finalise inside the 300 s function", () => {
    expect(MAX_RUNS_PER_TICK).toBe(5);
    expect(MAX_TIMEOUT_SECONDS * 1000).toBeLessThanOrEqual(HANDLER_BUDGET_MS);
    expect(HANDLER_BUDGET_MS).toBeLessThan(APPLY_DEADLINE_MS);
    expect(APPLY_DEADLINE_MS).toBeLessThan(CRON_MAX_DURATION_SECONDS * 1000);
  });

  it("a handler gets its own timeout, cut short by time already spent in the tick", () => {
    expect(handlerDeadlineMs(240, 0, 0)).toBe(240_000);
    expect(handlerDeadlineMs(240, 0, 10_000)).toBe(230_000);
    expect(handlerDeadlineMs(60, 0, 10_000)).toBe(60_000);
    expect(handlerDeadlineMs(60, 0, 0, 200)).toBe(200);
  });

  it("does not start a run with under five seconds left", () => {
    const left = handlerDeadlineMs(60, 0, HANDLER_BUDGET_MS - 4_000);
    expect(left).toBe(4_000);
    expect(canStart(left)).toBe(false);
    expect(canStart(MIN_START_MS)).toBe(true);
  });

  it("stops applying changes after the apply deadline", () => {
    expect(pastApplyDeadline(0, APPLY_DEADLINE_MS)).toBe(false);
    expect(pastApplyDeadline(0, APPLY_DEADLINE_MS + 1)).toBe(true);
  });
});

describe("withTimeout", () => {
  it("returns the value", async () => {
    const c = new AbortController();
    await expect(withTimeout(async () => 42, 1_000, c)).resolves.toEqual({ kind: "result", value: 42 });
    expect(c.signal.aborted).toBe(false);
  });

  it("catches a synchronous or async throw", async () => {
    const c = new AbortController();
    const sync = await withTimeout(() => {
      throw new Error("sync");
    }, 1_000, c);
    expect(sync.kind).toBe("threw");
    const asyncThrow = await withTimeout(async () => Promise.reject(new Error("async")), 1_000, c);
    expect(asyncThrow.kind).toBe("threw");
  });

  it("gives up at the deadline and aborts the signal", async () => {
    const c = new AbortController();
    const r = await withTimeout(() => new Promise(() => {}), 20, c);
    expect(r).toEqual({ kind: "timeout" });
    expect(c.signal.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/gate.test.ts src/server/modules/agents/__tests__/budget.test.ts 2>&1 | tail -6
```

Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement the gate**

```ts
// src/server/modules/agents/gate.ts
import type { AgentResult, ChangeRecord, RequestedChange, ResolvedChange } from "./types";

/**
 * The human gate, as a pure function.
 *
 * A gated agent may flag work, but may move a deal only into a stage flagged
 * `isActionRequired` — a side-state like "NTP Action Required" that exists to
 * hold a deal while a person deals with it. Anything else it asks for is held
 * for a human.
 */
export function decideChange(input: {
  alreadyInTarget: boolean;
  requiresHumanGate: boolean;
  targetIsActionRequired: boolean;
}): "noop" | "held" | "applied" {
  if (input.alreadyInTarget) return "noop";
  if (input.requiresHumanGate && !input.targetIsActionRequired) return "held";
  return "applied";
}

/**
 * Decide every change before any is applied. One invalid change (a deal or a
 * stage that is not there) fails the run, and nothing in it is applied: a run
 * that half-happened is harder to reason about than one that did not happen.
 */
export function planChanges(resolved: ResolvedChange[], requiresHumanGate: boolean): ChangeRecord[] {
  const records = resolved.map((r): ChangeRecord => {
    const base = {
      ...r.change,
      dealLabel: r.lead?.label ?? null,
      fromStage: r.fromStage,
      toStage: r.toStage,
    };
    if (!r.lead) {
      return { ...base, outcome: "invalid", note: "Deal not found in this company and workspace." };
    }
    if (!r.toStage) {
      return { ...base, outcome: "invalid", note: `No stage "${r.change.toStageKey}" in this deal's pipeline.` };
    }
    const outcome = decideChange({
      alreadyInTarget: r.fromStage?.id === r.toStage.id,
      requiresHumanGate,
      targetIsActionRequired: r.toStage.isActionRequired,
    });
    return {
      ...base,
      outcome,
      note:
        outcome === "held"
          ? `Held: this agent is gated and ${r.toStage.name} is not an Action Required stage.`
          : null,
    };
  });

  if (!records.some((c) => c.outcome === "invalid")) return records;
  return records.map((c): ChangeRecord =>
    c.outcome === "applied"
      ? { ...c, outcome: "discarded", note: "Not applied: another change in this run was invalid." }
      : c
  );
}

export function discardAll(changes: RequestedChange[], note: string): ChangeRecord[] {
  return changes.map((c): ChangeRecord => ({
    ...c,
    dealLabel: null,
    fromStage: null,
    toStage: null,
    outcome: "discarded",
    note,
  }));
}

/** Strongest wins: failed > needs_human > success. */
export function finalStatus(
  handlerStatus: AgentResult["status"],
  changes: ChangeRecord[]
): "success" | "failed" | "needs_human" {
  if (handlerStatus === "failed" || changes.some((c) => c.outcome === "invalid")) return "failed";
  if (handlerStatus === "needs_human" || changes.some((c) => c.outcome === "held")) return "needs_human";
  return "success";
}
```

- [ ] **Step 4: Implement the budget and the timeout**

```ts
// src/server/modules/agents/budget.ts
/**
 * How a tick stays inside the cron function's limit.
 *
 *   0 s ─ reap, claim ─ handlers run concurrently ─ 240 s ─ apply + finalise ─ 285 s ─ 15 s spare ─ 300 s
 *
 * Every figure is measured from the tick's own start, so time spent reaping and
 * claiming comes OUT of the handler budget rather than adding to it. Execution
 * is concurrent, never sequential; five runs at most, which also leaves half
 * the runtime's `connection_limit=10` pool free.
 *
 * `CRON_MAX_DURATION_SECONDS` must match `maxDuration` in
 * src/app/api/cron/agents/route.ts — cron-route.test.ts reads the route file to make sure.
 */
export const CRON_MAX_DURATION_SECONDS = 300;
export const MAX_RUNS_PER_TICK = 5;
export const HANDLER_BUDGET_MS = 240_000;
export const APPLY_DEADLINE_MS = 285_000;
export const MIN_START_MS = 5_000;
export const MIN_TIMEOUT_SECONDS = 5;
export const MAX_TIMEOUT_SECONDS = 240;

/** How long this handler may run: its own timeout, cut short by the tick. */
export function handlerDeadlineMs(
  timeoutSeconds: number,
  anchorMs: number,
  nowMs: number,
  capMs: number = Number.POSITIVE_INFINITY
): number {
  return Math.min(timeoutSeconds * 1000, HANDLER_BUDGET_MS - (nowMs - anchorMs), capMs);
}

export function canStart(deadlineMs: number): boolean {
  return deadlineMs >= MIN_START_MS;
}

export function pastApplyDeadline(anchorMs: number, nowMs: number): boolean {
  return nowMs - anchorMs > APPLY_DEADLINE_MS;
}
```

```ts
// src/server/modules/agents/timeout.ts
export type Outcome =
  | { kind: "result"; value: unknown }
  | { kind: "threw"; err: unknown }
  | { kind: "timeout" };

/**
 * Race a handler against its deadline.
 *
 * JavaScript cannot kill a promise. On timeout this stops WAITING and aborts
 * the signal the handler was given; a handler that ignores the signal may keep
 * running, but nothing it returns afterwards is applied — the runner has
 * already finalised the run, and handlers cannot write on their own.
 */
export async function withTimeout(
  fn: () => unknown,
  ms: number,
  controller: AbortController
): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, ms);
  });
  const work = Promise.resolve()
    .then(fn)
    .then(
      (value): Outcome => ({ kind: "result", value }),
      (err): Outcome => ({ kind: "threw", err })
    );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Implement workspaces**

```ts
// src/server/modules/agents/verticals.ts
import type { Vertical } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";

/**
 * Where an agent runs. A "both" agent (vertical NULL) runs once per live
 * workspace; a scoped agent runs only in its own, and not at all when that
 * workspace is switched off or retired.
 */
export function agentRunVerticals(
  agentVertical: Vertical | null,
  live: readonly ActiveVertical[]
): ActiveVertical[] {
  if (agentVertical === null) return [...live];
  return (live as readonly string[]).includes(agentVertical) ? [agentVertical as ActiveVertical] : [];
}

/** Run now: the same, narrowed to the workspaces the viewer holds. */
export function viewerRunVerticals(
  agentVertical: Vertical | null,
  live: readonly ActiveVertical[],
  held: readonly ActiveVertical[]
): ActiveVertical[] {
  return agentRunVerticals(agentVertical, live).filter((v) => held.includes(v));
}

export function agentVisibleTo(agentVertical: Vertical | null, held: readonly ActiveVertical[]): boolean {
  return agentVertical === null || (held as readonly string[]).includes(agentVertical);
}
```

- [ ] **Step 6: Run the tests**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/gate.test.ts src/server/modules/agents/__tests__/budget.test.ts 2>&1 | tail -8
```

Expected: PASS (14 + 7 tests). The check that the cron route declares this budget's limit is `cron-route.test.ts`, written with the route in Task 13.

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/gate.ts src/server/modules/agents/budget.ts src/server/modules/agents/timeout.ts src/server/modules/agents/verticals.ts src/server/modules/agents/__tests__/gate.test.ts src/server/modules/agents/__tests__/budget.test.ts
git commit -m "feat(agents): the gate, and a tick that cannot outlive its function" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: RBAC — the Agent resource and the access rules

**Files:**
- Modify: `src/server/rbac/matrix.ts`
- Create: `src/server/modules/agents/access.ts`
- Test: `src/server/rbac/__tests__/agent-grants.test.ts`, `src/server/modules/agents/__tests__/access.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/rbac/__tests__/agent-grants.test.ts
import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { ACTIONS, ROLES, roleCan, type Action } from "../matrix";

/**
 * Who holds what on Agent, by ROLE. The per-person switch for Operations is an
 * override on top of this and is tested in modules/agents/__tests__/access.test.ts.
 *
 * Written out verb by verb because super_admin's grant is `manage`, and
 * `manage` is silent: reading it out loud is the only way a reviewer sees that
 * a sales manager is excluded on purpose.
 */
const expectVerb = (verb: Action, allowed: Role[]) => {
  for (const role of ROLES as readonly Role[]) {
    expect(roleCan(role, verb, "Agent"), `${role} ${verb} Agent`).toBe(allowed.includes(role));
  }
};

describe("Agent grants", () => {
  it("only owners and admins create or edit an agent", () => {
    expectVerb("create", ["super_admin", "admin"]);
    expectVerb("update", ["super_admin", "admin"]);
  });

  it("owners, admins and accounting read agents and runs", () => {
    expectVerb("read", ["super_admin", "admin", "accounting"]);
  });

  it("only owners and admins run or resolve by role", () => {
    expectVerb("run", ["super_admin", "admin"]);
    expectVerb("approve", ["super_admin", "admin"]);
  });

  it("a sales manager holds nothing on Agent by role", () => {
    for (const verb of ACTIONS) expect(roleCan("manager", verb, "Agent"), `manager ${verb}`).toBe(false);
  });
});
```

```ts
// src/server/modules/agents/__tests__/access.test.ts
import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import {
  AGENT_ACCESS_KEYS,
  agentCan,
  canEditAgentConfig,
  hasAgentsAccess,
  withAgentsAccess,
  withoutAgentsAccess,
} from "../access";

const as = (role: Role, permissions: Record<string, unknown> = {}) => ({ role, permissions });
const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

describe("agentCan", () => {
  it("a manager with the switch reads, runs and resolves", () => {
    for (const verb of ["read", "run", "approve"] as const) expect(agentCan(as("manager", SWITCH), verb)).toBe(true);
  });

  it("a manager without it does nothing", () => {
    for (const verb of ["read", "run", "approve"] as const) expect(agentCan(as("manager"), verb)).toBe(false);
  });

  it("ignores the switch's keys on any role but manager", () => {
    expect(agentCan(as("sales_rep", SWITCH), "read")).toBe(false);
    expect(agentCan(as("installer", SWITCH), "run")).toBe(false);
  });

  it("accounting reads, and cannot run or resolve even with the keys", () => {
    expect(agentCan(as("accounting"), "read")).toBe(true);
    expect(agentCan(as("accounting", SWITCH), "run")).toBe(false);
    expect(agentCan(as("accounting", SWITCH), "approve")).toBe(false);
  });

  it("owners and admins hold every verb", () => {
    for (const role of ["super_admin", "admin"] as const) {
      for (const verb of ["read", "run", "approve"] as const) expect(agentCan(as(role), verb)).toBe(true);
    }
  });
});

describe("canEditAgentConfig", () => {
  it("is role-only: a hand-written Agent:update override never grants it", () => {
    expect(canEditAgentConfig(as("super_admin"))).toBe(true);
    expect(canEditAgentConfig(as("admin"))).toBe(true);
    expect(canEditAgentConfig(as("manager", { ...SWITCH, "Agent:update": true, "Agent:create": true }))).toBe(false);
    expect(canEditAgentConfig(as("accounting"))).toBe(false);
  });
});

describe("the switch's keys", () => {
  it("on writes all three and keeps every other key", () => {
    const next = withAgentsAccess({ "Lead:delete": true });
    expect(next).toEqual({ "Lead:delete": true, ...SWITCH });
    expect(hasAgentsAccess(next)).toBe(true);
  });

  it("off deletes them — never writes false, which would override a role grant", () => {
    const next = withoutAgentsAccess({ "Lead:delete": true, ...SWITCH });
    expect(next).toEqual({ "Lead:delete": true });
    for (const k of AGENT_ACCESS_KEYS) expect(k in next).toBe(false);
  });

  it("needs all three to count as on, and survives junk", () => {
    expect(hasAgentsAccess({ "Agent:read": true })).toBe(false);
    expect(hasAgentsAccess(null)).toBe(false);
    expect(withAgentsAccess("junk")).toEqual(SWITCH);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/rbac/__tests__/agent-grants.test.ts src/server/modules/agents/__tests__/access.test.ts 2>&1 | tail -6
```

Expected: FAIL — `"Agent"` is not a Resource (type error surfaces as a failing `roleCan`, and `../access` does not resolve).

- [ ] **Step 3: Add the resource, the verb and the grants**

In `src/server/rbac/matrix.ts`:

Append to `RESOURCES`, after `"Proposal", // customer-facing roofing presentation / proposal builder`:

```ts
  // Back-office automation agents and their run log. Config edits are
  // owner/admin only by ROLE (see modules/agents/access.ts, which ignores
  // overrides for them); Operations get read/run/approve per person through
  // the Agents access switch on Team → member.
  "Agent",
```

Replace the `ACTIONS` array with:

```ts
export const ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "assign",
  "approve",
  "sign",
  "export",
  "run", // start something now — an agent's Run now
  "manage", // implies all of the above for that resource
] as const;
```

In `GRANTS.super_admin`, replace:

```ts
    Scope: ALL,
    Proposal: ALL,
  },

  admin: {
```

with:

```ts
    Scope: ALL,
    Proposal: ALL,
    Agent: ALL,
  },

  admin: {
```

In `GRANTS.admin`, replace:

```ts
    Scope: ALL,
    Proposal: ALL,
  },

  manager: {
```

with:

```ts
    Scope: ALL,
    Proposal: ALL,
    // No delete: nothing deletes an agent — disabling is how one is retired.
    Agent: ["create", "read", "update", "run", "approve"],
  },

  manager: {
```

In `GRANTS.accounting` — the last block in `GRANTS` — replace:

```ts
    Proposal: ["read"],
  },
};
```

with:

```ts
    Proposal: ["read"],
    // Reads agents and their runs. Running and resolving belong to Operations.
    Agent: ["read"],
  },
};
```

- [ ] **Step 4: Implement the access rules**

```ts
// src/server/modules/agents/access.ts
import type { Role } from "@prisma/client";
import { roleCan } from "@/server/rbac/matrix";

/**
 * Who may do what with agents. Every agents page and action asks here, not
 * `can()`, for two reasons:
 *
 *  1. Operations is not a role. `manager` is both the sales manager and the
 *     solar coordinators, so Operations access is a per-person switch that
 *     writes these three keys into `User.permissions`. Only a `manager` may
 *     hold them; on any other role they are ignored.
 *  2. Editing config is ROLE-ONLY. `can()` honours any override, so a
 *     hand-edited `Agent:update: true` would be config access through `can()`.
 *     `canEditAgentConfig` never reads overrides.
 */

export type AgentVerb = "read" | "run" | "approve";

export const AGENT_ACCESS_KEYS = ["Agent:read", "Agent:run", "Agent:approve"] as const;

/** The only role the switch can be given to. */
export const AGENT_ACCESS_ROLE: Role = "manager";

export const AGENT_CONFIG_ROLES: readonly Role[] = ["super_admin", "admin"];

type WithRole = { role: Role; permissions?: Record<string, unknown> | null };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function agentCan(user: WithRole, verb: AgentVerb): boolean {
  if (roleCan(user.role, verb, "Agent")) return true;
  if (user.role !== AGENT_ACCESS_ROLE) return false;
  return asRecord(user.permissions)[`Agent:${verb}`] === true;
}

export function canEditAgentConfig(user: { role: Role }): boolean {
  return AGENT_CONFIG_ROLES.includes(user.role);
}

export function hasAgentsAccess(permissions: unknown): boolean {
  const p = asRecord(permissions);
  return AGENT_ACCESS_KEYS.every((k) => p[k] === true);
}

export function withAgentsAccess(permissions: unknown): Record<string, unknown> {
  const next = { ...asRecord(permissions) };
  for (const k of AGENT_ACCESS_KEYS) next[k] = true;
  return next;
}

/** Deletes the keys. Never writes `false`: a false override would beat a role grant. */
export function withoutAgentsAccess(permissions: unknown): Record<string, unknown> {
  const next = { ...asRecord(permissions) };
  for (const k of AGENT_ACCESS_KEYS) delete next[k];
  return next;
}
```

- [ ] **Step 5: Run the tests and the whole unit suite**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/rbac/__tests__/agent-grants.test.ts src/server/modules/agents/__tests__/access.test.ts 2>&1 | tail -5
pnpm test 2>&1 | tail -5
```

Expected: both new files PASS; the full suite is the Task 0 baseline plus the tests added so far, with no failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/rbac/matrix.ts src/server/modules/agents/access.ts src/server/rbac/__tests__/agent-grants.test.ts src/server/modules/agents/__tests__/access.test.ts
git commit -m "feat(agents): an Agent resource — owners and admins edit, accounting reads, Operations by name" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: One copy of what entering a stage resets, and "moved by an agent"

**Files:**
- Create: `src/server/modules/pipeline/stage-entry-data.ts`
- Modify: `src/server/modules/leads/actions.ts` (lines ~104–131)
- Modify: `src/lib/stage-history.ts:13`
- Modify: `src/components/portal/deal-stage-timeline.tsx:297-302`
- Test: `src/server/modules/pipeline/__tests__/stage-entry-data.test.ts`

`stageEntryData` is private inside a `"use server"` file today. Every export of such a file is a public endpoint, so the helper moves out rather than being exported where it is.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/pipeline/__tests__/stage-entry-data.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { stageEntryData } from "../stage-entry-data";

describe("stageEntryData", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects the stage, restarts both clocks and takes the stage's default blocker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:00:00.000Z"));
    expect(stageEntryData({ id: "s1", defaultBlocker: "lender", stageType: "externally_blocked" })).toEqual({
      stage: { connect: { id: "s1" } },
      stageChangedAt: new Date("2026-09-15T14:00:00.000Z"),
      stageAlertLevel: 0,
      stageOverdue: false,
      blockedBy: "lender",
      lastTouchAt: null,
      lastChaseAlertAt: null,
    });
  });

  it("clears the blocker note only when we own the stage", () => {
    expect(stageEntryData({ id: "s1", defaultBlocker: null, stageType: "internally_owned" })).toMatchObject({
      blockerNote: null,
    });
    expect(
      stageEntryData({ id: "s1", defaultBlocker: null, stageType: "externally_blocked" })
    ).not.toHaveProperty("blockerNote");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/pipeline/__tests__/stage-entry-data.test.ts 2>&1 | tail -4
```

Expected: FAIL — `Failed to resolve import "../stage-entry-data"`.

- [ ] **Step 3: Create the module**

```ts
// src/server/modules/pipeline/stage-entry-data.ts
import type { Prisma } from "@prisma/client";

/** The stage fields every entry into a stage resets, whichever path got us here. */
export type StageEntry = Pick<
  Prisma.PipelineStageGetPayload<{ select: { id: true; defaultBlocker: true; stageType: true } }>,
  "id" | "defaultBlocker" | "stageType"
>;

/**
 * What lands on the lead when it enters a stage.
 *
 * Entering a stage means a fresh SLA clock and a fresh follow-up clock: the
 * alerts that fired against the previous stage are cleared, and the chase
 * history is wiped so the cadence counts from this entry rather than inheriting
 * a touch logged against the old blocker. Cancelling is a stage entry like any
 * other, so it shares this rather than reimplementing it — two copies of this
 * block is two chances for a cancelled deal to keep escalating.
 *
 * Lives here rather than in leads/actions.ts because that file is "use server":
 * every export there is a public endpoint, and this is a helper. A person's
 * move, a cancellation and an agent's move all go through it.
 */
export function stageEntryData(stage: StageEntry): Prisma.LeadUpdateInput {
  return {
    stage: { connect: { id: stage.id } },
    stageChangedAt: new Date(),
    stageAlertLevel: 0,
    stageOverdue: false,
    blockedBy: stage.defaultBlocker,
    lastTouchAt: null,
    lastChaseAlertAt: null,
    ...(stage.stageType === "internally_owned" ? { blockerNote: null } : {}),
  };
}
```

- [ ] **Step 4: Point `leads/actions.ts` at it**

In `src/server/modules/leads/actions.ts`, delete this whole block (it sits between `moveSchema` and `export async function moveLeadStage`):

```ts
/** The stage fields every entry into a stage resets, whichever path got us here. */
type StageEntry = Pick<
  Prisma.PipelineStageGetPayload<{ select: { id: true; defaultBlocker: true; stageType: true } }>,
  "id" | "defaultBlocker" | "stageType"
>;

/**
 * What lands on the lead when it enters a stage.
 *
 * Entering a stage means a fresh SLA clock and a fresh follow-up clock: the
 * alerts that fired against the previous stage are cleared, and the chase
 * history is wiped so the cadence counts from this entry rather than inheriting
 * a touch logged against the old blocker. Cancelling is a stage entry like any
 * other, so it shares this rather than reimplementing it — two copies of this
 * block is two chances for a cancelled deal to keep escalating.
 */
function stageEntryData(stage: StageEntry): Prisma.LeadUpdateInput {
  return {
    stage: { connect: { id: stage.id } },
    stageChangedAt: new Date(),
    stageAlertLevel: 0,
    stageOverdue: false,
    blockedBy: stage.defaultBlocker,
    lastTouchAt: null,
    lastChaseAlertAt: null,
    ...(stage.stageType === "internally_owned" ? { blockerNote: null } : {}),
  };
}

```

and add this import directly after `import { recordStageEntry } from "@/server/modules/pipeline/stage-history";`:

```ts
import { stageEntryData } from "@/server/modules/pipeline/stage-entry-data";
```

- [ ] **Step 5: Add `agent` to how a move can happen, and say it on the timeline**

In `src/lib/stage-history.ts`, replace:

```ts
/** How a deal got into a stage when no person moved it. */
export type StageMoveVia = "automation" | "signature";
```

with:

```ts
/**
 * How a deal got into a stage when no person moved it. `agent`: an agent's
 * change passed the human gate on its own. A change a person approved is that
 * person's move, and carries their name instead.
 */
export type StageMoveVia = "automation" | "signature" | "agent";
```

In `src/components/portal/deal-stage-timeline.tsx`, inside `movedByLabel`, replace:

```ts
  if (row.via === "signature") return "homeowner signed";
```

with:

```ts
  if (row.via === "signature") return "homeowner signed";
  if (row.via === "agent") return "by an agent";
```

- [ ] **Step 6: Run the test, the typecheck and lint**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/pipeline/__tests__/stage-entry-data.test.ts 2>&1 | tail -4
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/server/modules/pipeline/stage-entry-data.ts src/server/modules/leads/actions.ts src/lib/stage-history.ts src/components/portal/deal-stage-timeline.tsx
```

Expected: 2 passed; `typecheck exit=0`; eslint prints nothing.

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/pipeline/stage-entry-data.ts src/server/modules/pipeline/__tests__/stage-entry-data.test.ts src/server/modules/leads/actions.ts src/lib/stage-history.ts src/components/portal/deal-stage-timeline.tsx
git commit -m "refactor(pipeline): one copy of what entering a stage resets; a timeline row can say an agent moved it" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Advance and progress count main-line stages only

Before Task 9 adds roofing side-states, Advance must stop walking into them. This also changes Solar: from NTP Submitted, Advance offers NTP Approved rather than NTP Action Required. Both ship in the same deploy.

**Files:**
- Create: `src/lib/stage-progress.ts`
- Modify: `src/components/portal/deal-stage-bar.tsx`
- Modify: `src/app/portal/leads/[id]/page.tsx` (lines ~1317–1349)
- Test: `src/lib/__tests__/stage-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/stage-progress.test.ts
import { describe, it, expect } from "vitest";
import { isMainLine, stageProgress, type ProgressStage } from "../stage-progress";

const s = (id: string, flags: Omit<ProgressStage, "id"> = {}): ProgressStage => ({ id, ...flags });

/** Roofing once the side-states land, trimmed. */
const ROOFING = [
  s("adjuster_meeting"),
  s("adjuster_meeting_complete"),
  s("claim_denied", { isActionRequired: true }),
  s("scope_received"),
  s("qc_inspection"),
  s("qc_failed", { isActionRequired: true }),
  s("paid"),
  s("cancelled", { isLost: true }),
];

describe("isMainLine", () => {
  it("leaves out the lost stage and every side-state", () => {
    expect(ROOFING.filter(isMainLine).map((x) => x.id)).toEqual([
      "adjuster_meeting",
      "adjuster_meeting_complete",
      "scope_received",
      "qc_inspection",
      "paid",
    ]);
  });
});

describe("stageProgress", () => {
  it("offers the next main-line stage, stepping over a side-state", () => {
    const p = stageProgress(ROOFING, "adjuster_meeting_complete");
    expect(p.nextStage?.id).toBe("scope_received");
    expect(p.step).toBe(2);
    expect(p.liveCount).toBe(5);
    expect(p.isSideState).toBe(false);
  });

  it("from a side-state, offers the main-line stage after it and keeps the step already reached", () => {
    const p = stageProgress(ROOFING, "claim_denied");
    expect(p.nextStage?.id).toBe("scope_received");
    expect(p.step).toBe(2);
    expect(p.isSideState).toBe(true);
  });

  it("never offers Cancelled from the last main-line stage", () => {
    const p = stageProgress(ROOFING, "paid");
    expect(p.nextStage).toBeNull();
    expect(p.step).toBe(5);
  });

  it("knows a cancelled deal, and where Cancelled is", () => {
    const p = stageProgress(ROOFING, "cancelled");
    expect(p.isCancelled).toBe(true);
    expect(p.lostStage?.id).toBe("cancelled");
    expect(p.nextStage).toBeNull();
  });

  it("starts a deal with no stage before the first main-line stage", () => {
    const p = stageProgress(ROOFING, null);
    expect(p.currentIndex).toBe(-1);
    expect(p.step).toBe(0);
    expect(p.nextStage?.id).toBe("adjuster_meeting");
  });

  it("with nothing flagged action-required, behaves exactly as Advance did before", () => {
    const plain = [s("a"), s("b"), s("c"), s("x", { isLost: true })];
    const p = stageProgress(plain, "b");
    expect(p).toMatchObject({ currentIndex: 1, step: 2, liveCount: 3, isCancelled: false, isSideState: false });
    expect(p.nextStage?.id).toBe("c");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/lib/__tests__/stage-progress.test.ts 2>&1 | tail -4
```

Expected: FAIL — `Failed to resolve import "../stage-progress"`.

- [ ] **Step 3: Implement**

```ts
// src/lib/stage-progress.ts
/**
 * Where a deal stands on its pipeline's MAIN LINE: the stages it moves through
 * on its way to done.
 *
 * Two kinds of stage sit in a pipeline without being steps forward:
 *  - the lost stage (Cancelled), a dead end;
 *  - action-required side-states (NTP Action Required, QC Failed), where a deal
 *    waits while somebody clears a problem and then rejoins the line.
 *
 * Advance and "step N of M" read the main line only. Without this, Advance
 * from Adjuster Meeting Complete would offer Claim Denied as the one-click next
 * step. Side-states stay reachable from Move, and agents move deals into them.
 */

export type ProgressStage = { id: string; isLost?: boolean; isActionRequired?: boolean };

export function isMainLine(stage: ProgressStage): boolean {
  return !stage.isLost && !stage.isActionRequired;
}

export type StageProgress<S extends ProgressStage> = {
  currentIndex: number;
  current: S | null;
  /** Main-line stages in the pipeline. */
  liveCount: number;
  /** Main-line stages up to and including the current one; a side-state keeps the step before it. */
  step: number;
  /** The next main-line stage after the current one. Never Cancelled, never a side-state. */
  nextStage: S | null;
  lostStage: S | null;
  isCancelled: boolean;
  isSideState: boolean;
};

export function stageProgress<S extends ProgressStage>(
  stages: S[],
  currentStageId: string | null
): StageProgress<S> {
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  const current = currentIndex >= 0 ? stages[currentIndex] : null;
  const reached = currentIndex >= 0 ? stages.slice(0, currentIndex + 1) : [];
  return {
    currentIndex,
    current,
    liveCount: stages.filter(isMainLine).length,
    step: reached.filter(isMainLine).length,
    nextStage: stages.slice(currentIndex + 1).find(isMainLine) ?? null,
    lostStage: stages.find((s) => s.isLost) ?? null,
    isCancelled: !!current?.isLost,
    isSideState: !!current && !current.isLost && !!current.isActionRequired,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/lib/__tests__/stage-progress.test.ts 2>&1 | tail -4
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Use it in the stage bar**

In `src/components/portal/deal-stage-bar.tsx`:

Add, after `import { cn } from "@/lib/utils";`:

```ts
import { stageProgress } from "@/lib/stage-progress";
```

In `export type StageLite`, replace:

```ts
  isLost?: boolean;
};
```

with:

```ts
  isLost?: boolean;
  /** A side-state a deal waits in (NTP Action Required). Never offered as the next step. */
  isActionRequired?: boolean;
};
```

Replace the whole `useStageModel` function:

```ts
/** What the two surfaces need to agree on, derived once from the stage list. */
function useStageModel(stages: StageLite[], currentStageId: string | null) {
  return React.useMemo(() => {
    const currentIndex = stages.findIndex((s) => s.id === currentStageId);
    const current = currentIndex >= 0 ? stages[currentIndex] : null;
    // Progress counts the stages a deal moves THROUGH. Cancelled sits in the
    // pipeline but is a dead end, not a step towards anything.
    const liveCount = stages.filter((s) => !s.isLost).length;
    return {
      currentIndex,
      current,
      liveCount,
      step: currentIndex + 1,
      // Forward motion never runs into a dead end: a deal one stage short of the
      // end must not advance itself into Cancelled just because Cancelled
      // happens to be last in the list.
      nextStage: stages.slice(currentIndex + 1).find((s) => !s.isLost) ?? null,
      lostStage: stages.find((s) => s.isLost) ?? null,
      isCancelled: !!current?.isLost,
    };
  }, [stages, currentStageId]);
}
```

with:

```ts
/**
 * What the two surfaces need to agree on, derived once from the stage list.
 *
 * The maths lives in lib/stage-progress.ts so the deal page's summary card
 * counts steps the same way. Forward motion skips Cancelled (a deal one stage
 * short of the end must not advance itself into it) and every action-required
 * side-state (Advance from Adjuster Meeting Complete must not offer Claim Denied).
 */
function useStageModel(stages: StageLite[], currentStageId: string | null) {
  return React.useMemo(() => stageProgress(stages, currentStageId), [stages, currentStageId]);
}
```

- [ ] **Step 6: Use it on the deal page**

In `src/app/portal/leads/[id]/page.tsx`, add to the import block at the top:

```ts
import { stageProgress } from "@/lib/stage-progress";
```

Replace:

```tsx
  const stageLite = (lead.pipeline?.stages ?? []).map((st) => ({
    id: st.id,
    name: st.name,
    position: st.position,
    color: st.color,
    isLost: st.isLost,
  }));
```

with:

```tsx
  const stageLite = (lead.pipeline?.stages ?? []).map((st) => ({
    id: st.id,
    name: st.name,
    position: st.position,
    color: st.color,
    isLost: st.isLost,
    isActionRequired: st.isActionRequired,
  }));
```

Replace:

```tsx
    const stageIndex = lead.pipeline
      ? lead.pipeline.stages.findIndex((s) => s.id === lead.stage?.id)
      : -1;
    // The shared helper, not an inline Date.now(): the purity lint rule bans
    // calling an impure function during render, and this is the same figure the
    // pipeline board and the SLA alert job already compute.
    const inStage = daysInStage(lead.stageChangedAt, lead.createdAt);
    // Progress counts the stages a deal moves THROUGH. Cancelled lives in the
    // pipeline but is a dead end, and counting it made a 21-stage roofing job
    // read "step 4 of 22". A cancelled deal gets no step at all.
    const liveStages = (lead.pipeline?.stages ?? []).filter((s) => !s.isLost);
    const showStep = stageIndex >= 0 && !lead.stage?.isLost;
    if (lead.stage) {
      summaryCards.push({
        label: "Current stage",
        value: lead.stage.name,
        hint: [
          showStep ? `Step ${stageIndex + 1} of ${liveStages.length}` : null,
```

with:

```tsx
    // The shared helper, not an inline Date.now(): the purity lint rule bans
    // calling an impure function during render, and this is the same figure the
    // pipeline board and the SLA alert job already compute.
    const inStage = daysInStage(lead.stageChangedAt, lead.createdAt);
    // Progress counts the stages a deal moves THROUGH, with the progress bar's
    // own maths (lib/stage-progress.ts). Cancelled is a dead end and an
    // action-required stage is a side-state, so neither is a step: a deal parked
    // in QC Failed keeps the step it had reached. A cancelled deal gets no step.
    const progress = stageProgress(lead.pipeline?.stages ?? [], lead.stage?.id ?? null);
    const showStep = progress.currentIndex >= 0 && !progress.isCancelled;
    if (lead.stage) {
      summaryCards.push({
        label: "Current stage",
        value: lead.stage.name,
        hint: [
          showStep ? `Step ${progress.step} of ${progress.liveCount}` : null,
```

- [ ] **Step 7: Typecheck, lint, unit suite**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/lib/stage-progress.ts src/components/portal/deal-stage-bar.tsx "src/app/portal/leads/[id]/page.tsx"
pnpm test 2>&1 | tail -4
```

Expected: `typecheck exit=0`; eslint prints nothing; all unit tests pass. The browser proof (`e2e/deal-stage-actions.spec.ts`) runs in Task 23.

- [ ] **Step 8: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/lib/stage-progress.ts src/lib/__tests__/stage-progress.test.ts src/components/portal/deal-stage-bar.tsx "src/app/portal/leads/[id]/page.tsx"
git commit -m "feat(pipeline): Advance and step counts skip action-required side-states" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Action-required stages: the migration, the seeds, and a test against production's shape

**Files:**
- Create: `prisma/migrations/20260915120100_action_required_stages/migration.sql`
- Modify: `prisma/seed.ts` (STAGES, lines 9–26; roofing loop, lines ~186–203)
- Modify: `prisma/seed-clean.ts` (STAGES, lines 29–46; roofing loop, lines ~175–192)
- Test: `src/server/modules/pipeline/__tests__/action-required-stages.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/pipeline/__tests__/action-required-stages.itest.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * The stage migration against pipelines shaped like production's on
 * 2026-09-15 — generated keys, a "Cancelled " with a trailing space, nothing
 * flagged — then run AGAIN, because a migration somebody re-applies by hand
 * must change nothing.
 *
 * The global setup applied it to this schema before these fixtures existed;
 * this file runs the same SQL over them with psql, which must be on PATH.
 */

const MIGRATION = join(
  __dirname,
  "../../../../../prisma/migrations/20260915120100_action_required_stages/migration.sql"
);

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

/** psql rejects Prisma's `?schema=`, so the schema travels as search_path. */
function applyMigration() {
  const url = new URL(TEST_DATABASE_URL);
  const schema = url.searchParams.get("schema") ?? "public";
  url.search = "";
  execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", MIGRATION], {
    env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
    stdio: "pipe",
  });
}

/** Production's roofing pipeline, in order, read on 2026-09-15. */
const PROD_ROOFING = [
  ["new_lead", "New Appointment"],
  ["appointment_set", "Appointment Set"],
  ["inspection_complete", "Inspection Complete"],
  ["claim_opened", "Insurance Claim Opened"],
  ["adjuster_meeting", "Adjuster Meeting Scheduled"],
  ["adjuster_meeting_complete_16", "Adjuster Meeting Complete"],
  ["scope_received", "Scope Received"],
  ["scope_complete_17", "Scope Complete"],
  ["supplement_needed", "Supplement Needed"],
  ["supplement_submitted_18", "Supplement Submitted"],
  ["supplement_approved_19", "Supplement Approved"],
  ["contract_signed", "Contract Signed"],
  ["front_check_received_20", "Front check received"],
  ["material_ordered", "Material Ordered"],
  ["scheduled", "Scheduled"],
  ["in_production", "In Production"],
  ["qc_inspection", "QC Inspection"],
  ["invoice_sent", "Invoice Sent"],
  ["depreciation_requested", "Depreciation Requested"],
  ["paid", "Paid"],
  ["closed", "Closed"],
  ["cancelled_21", "Cancelled "],
] as const;

/** Production's six solar action-required keys, among neighbours that must stay unflagged. */
const PROD_SOLAR = [
  ["ntp_submitted_9", "NTP Submitted"],
  ["ntp_action_required_10", "NTP Action Required"],
  ["ntp_approved_11", "NTP Approved"],
  ["design_action_required_13", "Design Action Required"],
  ["permit_action_required_15", "Permit Action Required"],
  ["inspection_action_required_21", "Inspection Action Required"],
  ["interconnection_action_required_25", "Interconnection Action Required"],
  ["monitoring_action_required_29", "Monitoring Action Required"],
  ["utility_pto_26", "Utility PTO"],
] as const;

let companyId = "";
let roofingId = "";
let seededId = "";
let solarId = "";

const keysOf = async (pipelineId: string) =>
  (await db.pipelineStage.findMany({ where: { pipelineId }, orderBy: { position: "asc" }, select: { key: true } })).map(
    (s) => s.key
  );
const flaggedOf = async (pipelineId: string) =>
  (
    await db.pipelineStage.findMany({
      where: { pipelineId, isActionRequired: true },
      orderBy: { position: "asc" },
      select: { key: true },
    })
  ).map((s) => s.key);

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Stage Migration Co", slug: `stages-${process.pid}-${Date.now()}` } })).id;

  roofingId = (await db.pipeline.create({ data: { companyId, name: "Roofing Pipeline", vertical: "roofing" } })).id;
  await db.pipelineStage.createMany({
    data: PROD_ROOFING.map(([key, name], position) => ({ pipelineId: roofingId, key, name, position, isLost: key === "cancelled_21" })),
  });

  // The seeded shape: no Adjuster Meeting Complete (Claim Denied falls back to
  // Adjuster Meeting Scheduled) and no Depreciation Requested (Payment Issue is skipped).
  seededId = (await db.pipeline.create({ data: { companyId, name: "Seeded Roofing", vertical: "roofing" } })).id;
  await db.pipelineStage.createMany({
    data: ["new_lead", "adjuster_meeting", "scope_received", "supplement_needed", "qc_inspection", "invoice_sent"].map(
      (key, position) => ({ pipelineId: seededId, key, name: key, position })
    ),
  });

  solarId = (await db.pipeline.create({ data: { companyId, name: "Solar Pipeline", vertical: "solar" } })).id;
  await db.pipelineStage.createMany({
    data: PROD_SOLAR.map(([key, name], position) => ({ pipelineId: solarId, key, name, position })),
  });

  applyMigration();
});

afterAll(async () => {
  await db.pipelineStage.deleteMany({ where: { pipelineId: { in: [roofingId, seededId, solarId] } } });
  await db.pipeline.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("20260915120100_action_required_stages", () => {
  it("flags the six solar Action Required stages and nothing else", async () => {
    expect(await flaggedOf(solarId)).toEqual([
      "ntp_action_required_10",
      "design_action_required_13",
      "permit_action_required_15",
      "inspection_action_required_21",
      "interconnection_action_required_25",
      "monitoring_action_required_29",
    ]);
    expect(await keysOf(solarId)).not.toContain("claim_denied");
  });

  it("flags Supplement Needed and adds three roofing side-states straight after their anchors", async () => {
    const expected: string[] = PROD_ROOFING.map(([key]) => key);
    expected.splice(expected.indexOf("adjuster_meeting_complete_16") + 1, 0, "claim_denied");
    expected.splice(expected.indexOf("qc_inspection") + 1, 0, "qc_failed");
    expected.splice(expected.indexOf("depreciation_requested") + 1, 0, "payment_issue");
    expect(await keysOf(roofingId)).toEqual(expected);
    expect(await flaggedOf(roofingId)).toEqual(["claim_denied", "supplement_needed", "qc_failed", "payment_issue"]);

    const positions = (
      await db.pipelineStage.findMany({ where: { pipelineId: roofingId }, orderBy: { position: "asc" }, select: { position: true } })
    ).map((s) => s.position);
    expect(positions).toEqual(positions.map((_, i) => i));

    const added = await db.pipelineStage.findMany({
      where: { pipelineId: roofingId, key: { in: ["claim_denied", "qc_failed", "payment_issue"] } },
      orderBy: { position: "asc" },
    });
    expect(added.map((s) => [s.name, s.color, s.stageType, s.isLost, s.countsAsSold])).toEqual([
      ["Claim Denied — Action Required", "#EF4444", "internally_owned", false, false],
      ["QC Failed — Action Required", "#EF4444", "internally_owned", false, false],
      ["Payment Issue — Action Required", "#EF4444", "internally_owned", false, false],
    ]);
  });

  it("falls back to Adjuster Meeting Scheduled, and skips a stage whose anchor is missing", async () => {
    expect(await keysOf(seededId)).toEqual([
      "new_lead",
      "adjuster_meeting",
      "claim_denied",
      "scope_received",
      "supplement_needed",
      "qc_inspection",
      "qc_failed",
      "invoice_sent",
    ]);
  });

  it("changes nothing when run a second time", async () => {
    const snapshot = () =>
      db.pipelineStage.findMany({
        where: { pipelineId: { in: [roofingId, seededId, solarId] } },
        orderBy: [{ pipelineId: "asc" }, { position: "asc" }],
        select: { id: true, key: true, position: true, isActionRequired: true },
      });
    const before = await snapshot();
    applyMigration();
    expect(await snapshot()).toEqual(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/pipeline/__tests__/action-required-stages.itest.ts 2>&1 | tail -6
```

Expected: FAIL in `beforeAll` — psql: `could not open file ".../20260915120100_action_required_stages/migration.sql"`.

- [ ] **Step 3: Write the migration**

```sql
-- prisma/migrations/20260915120100_action_required_stages/migration.sql
--
-- Action-required stages: side-states a deal waits in while somebody clears a
-- problem. A gated agent may move a deal INTO one of these and nowhere else, and
-- the deal page's Advance button steps over them (src/lib/stage-progress.ts).
-- See docs/superpowers/specs/2026-09-15-agents-control-plane-design.md.
--
-- Idempotent: every statement checks before it writes.

-- Solar: every stage named "... Action Required". Matched by NAME, because the
-- stage builder generated production's keys (ntp_action_required_10, ...).
UPDATE "pipeline_stages" AS s
SET "isActionRequired" = true
FROM "pipelines" AS p
WHERE s."pipelineId" = p."id"
  AND p."industry" = 'solar'
  AND s."name" ILIKE '%action required%'
  AND s."isActionRequired" = false;

-- Roofing: Supplement Needed. Supplement Submitted, Invoice Sent and
-- Depreciation Requested wait on the carrier or the homeowner and stay unflagged.
UPDATE "pipeline_stages" AS s
SET "isActionRequired" = true
FROM "pipelines" AS p
WHERE s."pipelineId" = p."id"
  AND p."industry" = 'roofing'
  AND s."key" = 'supplement_needed'
  AND s."isActionRequired" = false;

-- Roofing: three new side-states, each straight after the step it branches
-- from, later stages shifted down one. A pipeline without the anchor is skipped
-- for that stage; one that already has the key or the name is left alone.
DO $$
DECLARE
  pipe RECORD;
  spec RECORD;
  anchor_pos INTEGER;
BEGIN
  FOR pipe IN SELECT "id" FROM "pipelines" WHERE "industry" = 'roofing' LOOP
    FOR spec IN
      SELECT * FROM (VALUES
        (1, 'claim_denied',  'Claim Denied — Action Required',  ARRAY['adjuster_meeting_complete_16', 'adjuster_meeting']),
        (2, 'qc_failed',     'QC Failed — Action Required',     ARRAY['qc_inspection']),
        (3, 'payment_issue', 'Payment Issue — Action Required', ARRAY['depreciation_requested'])
      ) AS t(ord, stage_key, stage_name, anchors)
      ORDER BY ord
    LOOP
      IF EXISTS (
        SELECT 1 FROM "pipeline_stages"
        WHERE "pipelineId" = pipe."id" AND ("key" = spec.stage_key OR "name" = spec.stage_name)
      ) THEN
        CONTINUE;
      END IF;

      SELECT st."position" INTO anchor_pos
      FROM unnest(spec.anchors) WITH ORDINALITY AS a(anchor_key, preference)
      JOIN "pipeline_stages" AS st ON st."pipelineId" = pipe."id" AND st."key" = a.anchor_key
      ORDER BY a.preference
      LIMIT 1;

      IF anchor_pos IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE "pipeline_stages"
      SET "position" = "position" + 1
      WHERE "pipelineId" = pipe."id" AND "position" > anchor_pos;

      INSERT INTO "pipeline_stages" (
        "id", "pipelineId", "name", "key", "position", "color",
        "stageType", "isActionRequired", "notificationRecipient"
      ) VALUES (
        gen_random_uuid()::text, pipe."id", spec.stage_name, spec.stage_key, anchor_pos + 1, '#EF4444',
        'internally_owned', true, 'none'
      );
    END LOOP;
  END LOOP;
END $$;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/pipeline/__tests__/action-required-stages.itest.ts 2>&1 | tail -6
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Give the seeds the same stages**

In **both** `prisma/seed.ts` and `prisma/seed-clean.ts`, replace the whole `const STAGES = [ … ];` array with:

```ts
const STAGES = [
  { key: "new_lead", name: "New Appointment", color: "#A1A1AA" },
  { key: "appointment_set", name: "Appointment Set", color: "#60A5FA" },
  { key: "inspection_complete", name: "Inspection Complete", color: "#38BDF8" },
  { key: "claim_opened", name: "Insurance Claim Opened", color: "#818CF8" },
  { key: "adjuster_meeting", name: "Adjuster Meeting Scheduled", color: "#A78BFA" },
  // Side-states (isActionRequired): a deal waits in one while somebody clears a
  // problem, then rejoins the line. Advance and "step N of M" skip them
  // (src/lib/stage-progress.ts), and a gated agent may move a deal into one and
  // nowhere else. Same rows as migration 20260915120100_action_required_stages.
  { key: "claim_denied", name: "Claim Denied — Action Required", color: "#EF4444", isActionRequired: true },
  { key: "scope_received", name: "Scope Received", color: "#C084FC" },
  { key: "supplement_needed", name: "Supplement Needed", color: "#F472B6", isActionRequired: true },
  { key: "contract_signed", name: "Contract Signed", color: "#FB923C", countsAsSold: true },
  { key: "material_ordered", name: "Material Ordered", color: "#FBBF24" },
  { key: "scheduled", name: "Scheduled", color: "#FACC15" },
  { key: "in_production", name: "In Production", color: "#A3E635" },
  { key: "qc_inspection", name: "QC Inspection", color: "#4ADE80" },
  { key: "qc_failed", name: "QC Failed — Action Required", color: "#EF4444", isActionRequired: true },
  { key: "invoice_sent", name: "Invoice Sent", color: "#34D399" },
  { key: "depreciation_requested", name: "Depreciation Requested", color: "#2DD4BF" },
  { key: "payment_issue", name: "Payment Issue — Action Required", color: "#EF4444", isActionRequired: true },
  { key: "paid", name: "Paid", color: "#22C55E", isWon: true },
  { key: "closed", name: "Closed", color: "#16A34A", isWon: true },
];
```

In `prisma/seed.ts`, in the roofing stage loop, replace:

```ts
          countsAsSold: (s as { countsAsSold?: boolean }).countsAsSold ?? false,
          isLost: (s as { isLost?: boolean }).isLost ?? false,
        },
      })
    );
```

with:

```ts
          countsAsSold: (s as { countsAsSold?: boolean }).countsAsSold ?? false,
          isLost: (s as { isLost?: boolean }).isLost ?? false,
          isActionRequired: (s as { isActionRequired?: boolean }).isActionRequired ?? false,
        },
      })
    );
```

In `prisma/seed-clean.ts`, in the roofing stage loop, replace:

```ts
        countsAsSold: (s as { countsAsSold?: boolean }).countsAsSold ?? false,
        isLost: (s as { isLost?: boolean }).isLost ?? false,
      },
      select: { key: true, id: true },
```

with:

```ts
        countsAsSold: (s as { countsAsSold?: boolean }).countsAsSold ?? false,
        isLost: (s as { isLost?: boolean }).isLost ?? false,
        isActionRequired: (s as { isActionRequired?: boolean }).isActionRequired ?? false,
      },
      select: { key: true, id: true },
```

- [ ] **Step 6: Apply to `agents_dev`, reseed, and look at the result**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec prisma migrate deploy 2>&1 | grep -E "Applying|Error"
pnpm exec tsx prisma/seed.ts 2>&1 | grep -E "Seed complete|Error"
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -qAt -c "SET search_path TO agents_dev; SELECT s.position, s.key, s.\"isActionRequired\" FROM pipeline_stages s JOIN pipelines p ON p.id = s.\"pipelineId\" WHERE p.industry = 'roofing' ORDER BY s.position;"
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: `Applying migration `20260915120100_action_required_stages``; `✅ Seed complete.`; 20 rows `0|new_lead|f` … `19|cancelled|f`, with `t` on exactly `claim_denied` (5), `supplement_needed` (7), `qc_failed` (13) and `payment_issue` (16); `typecheck exit=0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add prisma/migrations/20260915120100_action_required_stages/migration.sql src/server/modules/pipeline/__tests__/action-required-stages.itest.ts prisma/seed.ts prisma/seed-clean.ts
git commit -m "feat(pipeline): flag action-required stages; add Claim Denied, QC Failed and Payment Issue to roofing" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Agent notifications, and the Agents access recipient

**Files:**
- Modify: `src/server/modules/notifications/types.ts`
- Modify: `src/server/modules/notifications/actions.ts:19-24`
- Modify: `src/server/modules/notifications/engine.ts`
- Test: `src/server/modules/notifications/__tests__/agent-events.test.ts`
- Test: `src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// src/server/modules/notifications/__tests__/agent-events.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DYNAMIC_TARGETS, EVENT_DEFS } from "../types";

describe("agent notification events", () => {
  it("catalogues both agent events with the agent, customer and status tokens", () => {
    for (const value of ["agent_run_failed", "agent_needs_human"] as const) {
      const def = EVENT_DEFS.find((e) => e.value === value);
      expect(def, value).toBeDefined();
      expect(def?.tokens).toEqual(["{{agent}}", "{{customer}}", "{{status}}"]);
    }
  });

  it("offers People with Agents access as a recipient", () => {
    expect(DYNAMIC_TARGETS.map((t) => t.value)).toContain("agents_access");
  });

  it("lets every catalogued event be saved from Settings", () => {
    const src = readFileSync(join(__dirname, "../actions.ts"), "utf8");
    const list = /const EVENTS = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "";
    for (const e of EVENT_DEFS) expect(list, e.value).toContain(`"${e.value}"`);
  });
});
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { fireEvent } from "../engine";

/**
 * Who hears that an agent run failed: the owner, admins, and the managers who
 * hold the Agents access switch — read when the alert fires, so switching
 * someone off stops the very next one. A sales manager without the switch, and
 * a rep with a stale override, hear nothing.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

let companyId = "";
const ids: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Agent Alerts Co", slug: `agent-alerts-${process.pid}-${Date.now()}` } })).id;
  const people: [string, Role, Record<string, boolean>][] = [
    ["owner", "super_admin", {}],
    ["admin", "admin", {}],
    ["coordinator", "manager", SWITCH],
    ["salesManager", "manager", {}],
    ["rep", "sales_rep", SWITCH],
    ["accounting", "accounting", {}],
  ];
  for (const [key, role, permissions] of people) {
    ids[key] = (
      await db.user.create({
        data: { companyId, email: `${key}-${process.pid}@agent-alerts.test`, firstName: key, lastName: "Test", role, status: "active", passwordHash: "x", permissions },
      })
    ).id;
  }
  await db.notificationRule.create({
    data: {
      companyId,
      vertical: "roofing",
      name: "Agent failed",
      event: "agent_run_failed",
      recipients: { roles: ["super_admin", "admin"], userIds: [], dynamic: ["agents_access"] },
      channels: ["in_app"],
      titleTemplate: "Agent failed: {{agent}}",
      bodyTemplate: "{{status}}",
    },
  });
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.notificationRule.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const fire = () =>
  fireEvent({
    companyId,
    event: "agent_run_failed",
    agentName: "NTP Poller",
    status: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
  });

describe("agent_run_failed recipients", () => {
  it("reaches the owner, admins and managers with the Agents access switch, and nobody else", async () => {
    await runInVertical("roofing", fire);
    const rows = await db.notification.findMany({ where: { companyId }, select: { userId: true, title: true, body: true, link: true } });
    expect(rows.map((r) => r.userId).sort()).toEqual([ids.owner, ids.admin, ids.coordinator].sort());
    expect(rows[0]).toMatchObject({ title: "Agent failed: NTP Poller", link: "/portal/agents/runs" });
    // Passed through untouched: the handler key keeps its underscore.
    expect(rows[0].body).toContain('"bank.ntp_poll"');
  });

  it("stops reaching a manager the moment the switch is off", async () => {
    await db.user.update({ where: { id: ids.coordinator }, data: { permissions: {} } });
    await runInVertical("roofing", fire);
    const rows = await db.notification.findMany({ where: { companyId }, select: { userId: true } });
    expect(rows.map((r) => r.userId)).not.toContain(ids.coordinator);
    await db.user.update({ where: { id: ids.coordinator }, data: { permissions: SWITCH } });
  });

  it("notifies nobody, silently, when fired outside a workspace — which is why notify.ts wraps it", async () => {
    await fire();
    expect(await db.notification.count({ where: { companyId } })).toBe(0);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/notifications/__tests__/agent-events.test.ts 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts 2>&1 | tail -6
```

Expected: the unit file fails 3 assertions (event missing); the itest fails its first two cases (the coordinator is not a recipient; the body reads `bank.ntp poll`).

- [ ] **Step 4: Catalogue the events and the recipient**

In `src/server/modules/notifications/types.ts`, append to `EVENT_DEFS`, after the `automation_failed` entry:

```ts
  {
    value: "agent_run_failed",
    label: "An agent run failed",
    condition: null,
    tokens: ["{{agent}}", "{{customer}}", "{{status}}"],
    defaultTitle: "Agent failed: {{agent}}",
    defaultBody: "{{status}}",
  },
  {
    value: "agent_needs_human",
    label: "An agent run needs a human",
    condition: null,
    tokens: ["{{agent}}", "{{customer}}", "{{status}}"],
    defaultTitle: "Needs a human: {{agent}}",
    defaultBody: "{{status}}",
  },
```

and append to `DYNAMIC_TARGETS`, after `{ value: "all_managers", label: "All managers" },`:

```ts
  { value: "agents_access", label: "People with Agents access" },
```

In `src/server/modules/notifications/actions.ts`, replace:

```ts
  "automation_failed",
] as const;
```

with:

```ts
  "automation_failed", "agent_run_failed", "agent_needs_human",
] as const;
```

- [ ] **Step 5: Teach the engine**

In `src/server/modules/notifications/engine.ts`:

Add after the existing imports:

```ts
import { AGENT_ACCESS_ROLE } from "@/server/modules/agents/access";
```

In `export type FireArgs`, after `status?: string | null;`, add:

```ts
  /** The agent a run belongs to, for agent_run_failed / agent_needs_human. */
  agentName?: string | null;
```

After `type Tokens = Record<string, string>;`, add:

```ts
/** Agent events carry a sentence in `status`, not an enum value. */
const AGENT_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>(["agent_run_failed", "agent_needs_human"]);
```

In the `tokens` object, replace:

```ts
    status: (args.status ?? "").replace(/_/g, " "),
```

with:

```ts
    // Enum statuses read better with spaces ("in production"). An agent's status
    // is a sentence that can name a handler key ("bank.ntp_poll"), so it passes
    // through untouched.
    status: AGENT_EVENTS.has(args.event) ? (args.status ?? "") : (args.status ?? "").replace(/_/g, " "),
    agent: args.agentName ?? "",
```

After `const dynamicRoleUsers = (roleList: string[]) => usersByRoles(roleList);`, add:

```ts
  // Holders of the Agents access switch (modules/agents/access.ts): managers
  // whose permission overrides carry Agent:approve. Read now, when the alert
  // fires, so switching someone off stops the next alert with no rule to edit.
  let agentsAccessIds: string[] | null = null;
  async function agentsAccessUsers(): Promise<string[]> {
    if (agentsAccessIds) return agentsAccessIds;
    const users = await prisma.user.findMany({
      where: {
        companyId: args.companyId,
        status: "active",
        role: AGENT_ACCESS_ROLE,
        permissions: { path: ["Agent:approve"], equals: true },
      },
      select: { id: true },
    });
    agentsAccessIds = users.map((u) => u.id);
    return agentsAccessIds;
  }
```

In the dynamic-recipient loop, after:

```ts
      if (dyn === "all_managers") for (const x of await dynamicRoleUsers(["manager"])) recipientIds.add(x);
```

add:

```ts
      if (dyn === "agents_access") for (const x of await agentsAccessUsers()) recipientIds.add(x);
```

In `buildLink`, before `    default:`, add:

```ts
    case "agent_run_failed":
    case "agent_needs_human":
      return "/portal/agents/runs";
```

- [ ] **Step 6: Run both tests to verify they pass**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/notifications/__tests__/agent-events.test.ts 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts 2>&1 | tail -6
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: 3 passed; 3 passed; `typecheck exit=0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/notifications/types.ts src/server/modules/notifications/actions.ts src/server/modules/notifications/engine.ts src/server/modules/notifications/__tests__/agent-events.test.ts src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts
git commit -m "feat(notifications): agent failure and needs-a-human alerts reach whoever holds Agents access" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Reading and moving deals for a run

**Files:**
- Create: `src/server/modules/agents/deal-label.ts`, `secrets.ts`, `deps.ts`, `apply-changes.ts`, `notify.ts`
- Test: `src/server/modules/agents/__tests__/deal-label.test.ts`
- Test: `src/server/modules/agents/__tests__/apply-changes.itest.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// src/server/modules/agents/__tests__/deal-label.test.ts
import { describe, it, expect } from "vitest";
import { dealLabel } from "../deal-label";

describe("dealLabel", () => {
  it("is the customer and where the job is", () => {
    expect(dealLabel({ firstName: "Maria", lastName: "Lopez", address: "12 Elm St", city: "Dallas" })).toBe(
      "Maria Lopez · 12 Elm St, Dallas"
    );
  });

  it("leaves out what it does not know", () => {
    expect(dealLabel({ firstName: "Maria", lastName: "Lopez", address: null, city: " " })).toBe("Maria Lopez");
    expect(dealLabel({ firstName: " ", lastName: "", address: "12 Elm St", city: null })).toBe("Unnamed customer · 12 Elm St");
  });
});
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/server/modules/agents/__tests__/apply-changes.itest.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { encryptField } from "@/server/lib/crypto";
import { moveDeal, resolveChanges } from "../apply-changes";
import { buildDeps } from "../deps";
import { resolveSecretRef } from "../secrets";

/**
 * What a run can see and do to deals, against a real database with isolation
 * on: a roofing run cannot find a solar deal, a stage key resolves inside the
 * deal's own pipeline, and a move lands exactly the rows a person's move does.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let otherCompanyId = "";
let roofingPipe = "";
let solarPipe = "";
let roofingLead = "";
let solarLead = "";
let userId = "";
const stage: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Apply Co", slug: `apply-${process.pid}-${Date.now()}` } })).id;
  otherCompanyId = (await db.company.create({ data: { name: "Other Apply Co", slug: `apply-other-${process.pid}-${Date.now()}` } })).id;
  userId = (
    await db.user.create({ data: { companyId, email: `ada-${process.pid}@apply.test`, firstName: "Ada", lastName: "Admin", role: "admin", status: "active", passwordHash: "x" } })
  ).id;

  roofingPipe = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  stage.submitted = (await db.pipelineStage.create({ data: { pipelineId: roofingPipe, key: "submitted", name: "Submitted", position: 0 } })).id;
  stage.action = (
    await db.pipelineStage.create({
      data: { pipelineId: roofingPipe, key: "action_required", name: "Action Required", position: 1, isActionRequired: true, defaultBlocker: "lender", stageType: "externally_blocked" },
    })
  ).id;
  stage.approved = (await db.pipelineStage.create({ data: { pipelineId: roofingPipe, key: "approved", name: "Approved", position: 2 } })).id;

  solarPipe = (await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } })).id;
  const solarStage = await db.pipelineStage.create({ data: { pipelineId: solarPipe, key: "action_required", name: "Solar Action", position: 0 } });

  roofingLead = (
    await db.lead.create({
      data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Maria", lastName: "Lopez", address: "12 Elm St", city: "Dallas" },
    })
  ).id;
  solarLead = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipe, stageId: solarStage.id, firstName: "Sol", lastName: "Customer" } })
  ).id;
});

afterAll(async () => {
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.solarLender.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.pipelineStage.deleteMany({ where: { pipelineId: { in: [roofingPipe, solarPipe] } } });
  await db.pipeline.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await db.$disconnect();
});

const change = (leadId: string, toStageKey: string) => ({ type: "move_stage" as const, leadId, toStageKey, reason: "portal says so" });

describe("resolveChanges", () => {
  it("resolves a change against the deal's own pipeline, in the run's workspace", async () => {
    const [ok, wrongWorkspace, noStage] = await runInVertical("roofing", () =>
      resolveChanges(companyId, [change(roofingLead, "action_required"), change(solarLead, "action_required"), change(roofingLead, "nope")])
    );
    expect(ok.lead).toEqual({ id: roofingLead, label: "Maria Lopez · 12 Elm St, Dallas" });
    expect(ok.fromStage).toMatchObject({ key: "submitted", name: "Submitted" });
    expect(ok.toStage).toMatchObject({ key: "action_required", isActionRequired: true, defaultBlocker: "lender" });
    expect(wrongWorkspace.lead).toBeNull();
    expect(noStage.toStage).toBeNull();
  });
});

describe("moveDeal", () => {
  it("moves a deal as an agent: entry fields, a timeline row via agent, an activity line", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "action_required")]));
    await runInVertical("roofing", () => moveDeal(companyId, roofingLead, c.toStage!, { kind: "agent", agentName: "NTP Poller" }));

    expect(await db.lead.findUniqueOrThrow({ where: { id: roofingLead } })).toMatchObject({
      stageId: stage.action,
      blockedBy: "lender",
      stageAlertLevel: 0,
    });
    expect(await db.leadStageEvent.findFirst({ where: { leadId: roofingLead, exitedAt: null } })).toMatchObject({
      stageName: "Action Required",
      via: "agent",
      movedById: null,
    });
    expect(await db.activityLog.findFirst({ where: { leadId: roofingLead }, orderBy: { createdAt: "desc" } })).toMatchObject({
      type: "stage_change",
      actorId: null,
      message: 'Agent "NTP Poller" moved the deal to Action Required',
    });
  });

  it("names the person when a person approved the change", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "approved")]));
    await runInVertical("roofing", () =>
      moveDeal(companyId, roofingLead, c.toStage!, { kind: "person", userId, fullName: "Ada Admin", agentName: "NTP Poller" })
    );
    expect(await db.leadStageEvent.findFirst({ where: { leadId: roofingLead, exitedAt: null } })).toMatchObject({
      stageName: "Approved",
      movedById: userId,
      via: null,
    });
    expect(await db.activityLog.findFirst({ where: { leadId: roofingLead }, orderBy: { createdAt: "desc" } })).toMatchObject({
      actorId: userId,
      message: 'Ada Admin moved the deal to Approved, approving agent "NTP Poller"',
    });
  });
});

describe("buildDeps", () => {
  it("reads deals in the run's workspace only", async () => {
    const deps = buildDeps(companyId);
    const inRoofing = await runInVertical("roofing", () => deps.deals.inStages(["submitted", "action_required", "approved"]));
    expect(inRoofing.map((d) => [d.id, d.stageKey])).toEqual([[roofingLead, "approved"]]);
    expect(await runInVertical("roofing", () => deps.deals.get(solarLead))).toBeNull();
  });
});

describe("resolveSecretRef", () => {
  it("reads AGENT_ env vars and this company's lender keys, and nothing else", async () => {
    process.env.AGENT_ITEST_TOKEN = "s3cret";
    expect(await resolveSecretRef(companyId, "env:AGENT_ITEST_TOKEN")).toBe("s3cret");
    expect(await resolveSecretRef(companyId, "env:DATABASE_URL")).toBeNull();

    const mine = await db.solarLender.create({ data: { companyId, name: "Itest Lender", apiKeyEncrypted: encryptField("lender-key") } });
    const theirs = await db.solarLender.create({ data: { companyId: otherCompanyId, name: "Other Lender", apiKeyEncrypted: encryptField("not-yours") } });
    expect(await runInVertical("solar", () => resolveSecretRef(companyId, `lender:${mine.id}`))).toBe("lender-key");
    expect(await runInVertical("solar", () => resolveSecretRef(companyId, `lender:${theirs.id}`))).toBeNull();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/deal-label.test.ts 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/apply-changes.itest.ts 2>&1 | tail -6
```

Expected: both FAIL on unresolved imports.

- [ ] **Step 4: Implement `deal-label.ts`**

```ts
// src/server/modules/agents/deal-label.ts
/** The Lead fields a label needs. */
export const DEAL_LABEL_SELECT = { firstName: true, lastName: true, address: true, city: true } as const;

/** "Maria Lopez · 12 Elm St, Dallas": who and where, the way Operations says a deal on the phone. */
export function dealLabel(lead: { firstName: string; lastName: string; address: string | null; city: string | null }): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim() || "Unnamed customer";
  const place = [lead.address?.trim(), lead.city?.trim()].filter(Boolean).join(", ");
  return place ? `${name} · ${place}` : name;
}
```

- [ ] **Step 5: Implement `secrets.ts`**

```ts
// src/server/modules/agents/secrets.ts
import { prisma } from "@/server/db/client";
import { decryptField } from "@/server/lib/crypto";
import { parseSecretRef, readEnvRef } from "./config-guard";

/**
 * Resolve a secret reference for one run: the only two kinds that exist until
 * the spec's Open question 1 (portal credential storage) is decided.
 *
 * Returns the value or null, never throws: a handler decides what a missing
 * credential means for its run. SolarLender is workspace-scoped, so a lender
 * reference resolves only inside a Solar run.
 */
export async function resolveSecretRef(companyId: string, ref: string): Promise<string | null> {
  const parsed = parseSecretRef(ref);
  if (!parsed) return null;
  if (parsed.kind === "env") return readEnvRef(parsed.name, process.env);

  const lender = await prisma.solarLender.findFirst({
    where: { id: parsed.lenderId, companyId },
    select: { apiKeyEncrypted: true },
  });
  try {
    return decryptField(lender?.apiKeyEncrypted ?? null, "lender api key");
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Implement `deps.ts`**

```ts
// src/server/modules/agents/deps.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { DEAL_LABEL_SELECT, dealLabel } from "./deal-label";
import { resolveSecretRef } from "./secrets";
import type { AgentDeps, DealSnapshot } from "./types";

const DEAL_SELECT = {
  id: true,
  ...DEAL_LABEL_SELECT,
  stageChangedAt: true,
  stage: { select: { key: true, name: true } },
} satisfies Prisma.LeadSelect;

type DealRow = Prisma.LeadGetPayload<{ select: typeof DEAL_SELECT }>;

const DEFAULT_DEALS = 100;
const MAX_DEALS = 500;

function toSnapshot(lead: DealRow): DealSnapshot {
  return {
    id: lead.id,
    label: dealLabel(lead),
    stageKey: lead.stage?.key ?? null,
    stageName: lead.stage?.name ?? null,
    stageChangedAt: lead.stageChangedAt,
  };
}

/**
 * The real world, for one run. Every query here is a READ, and the runner calls
 * the handler inside runInVertical, so a roofing run cannot see a solar deal.
 */
export function buildDeps(companyId: string): AgentDeps {
  return {
    now: () => new Date(),
    secrets: { get: (ref) => resolveSecretRef(companyId, ref) },
    deals: {
      async get(leadId) {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId }, select: DEAL_SELECT });
        return lead ? toSnapshot(lead) : null;
      },
      async inStages(stageKeys, opts) {
        if (stageKeys.length === 0) return [];
        const leads = await prisma.lead.findMany({
          where: { companyId, stage: { key: { in: stageKeys } } },
          orderBy: { stageChangedAt: "asc" },
          take: Math.min(Math.max(opts?.limit ?? DEFAULT_DEALS, 1), MAX_DEALS),
          select: DEAL_SELECT,
        });
        return leads.map(toSnapshot);
      },
    },
  };
}
```

- [ ] **Step 7: Implement `apply-changes.ts`**

```ts
// src/server/modules/agents/apply-changes.ts
import { prisma } from "@/server/db/client";
import type { ActiveVertical } from "@/lib/vertical";
import { runAutomations } from "@/server/modules/automations/engine";
import { stageEntryData } from "@/server/modules/pipeline/stage-entry-data";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import { DEAL_LABEL_SELECT, dealLabel } from "./deal-label";
import type { RequestedChange, ResolvedChange, TargetStage } from "./types";

export const TARGET_STAGE_SELECT = {
  id: true,
  key: true,
  name: true,
  position: true,
  isActionRequired: true,
  defaultBlocker: true,
  stageType: true,
} as const;

export type StageMove = { leadId: string; stageId: string };

export type MovedBy =
  | { kind: "agent"; agentName: string }
  | { kind: "person"; userId: string; fullName: string; agentName: string };

/**
 * Everything the gate needs about each change. Call inside runInVertical: Lead
 * is scoped, so a deal in another workspace is simply not found, which the
 * gate records as invalid. The target key resolves in the deal's OWN pipeline.
 */
export async function resolveChanges(companyId: string, changes: RequestedChange[]): Promise<ResolvedChange[]> {
  const resolved: ResolvedChange[] = [];
  for (const change of changes) {
    const lead = await prisma.lead.findFirst({
      where: { id: change.leadId, companyId },
      select: { id: true, pipelineId: true, ...DEAL_LABEL_SELECT, stage: { select: { id: true, key: true, name: true } } },
    });
    const toStage: TargetStage | null = lead?.pipelineId
      ? await prisma.pipelineStage.findFirst({
          where: { pipelineId: lead.pipelineId, key: change.toStageKey },
          select: TARGET_STAGE_SELECT,
        })
      : null;
    resolved.push({
      change,
      lead: lead ? { id: lead.id, label: dealLabel(lead) } : null,
      fromStage: lead?.stage ?? null,
      toStage,
    });
  }
  return resolved;
}

/**
 * Move one deal the way a person's move does (leads/actions.ts moveLeadStage):
 * the stage-entry fields, the timeline row, the activity line, and the
 * stage_changed notification. Call inside the run's workspace.
 *
 * Automations are NOT fired here: the engine establishes its own workspace, so
 * the caller runs runStageEnteredAutomations after leaving runInVertical.
 */
export async function moveDeal(companyId: string, leadId: string, stage: TargetStage, by: MovedBy): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: stageEntryData(stage) });
  await recordStageEntry({
    leadId,
    stageId: stage.id,
    stage,
    ...(by.kind === "agent" ? { via: "agent" as const } : { movedById: by.userId }),
  });
  await prisma.activityLog.create({
    data: {
      companyId,
      type: "stage_change",
      message:
        by.kind === "agent"
          ? `Agent "${by.agentName}" moved the deal to ${stage.name}`
          : `${by.fullName} moved the deal to ${stage.name}, approving agent "${by.agentName}"`,
      actorId: by.kind === "person" ? by.userId : null,
      leadId,
    },
  });
  // Lazily loaded and wrapped: the move is the record, the alert a consequence.
  try {
    const { fireEvent } = await import("@/server/modules/notifications/engine");
    await fireEvent({
      companyId,
      event: "stage_changed",
      actorId: by.kind === "person" ? by.userId : null,
      leadId,
      stageId: stage.id,
    });
  } catch (err) {
    console.error("[agents] stage_changed notification did not load", err);
  }
}

/** Rules waiting at a stage get their turn. Agents are never triggered by automations, so this cannot loop. */
export async function runStageEnteredAutomations(
  companyId: string,
  vertical: ActiveVertical,
  moves: StageMove[]
): Promise<void> {
  for (const move of moves) {
    await runAutomations({
      companyId,
      vertical,
      trigger: "stage_entered",
      leadId: move.leadId,
      payload: { stageId: move.stageId },
      depth: 0,
    });
  }
}
```

- [ ] **Step 8: Implement `notify.ts`**

```ts
// src/server/modules/agents/notify.ts
import type { ActiveVertical } from "@/lib/vertical";
import { runInVertical } from "@/server/vertical/context";

/**
 * Tell people a run failed or needs a human.
 *
 * Inside the run's workspace, because NotificationRule is workspace-scoped and
 * fireEvent swallows the missing-workspace error: fired outside one, it would
 * notify nobody and say nothing (agents-access-recipients.itest.ts proves it).
 *
 * Loaded lazily and wrapped: the run row is the record, and must survive the
 * notifier failing to load.
 */
export async function notifyRun(run: {
  companyId: string;
  vertical: ActiveVertical;
  leadId: string | null;
  status: "failed" | "needs_human";
  summary: string;
  agentName: string;
}): Promise<void> {
  try {
    const { fireEvent } = await import("@/server/modules/notifications/engine");
    await runInVertical(run.vertical, () =>
      fireEvent({
        companyId: run.companyId,
        event: run.status === "failed" ? "agent_run_failed" : "agent_needs_human",
        leadId: run.leadId,
        status: run.summary,
        agentName: run.agentName,
      })
    );
  } catch (err) {
    console.error("[agents] could not send a run notification", run.agentName, err);
  }
}
```

- [ ] **Step 9: Run both tests to verify they pass**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/deal-label.test.ts 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/apply-changes.itest.ts 2>&1 | tail -6
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: 2 passed; 5 passed; `typecheck exit=0`.

- [ ] **Step 10: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/deal-label.ts src/server/modules/agents/secrets.ts src/server/modules/agents/deps.ts src/server/modules/agents/apply-changes.ts src/server/modules/agents/notify.ts src/server/modules/agents/__tests__/deal-label.test.ts src/server/modules/agents/__tests__/apply-changes.itest.ts
git commit -m "feat(agents): read deals in the run's workspace, and move one the way a person does" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: The runner

**Files:**
- Create: `src/server/modules/agents/runner.ts`
- Test: `src/server/modules/agents/__tests__/runner.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/agents/__tests__/runner.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import type { AgentHandler } from "../types";

/**
 * The runner against a real database, with handlers written to misbehave.
 *
 * Every case reads the run ROW back, because the row is the promise: whatever a
 * handler does — succeed, throw, hang, return junk, ask for a move the gate
 * refuses — a person can open the run and see what happened.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const t = vi.hoisted(() => {
  const state = { aborted: false, waiting: false, release: () => {} };
  const anyConfig = (raw: unknown) => ({ ok: true as const, config: raw as { leadId: string; to: string } });
  const handlers: Record<string, AgentHandler> = {
    "test.ok": {
      key: "test.ok" as AgentHandler["key"],
      label: "ok",
      parseConfig: anyConfig,
      async run(ctx) {
        ctx.log("line one");
        return { status: "success", summary: "All good", detail: { checked: 3 } };
      },
    },
    "test.throws": {
      key: "test.throws" as AgentHandler["key"],
      label: "throws",
      parseConfig: anyConfig,
      async run() {
        throw new Error("portal said no");
      },
    },
    "test.hangs": {
      key: "test.hangs" as AgentHandler["key"],
      label: "hangs",
      parseConfig: anyConfig,
      run(ctx) {
        ctx.signal.addEventListener("abort", () => {
          state.aborted = true;
        });
        return new Promise(() => {});
      },
    },
    "test.junk": {
      key: "test.junk" as AgentHandler["key"],
      label: "junk",
      parseConfig: anyConfig,
      async run() {
        return { status: "done" } as never;
      },
    },
    "test.picky": {
      key: "test.picky" as AgentHandler["key"],
      label: "picky",
      parseConfig: () => ({ ok: false as const, error: "needs a portal" }),
      async run() {
        return { status: "success", summary: "unreachable" };
      },
    },
    "test.move": {
      key: "test.move" as AgentHandler["key"],
      label: "move",
      parseConfig: anyConfig,
      async run(ctx) {
        const { leadId, to } = ctx.config as { leadId: string; to: string };
        return { status: "success", summary: "Moved", changes: [{ type: "move_stage", leadId, toStageKey: to, reason: "portal says so" }] };
      },
    },
    "test.fails_with_move": {
      key: "test.fails_with_move" as AgentHandler["key"],
      label: "fails with move",
      parseConfig: anyConfig,
      async run(ctx) {
        const { leadId, to } = ctx.config as { leadId: string; to: string };
        return { status: "failed", summary: "Portal down", error: "503", changes: [{ type: "move_stage", leadId, toStageKey: to, reason: "x" }] };
      },
    },
    "test.waits": {
      key: "test.waits" as AgentHandler["key"],
      label: "waits",
      parseConfig: anyConfig,
      async run() {
        state.waiting = true;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
        return { status: "success", summary: "Late" };
      },
    },
  };
  return { state, handlers };
});

vi.mock("../registry", () => ({
  handlerFor: (key: string) => t.handlers[key] ?? null,
  handlerOptions: () => [],
  HANDLERS: {},
}));

import { AGENT_SELECT, createRun, executeRun, writeMissingHandlerRun } from "../runner";
import { readDetail } from "../detail";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let ownerId = "";
let pipelineId = "";
let leadId = "";
const stage: Record<string, string> = {};
let seq = 0;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Runner Co", slug: `runner-${process.pid}-${Date.now()}` } })).id;
  ownerId = (
    await db.user.create({ data: { companyId, email: `owner-${process.pid}@runner.test`, firstName: "Olive", lastName: "Owner", role: "super_admin", status: "active", passwordHash: "x" } })
  ).id;
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  const defs = [
    ["from", "From", false],
    ["side", "Side", true],
    ["main", "Main", false],
  ] as const;
  for (const [position, [key, name, isActionRequired]] of defs.entries()) {
    stage[key] = (await db.pipelineStage.create({ data: { pipelineId, key, name, position, isActionRequired } })).id;
  }
  for (const [event, title] of [
    ["agent_run_failed", "Agent failed: {{agent}}"],
    ["agent_needs_human", "Needs a human: {{agent}}"],
  ] as const) {
    await db.notificationRule.create({
      data: { companyId, vertical: "roofing", name: event, event, recipients: { roles: ["super_admin"], userIds: [], dynamic: [] }, channels: ["in_app"], titleTemplate: title, bodyTemplate: "{{status}}" },
    });
  }
  // A rule waiting at the side-state, to prove an agent's move sets automations off.
  await db.automationRule.create({
    data: { companyId, vertical: "roofing", name: "Side → Main", trigger: "stage_entered", conditions: { stageId: stage.side }, actions: [{ type: "move_stage", stageId: stage.main }] },
  });
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  leadId = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Maria", lastName: "Lopez", address: "12 Elm St" } })
  ).id;
  t.state.aborted = false;
  t.state.waiting = false;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.notificationRule.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const agent = (handlerKey: string, over: Partial<Prisma.AgentUncheckedCreateInput> = {}) =>
  db.agent.create({
    data: { companyId, name: `Agent ${++seq}`, handlerKey, department: "operations", timeoutSeconds: 60, ...over },
    select: AGENT_SELECT,
  });

async function runOf(handlerKey: string, over: Partial<Prisma.AgentUncheckedCreateInput> = {}, opts: Parameters<typeof executeRun>[1] = {}) {
  const a = await agent(handlerKey, over);
  const { id } = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "running" });
  const status = await executeRun(id, { owned: true, ...opts });
  const row = await db.agentRun.findUniqueOrThrow({ where: { id } });
  return { status, row, detail: readDetail(row.detail) };
}

const stageOfLead = async () => (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId;

describe("executeRun", () => {
  it("records a success with its summary, log, handler detail and duration", async () => {
    const { status, row, detail } = await runOf("test.ok");
    expect(status).toBe("success");
    expect(row).toMatchObject({ status: "success", summary: "All good", error: null });
    expect(row.finishedAt).not.toBeNull();
    expect(detail.log).toEqual(["line one"]);
    expect(detail.handler).toEqual({ checked: 3 });
    expect(detail.durationMs).toBeGreaterThanOrEqual(0);
    expect(await db.notification.count({ where: { companyId } })).toBe(0);
  });

  it("records a throw as failed, keeps the stack, and tells the owner", async () => {
    const { row } = await runOf("test.throws");
    expect(row).toMatchObject({ status: "failed", summary: "Handler threw: portal said no" });
    expect(row.error).toContain("Error: portal said no");
    expect(row.error).toContain("at ");
    const n = await db.notification.findFirst({ where: { companyId, userId: ownerId } });
    expect(n?.title).toMatch(/^Agent failed: Agent \d+$/);
  });

  it("stops waiting at the deadline, aborts the handler, and fails the run", async () => {
    const { row } = await runOf("test.hangs", {}, { maxHandlerMs: 100 });
    expect(row).toMatchObject({ status: "failed", summary: "Timed out after 1 s." });
    expect(t.state.aborted).toBe(true);
  });

  it("fails a run whose handler returns something that is not a result", async () => {
    const { row } = await runOf("test.junk");
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/invalid result/i);
  });

  it("fails a run whose handler is not deployed, with the fix in the message", async () => {
    const { row } = await runOf("bank.ntp_poll");
    expect(row).toMatchObject({
      status: "failed",
      error: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
    });
  });

  it("fails a run whose config the handler refuses", async () => {
    const { row } = await runOf("test.picky");
    expect(row).toMatchObject({ status: "failed", summary: "Config is invalid: needs a portal" });
  });
});

describe("the gate, applied", () => {
  it("lets a gated agent move a deal into an Action Required stage, like a person would, and automations fire", async () => {
    const { row, detail } = await runOf("test.move", { requiresHumanGate: true, config: { leadId, to: "side" } });
    expect(row.status).toBe("success");
    expect(detail.changes[0]).toMatchObject({ outcome: "applied", dealLabel: "Maria Lopez · 12 Elm St", fromStage: { key: "from" }, toStage: { key: "side" } });
    const events = await db.leadStageEvent.findMany({ where: { leadId }, orderBy: { enteredAt: "asc" } });
    expect(events.map((e) => [e.stageName, e.via])).toEqual([
      ["Side", "agent"],
      ["Main", "automation"],
    ]);
    expect(await db.activityLog.count({ where: { leadId, message: { contains: "moved the deal to Side" } } })).toBe(1);
    expect(await db.automationRun.count({ where: { leadId } })).toBeGreaterThan(0);
  });

  it("holds a gated move onto the main line for a human, and says so", async () => {
    const { row, detail } = await runOf("test.move", { requiresHumanGate: true, config: { leadId, to: "main" } });
    expect(row.status).toBe("needs_human");
    expect(detail.changes[0]).toMatchObject({ outcome: "held" });
    expect(await stageOfLead()).toBe(stage.from);
    const n = await db.notification.findFirst({ where: { companyId, userId: ownerId } });
    expect(n?.title).toMatch(/^Needs a human: /);
  });

  it("lets an ungated agent move a deal anywhere in its pipeline", async () => {
    const { row } = await runOf("test.move", { requiresHumanGate: false, config: { leadId, to: "main" } });
    expect(row.status).toBe("success");
    expect(await stageOfLead()).toBe(stage.main);
  });

  it("applies nothing when the handler itself reports failure", async () => {
    const { row, detail } = await runOf("test.fails_with_move", { requiresHumanGate: false, config: { leadId, to: "main" } });
    expect(row).toMatchObject({ status: "failed", summary: "Portal down", error: "503" });
    expect(detail.changes[0]).toMatchObject({ outcome: "discarded" });
    expect(await stageOfLead()).toBe(stage.from);
  });

  it("fails the run and applies nothing when a change names a stage that is not there", async () => {
    const { row, detail } = await runOf("test.move", { requiresHumanGate: false, config: { leadId, to: "nowhere" } });
    expect(row.status).toBe("failed");
    expect(detail.changes[0]).toMatchObject({ outcome: "invalid" });
    expect(await stageOfLead()).toBe(stage.from);
  });
});

describe("ownership", () => {
  it("executes a queued run exactly once, however many callers race for it", async () => {
    const a = await agent("test.ok");
    const { id } = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "queued" });
    const results = await Promise.all([executeRun(id), executeRun(id)]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect((await db.agentRun.findUniqueOrThrow({ where: { id } })).status).toBe("success");
  });

  it("keeps the reaper's verdict and files the late result beside it", async () => {
    const a = await agent("test.waits");
    const { id } = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "running" });
    const pending = executeRun(id, { owned: true });
    await vi.waitFor(() => expect(t.state.waiting).toBe(true));
    await db.agentRun.update({ where: { id }, data: { status: "failed", finishedAt: new Date(), summary: "Reaped", error: "Reaped" } });
    t.state.release();
    expect(await pending).toBe("failed");
    const row = await db.agentRun.findUniqueOrThrow({ where: { id } });
    expect(row.summary).toBe("Reaped");
    expect(readDetail(row.detail).lateResult).toMatchObject({ status: "success", summary: "Late" });
  });
});

describe("writeMissingHandlerRun", () => {
  it("writes the failed run straight away and announces it", async () => {
    const a = await agent("bank.ntp_poll");
    const { id, error } = await writeMissingHandlerRun({ agent: a, vertical: "roofing", trigger: "scheduled" });
    expect(error).toMatch(/bank\.ntp_poll/);
    expect(await db.agentRun.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "failed", trigger: "scheduled" });
    expect(await db.notification.count({ where: { companyId, userId: ownerId } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/runner.itest.ts 2>&1 | tail -6
```

Expected: FAIL — `Failed to resolve import "../runner"`.

- [ ] **Step 3: Implement the runner**

```ts
// src/server/modules/agents/runner.ts
import type { AgentRunStatus, AgentRunTrigger, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { ActiveVertical } from "@/lib/vertical";
import { asActiveVertical, runInVertical } from "@/server/vertical/context";
import { moveDeal, resolveChanges, runStageEnteredAutomations, type StageMove } from "./apply-changes";
import { canStart, handlerDeadlineMs, pastApplyDeadline } from "./budget";
import { emptyDetail, errorText, missingHandlerMessage, readDetail } from "./detail";
import { buildDeps } from "./deps";
import { discardAll, finalStatus, planChanges } from "./gate";
import { notifyRun } from "./notify";
import { handlerFor } from "./registry";
import { parseAgentResult, truncateSummary } from "./result";
import { withTimeout } from "./timeout";
import type { AgentDeps, ChangeRecord, RequestedChange, RunDetail } from "./types";

/**
 * Runs an agent once, in one workspace, and writes down everything.
 *
 * Shared by the cron tick and Run now. Nothing here knows about Vercel, so a
 * worker outside it can call executeRun(runId) against the same tables.
 * Nothing is retried: a failure waits for a person.
 */

export const AGENT_SELECT = {
  id: true,
  companyId: true,
  name: true,
  handlerKey: true,
  config: true,
  timeoutSeconds: true,
  requiresHumanGate: true,
} satisfies Prisma.AgentSelect;

export type RunnableAgent = Prisma.AgentGetPayload<{ select: typeof AGENT_SELECT }>;

type NewRun = {
  agent: RunnableAgent;
  vertical: ActiveVertical;
  trigger: AgentRunTrigger;
  triggeredById?: string | null;
  now?: Date;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];

export async function hasRunInFlight(agentId: string, vertical: ActiveVertical): Promise<boolean> {
  const inFlight = await prisma.agentRun.count({
    where: { agentId, vertical, status: { in: ["queued", "running"] } },
  });
  return inFlight > 0;
}

/** The run row, written BEFORE anything executes, so a run that dies mid-flight still exists for the reaper. */
export async function createRun(input: NewRun & { status: "queued" | "running" }): Promise<{ id: string }> {
  return prisma.agentRun.create({
    data: {
      companyId: input.agent.companyId,
      agentId: input.agent.id,
      vertical: input.vertical,
      trigger: input.trigger,
      status: input.status,
      triggeredById: input.triggeredById ?? null,
      startedAt: input.status === "running" ? (input.now ?? new Date()) : null,
      detail: json(emptyDetail(input.agent)),
    },
    select: { id: true },
  });
}

/** A due or manual run of an agent whose handler is not in this build: recorded as failed, and announced. */
export async function writeMissingHandlerRun(input: NewRun): Promise<{ id: string; error: string }> {
  const error = missingHandlerMessage(input.agent.handlerKey);
  const now = input.now ?? new Date();
  const run = await prisma.agentRun.create({
    data: {
      companyId: input.agent.companyId,
      agentId: input.agent.id,
      vertical: input.vertical,
      trigger: input.trigger,
      status: "failed",
      triggeredById: input.triggeredById ?? null,
      startedAt: now,
      finishedAt: now,
      summary: truncateSummary(error),
      error,
      detail: json({ ...emptyDetail(input.agent), durationMs: 0 }),
    },
    select: { id: true },
  });
  await notifyRun({ companyId: input.agent.companyId, vertical: input.vertical, leadId: null, status: "failed", summary: error, agentName: input.agent.name });
  return { id: run.id, error };
}

export type ExecuteOptions = {
  /** The tick created this run as `running`, so there is no queued → running claim to make. */
  owned?: boolean;
  /** When the time budget started: the tick's start, or Run now's click. */
  anchorMs?: number;
  /** Test seam: a fake outside world. */
  deps?: AgentDeps;
  /** Test seam: cap the handler deadline below the budget. */
  maxHandlerMs?: number;
};

type RunCtx = {
  runId: string;
  companyId: string;
  vertical: ActiveVertical;
  leadId: string | null;
  agentName: string;
  detail: RunDetail;
  startedMs: number;
};

type Verdict = { status: "success" | "failed" | "needs_human"; summary: string; error?: string | null };

export async function executeRun(runId: string, opts: ExecuteOptions = {}): Promise<AgentRunStatus | null> {
  const anchorMs = opts.anchorMs ?? Date.now();

  if (!opts.owned) {
    const claimed = await prisma.agentRun.updateMany({
      where: { id: runId, status: "queued" },
      data: { status: "running", startedAt: new Date() },
    });
    if (claimed.count === 0) return null;
  }

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, companyId: true, vertical: true, trigger: true, leadId: true, startedAt: true, detail: true, agent: { select: AGENT_SELECT } },
  });
  if (!run) return null;

  const { agent } = run;
  const ctx: RunCtx = {
    runId: run.id,
    companyId: run.companyId,
    vertical: asActiveVertical(run.vertical),
    leadId: run.leadId,
    agentName: agent.name,
    detail: readDetail(run.detail),
    startedMs: run.startedAt?.getTime() ?? Date.now(),
  };

  const handler = handlerFor(agent.handlerKey);
  if (!handler) {
    const message = missingHandlerMessage(agent.handlerKey);
    return finalize(ctx, { status: "failed", summary: message, error: message });
  }

  const config = handler.parseConfig(agent.config);
  if (!config.ok) {
    return finalize(ctx, { status: "failed", summary: `Config is invalid: ${config.error}`, error: config.error });
  }

  const budgetMs = handlerDeadlineMs(agent.timeoutSeconds, anchorMs, Date.now());
  if (!canStart(budgetMs)) {
    const message = "Not started: less than 5 seconds of the time budget were left.";
    return finalize(ctx, { status: "failed", summary: message, error: message });
  }
  const deadlineMs = Math.min(budgetMs, opts.maxHandlerMs ?? Number.POSITIVE_INFINITY);

  const controller = new AbortController();
  const outcome = await runInVertical(ctx.vertical, () =>
    withTimeout(
      () =>
        handler.run({
          companyId: run.companyId,
          vertical: ctx.vertical,
          runId: run.id,
          trigger: run.trigger,
          leadId: run.leadId,
          config: config.config,
          signal: controller.signal,
          log: (line) => {
            ctx.detail.log.push(String(line));
          },
          deps: opts.deps ?? buildDeps(run.companyId),
        }),
      deadlineMs,
      controller
    )
  );

  if (outcome.kind === "threw") {
    return finalize(ctx, { status: "failed", summary: `Handler threw: ${firstLine(outcome.err)}`, error: errorText(outcome.err) });
  }
  if (outcome.kind === "timeout") {
    const message = `Timed out after ${Math.max(1, Math.ceil(deadlineMs / 1000))} s.`;
    return finalize(ctx, { status: "failed", summary: message, error: message });
  }

  const parsed = parseAgentResult(outcome.value);
  if (!parsed.ok) {
    return finalize(ctx, { status: "failed", summary: "Handler returned an invalid result.", error: parsed.error });
  }

  const result = parsed.result;
  const changes = result.changes ?? [];
  ctx.detail.handler = result.detail ?? null;

  if (result.status === "failed") {
    ctx.detail.changes = discardAll(changes, "Not applied: the handler reported failure.");
    return finalize(ctx, { status: "failed", summary: result.summary, error: result.error ?? result.summary });
  }

  const applied = await runInVertical(ctx.vertical, () => applyChanges(ctx, agent, changes, anchorMs));
  ctx.detail.changes = applied.records;
  await runStageEnteredAutomations(run.companyId, ctx.vertical, applied.moves);

  if (applied.tooLate) {
    return finalize(ctx, {
      status: "failed",
      summary: "Failed: the run passed its apply deadline, so no change was applied.",
      error: "Apply deadline passed before changes were applied.",
    });
  }
  if (applied.error !== null) {
    return finalize(ctx, { status: "failed", summary: `Failed while applying changes: ${firstLine(applied.error)}`, error: errorText(applied.error) });
  }

  const status = finalStatus(result.status, applied.records);
  return finalize(ctx, {
    status,
    summary: result.summary,
    error: status === "failed" ? (result.error ?? "A requested change was invalid, so nothing was applied.") : (result.error ?? null),
  });
}

/** Plan every change through the gate, then apply the ones it allows, in order. Call inside the run's workspace. */
async function applyChanges(
  ctx: RunCtx,
  agent: RunnableAgent,
  changes: RequestedChange[],
  anchorMs: number
): Promise<{ records: ChangeRecord[]; moves: StageMove[]; tooLate: boolean; error: unknown }> {
  const planned = planChanges(await resolveChanges(ctx.companyId, changes), agent.requiresHumanGate);
  const moves: StageMove[] = [];

  if (pastApplyDeadline(anchorMs, Date.now())) {
    const records = planned.map(
      (c): ChangeRecord => (c.outcome === "applied" ? { ...c, outcome: "discarded", note: "Not applied: the run passed its apply deadline." } : c)
    );
    return { records, moves, tooLate: true, error: null };
  }

  const records: ChangeRecord[] = [];
  let error: unknown = null;
  for (const c of planned) {
    if (c.outcome !== "applied" || !c.toStage) {
      records.push(c);
      continue;
    }
    if (error !== null) {
      records.push({ ...c, outcome: "discarded", note: "Not applied: an earlier change in this run failed." });
      continue;
    }
    try {
      await moveDeal(ctx.companyId, c.leadId, c.toStage, { kind: "agent", agentName: agent.name });
      moves.push({ leadId: c.leadId, stageId: c.toStage.id });
      records.push(c);
    } catch (err) {
      error = err;
      records.push({ ...c, outcome: "discarded", note: `Not applied: ${firstLine(err)}` });
    }
  }
  return { records, moves, tooLate: false, error };
}

/**
 * Write the verdict, if the run is still ours. The compare-and-set on
 * `running` is what makes the reaper's word final: when it closed the run
 * first, this run stays failed and what came back is kept as lateResult.
 */
async function finalize(ctx: RunCtx, verdict: Verdict): Promise<AgentRunStatus> {
  const finishedAt = new Date();
  ctx.detail.durationMs = finishedAt.getTime() - ctx.startedMs;
  const summary = truncateSummary(verdict.summary);

  const done = await prisma.agentRun.updateMany({
    where: { id: ctx.runId, status: "running" },
    data: { status: verdict.status, finishedAt, summary, error: verdict.error ?? null, detail: json(ctx.detail) },
  });

  if (done.count === 0) {
    const current = await prisma.agentRun.findUnique({ where: { id: ctx.runId }, select: { status: true, detail: true } });
    const kept = readDetail(current?.detail);
    kept.lateResult = {
      status: verdict.status,
      summary,
      error: verdict.error ?? null,
      log: ctx.detail.log,
      handler: ctx.detail.handler,
      changes: ctx.detail.changes,
      at: finishedAt.toISOString(),
    };
    await prisma.agentRun.update({ where: { id: ctx.runId }, data: { detail: json(kept) } });
    return current?.status ?? "failed";
  }

  if (verdict.status !== "success") {
    await notifyRun({ companyId: ctx.companyId, vertical: ctx.vertical, leadId: ctx.leadId, status: verdict.status, summary, agentName: ctx.agentName });
  }
  return verdict.status;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/runner.itest.ts 2>&1 | tail -6
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/server/modules/agents
```

Expected: `Tests  14 passed (14)`; `typecheck exit=0`; eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/runner.ts src/server/modules/agents/__tests__/runner.itest.ts
git commit -m "feat(agents): the runner — a row before anything runs, a deadline, the gate, and a verdict nothing overwrites" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: The reaper, the tick, and the cron route

**Files:**
- Create: `src/server/modules/agents/reaper.ts`, `src/server/modules/agents/tick.ts`, `src/app/api/cron/agents/route.ts`
- Modify: `vercel.json`
- Test: `src/server/modules/agents/__tests__/cron-route.test.ts`
- Test: `src/server/modules/agents/__tests__/tick.itest.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// src/server/modules/agents/__tests__/cron-route.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CRON_MAX_DURATION_SECONDS } from "../budget";

const ROUTE = join(__dirname, "../../../../app/api/cron/agents/route.ts");
const VERCEL = join(__dirname, "../../../../../vercel.json");

describe("the agents cron route", () => {
  it("exists", () => {
    expect(existsSync(ROUTE)).toBe(true);
  });

  it("declares the function limit the tick budget is built on", () => {
    expect(readFileSync(ROUTE, "utf8")).toContain(`export const maxDuration = ${CRON_MAX_DURATION_SECONDS};`);
  });

  it("refuses a caller without the cron secret before it does anything", () => {
    const src = readFileSync(ROUTE, "utf8");
    expect(src.indexOf("assertCronRequest(req)")).toBeGreaterThan(-1);
    expect(src.indexOf("assertCronRequest(req)")).toBeLessThan(src.indexOf("tick(new Date())"));
  });

  it("is on the clock every minute", () => {
    const vercel = JSON.parse(readFileSync(VERCEL, "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/agents", schedule: "* * * * *" });
  });
});
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/server/modules/agents/__tests__/tick.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * One minute of the clock, against a real database: due agents run once, two
 * ticks never double a run, the five-run cap holds, and nothing stays running.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const t = vi.hoisted(() => ({
  handlers: {
    "test.ok": {
      key: "test.ok",
      label: "ok",
      parseConfig: (raw: unknown) => ({ ok: true as const, config: raw }),
      async run() {
        return { status: "success" as const, summary: "Ticked" };
      },
    },
  } as Record<string, unknown>,
}));

vi.mock("../registry", () => ({
  handlerFor: (key: string) => t.handlers[key] ?? null,
  handlerOptions: () => [],
  HANDLERS: {},
}));

import { tick } from "../tick";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let seq = 0;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Tick Co", slug: `tick-${process.pid}-${Date.now()}` } })).id;
});

beforeEach(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  // The tick sees every company in this schema. Leftovers from other files
  // must not take this file's five slots or its reaper counts.
  await db.agent.updateMany({ where: { companyId: { not: companyId }, enabled: true }, data: { enabled: false } });
  await db.agentRun.updateMany({ where: { companyId: { not: companyId }, status: { in: ["queued", "running"] } }, data: { status: "failed" } });
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const dueAgent = (over: Partial<Prisma.AgentUncheckedCreateInput> = {}) =>
  db.agent.create({
    data: {
      companyId,
      name: `Due ${++seq}`,
      handlerKey: "test.ok",
      department: "operations",
      vertical: "roofing",
      enabled: true,
      schedule: "* * * * *",
      nextRunAt: new Date(Date.now() - 60_000),
      ...over,
    },
  });

const runsOf = (agentId: string) => db.agentRun.findMany({ where: { agentId }, orderBy: { createdAt: "asc" } });
const nextRunOf = async (agentId: string) => (await db.agent.findUniqueOrThrow({ where: { id: agentId } })).nextRunAt;

describe("tick", () => {
  it("runs a due agent once and moves its next run past now", async () => {
    const a = await dueAgent();
    const now = new Date();
    const report = await tick(now);
    expect(report.started).toBe(1);
    expect((await runsOf(a.id)).map((r) => [r.trigger, r.status, r.vertical, r.summary])).toEqual([["scheduled", "success", "roofing", "Ticked"]]);
    expect((await nextRunOf(a.id))!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("claims a due agent exactly once when two ticks run at the same moment", async () => {
    const a = await dueAgent();
    const now = new Date();
    await Promise.all([tick(now), tick(now)]);
    expect(await runsOf(a.id)).toHaveLength(1);
  });

  it("runs a Both agent once in each live workspace", async () => {
    const a = await dueAgent({ vertical: null });
    await tick(new Date());
    expect((await runsOf(a.id)).map((r) => r.vertical).sort()).toEqual(["roofing", "solar"]);
  });

  it("writes a failed run for a missing handler and keeps the agent on its schedule", async () => {
    const a = await dueAgent({ handlerKey: "bank.ntp_poll" });
    const now = new Date();
    const report = await tick(now);
    expect(report.missingHandler).toBe(1);
    expect((await runsOf(a.id))[0]).toMatchObject({
      status: "failed",
      error: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
    });
    expect((await nextRunOf(a.id))!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("does not start a second run while one is in flight", async () => {
    const a = await dueAgent();
    await db.agentRun.create({ data: { companyId, agentId: a.id, vertical: "roofing", trigger: "manual", status: "running", startedAt: new Date() } });
    await tick(new Date());
    expect(await runsOf(a.id)).toHaveLength(1);
  });

  it("starts at most five runs in one tick, and leaves the rest due", async () => {
    const agents = [];
    for (let i = 0; i < 6; i++) agents.push(await dueAgent({ nextRunAt: new Date(Date.now() - 120_000 + i * 1000) }));
    const now = new Date();
    const report = await tick(now);
    expect(report.started).toBe(5);
    expect(await runsOf(agents[5].id)).toHaveLength(0);
    expect((await nextRunOf(agents[5].id))!.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("reaps a run stuck in running and one that never started", async () => {
    const a = await dueAgent({ enabled: false, nextRunAt: null, timeoutSeconds: 60 });
    const now = new Date();
    const stuck = await db.agentRun.create({
      data: { companyId, agentId: a.id, vertical: "roofing", trigger: "scheduled", status: "running", startedAt: new Date(now.getTime() - 125_000) },
    });
    const never = await db.agentRun.create({
      data: { companyId, agentId: a.id, vertical: "roofing", trigger: "manual", status: "queued", createdAt: new Date(now.getTime() - 11 * 60_000) },
    });
    const report = await tick(now);
    expect(report.reaped).toBe(2);
    const stuckRow = await db.agentRun.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(stuckRow.status).toBe("failed");
    expect(stuckRow.error).toMatch(/^Reaped: still marked running 1 min after its 60 s timeout\./);
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: never.id } })).toMatchObject({ status: "failed", error: "Never started." });
  });

  it("starts a manual run that after() never picked up", async () => {
    const a = await dueAgent({ enabled: false, nextRunAt: null });
    const run = await db.agentRun.create({
      data: { companyId, agentId: a.id, vertical: "roofing", trigger: "manual", status: "queued", createdAt: new Date(Date.now() - 31_000) },
    });
    await tick(new Date());
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "success", summary: "Ticked" });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/cron-route.test.ts 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/tick.itest.ts 2>&1 | tail -6
```

Expected: the unit file fails 4 (no route, no cron entry); the itest fails on `Failed to resolve import "../tick"`.

- [ ] **Step 4: Implement the reaper**

```ts
// src/server/modules/agents/reaper.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asActiveVertical } from "@/server/vertical/context";
import { MIN_TIMEOUT_SECONDS } from "./budget";
import { notifyRun } from "./notify";
import { truncateSummary } from "./result";

/**
 * No run stays `running` forever.
 *
 * A function that is killed — a deploy, a crash, the 300 s limit — never
 * writes its run's final status. The next tick closes the row as failed, so
 * the log never shows something as still happening that stopped long ago.
 */
export const REAP_GRACE_MS = 60_000;
export const QUEUED_EXPIRY_MS = 10 * 60_000;
const BATCH = 200;

const RUN_SELECT = {
  id: true,
  companyId: true,
  vertical: true,
  leadId: true,
  startedAt: true,
  createdAt: true,
  agent: { select: { name: true, timeoutSeconds: true } },
} satisfies Prisma.AgentRunSelect;

type StuckRun = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

export async function reapStuckRuns(now: Date): Promise<number> {
  const nowMs = now.getTime();
  let reaped = 0;

  const running = await prisma.agentRun.findMany({
    where: { status: "running", startedAt: { lt: new Date(nowMs - MIN_TIMEOUT_SECONDS * 1000 - REAP_GRACE_MS) } },
    orderBy: { startedAt: "asc" },
    take: BATCH,
    select: RUN_SELECT,
  });
  for (const run of running) {
    const startedMs = (run.startedAt ?? run.createdAt).getTime();
    const timeoutMs = run.agent.timeoutSeconds * 1000;
    if (nowMs - startedMs <= timeoutMs + REAP_GRACE_MS) continue;
    const minutes = Math.max(1, Math.round((nowMs - startedMs - timeoutMs) / 60_000));
    const message =
      `Reaped: still marked running ${minutes} min after its ${run.agent.timeoutSeconds} s timeout. ` +
      "The process running it stopped (deploy, crash or platform limit); nothing after the last log line is known to have happened.";
    if (await close(run, "running", now, message)) reaped++;
  }

  const queued = await prisma.agentRun.findMany({
    where: { status: "queued", createdAt: { lt: new Date(nowMs - QUEUED_EXPIRY_MS) } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: RUN_SELECT,
  });
  for (const run of queued) {
    if (await close(run, "queued", now, "Never started.")) reaped++;
  }

  return reaped;
}

/** Compare-and-set on the status it was found in: a run that finished meanwhile keeps its own verdict. */
async function close(run: StuckRun, from: "running" | "queued", now: Date, message: string): Promise<boolean> {
  const done = await prisma.agentRun.updateMany({
    where: { id: run.id, status: from },
    data: { status: "failed", finishedAt: now, summary: truncateSummary(message), error: message },
  });
  if (done.count === 0) return false;
  await notifyRun({
    companyId: run.companyId,
    vertical: asActiveVertical(run.vertical),
    leadId: run.leadId,
    status: "failed",
    summary: message,
    agentName: run.agent.name,
  });
  return true;
}
```

- [ ] **Step 5: Implement the tick**

```ts
// src/server/modules/agents/tick.ts
import type { AgentRunStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { companyVerticals } from "@/server/auth/vertical";
import { MAX_RUNS_PER_TICK } from "./budget";
import { reapStuckRuns } from "./reaper";
import { handlerFor } from "./registry";
import { AGENT_SELECT, createRun, executeRun, hasRunInFlight, writeMissingHandlerRun } from "./runner";
import { nextRunAtFor } from "./schedule";
import { agentRunVerticals } from "./verticals";

/** A Run now whose after() has not started it within this long is started by the tick. */
export const STALE_QUEUED_MS = 30_000;
const DUE_BATCH = 50;

export type TickReport = {
  reaped: number;
  started: number;
  missingHandler: number;
  skippedInFlight: number;
  results: { runId: string; status: AgentRunStatus | null }[];
};

/**
 * One minute of the clock:
 *  1. reap stuck runs;
 *  2. start manual runs after() never picked up;
 *  3. claim due agents, oldest first, while every workspace each will run in
 *     still fits under the cap — a compare-and-set on nextRunAt, so two ticks
 *     cannot both claim one (no lock table, and raw SQL is lint-banned here);
 *  4. execute everything started, concurrently, inside the budget (budget.ts).
 */
export async function tick(now: Date = new Date()): Promise<TickReport> {
  const anchorMs = now.getTime();
  const report: TickReport = { reaped: 0, started: 0, missingHandler: 0, skippedInFlight: 0, results: [] };

  report.reaped = await reapStuckRuns(now);

  const toRun: { runId: string; owned: boolean }[] = [];

  const stale = await prisma.agentRun.findMany({
    where: { status: "queued", createdAt: { lt: new Date(anchorMs - STALE_QUEUED_MS) } },
    orderBy: { createdAt: "asc" },
    take: MAX_RUNS_PER_TICK,
    select: { id: true },
  });
  for (const run of stale) toRun.push({ runId: run.id, owned: false });

  const live = companyVerticals();
  const due = await prisma.agent.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: DUE_BATCH,
    select: { ...AGENT_SELECT, vertical: true, enabled: true, schedule: true, nextRunAt: true },
  });

  for (const agent of due) {
    const verticals = agentRunVerticals(agent.vertical, live);
    // All of an agent's workspaces or none: one that does not fit waits for the
    // next tick rather than half-running, and nothing younger jumps ahead of it.
    if (toRun.length + verticals.length > MAX_RUNS_PER_TICK) break;

    const claimed = await prisma.agent.updateMany({
      where: { id: agent.id, enabled: true, nextRunAt: agent.nextRunAt },
      data: { nextRunAt: nextRunAtFor(agent, now) },
    });
    if (claimed.count === 0) continue;

    for (const vertical of verticals) {
      if (await hasRunInFlight(agent.id, vertical)) {
        report.skippedInFlight++;
        continue;
      }
      if (!handlerFor(agent.handlerKey)) {
        await writeMissingHandlerRun({ agent, vertical, trigger: "scheduled", now });
        report.missingHandler++;
        continue;
      }
      const run = await createRun({ agent, vertical, trigger: "scheduled", status: "running", now });
      toRun.push({ runId: run.id, owned: true });
    }
  }

  report.started = toRun.length;
  const settled = await Promise.allSettled(toRun.map((r) => executeRun(r.runId, { owned: r.owned, anchorMs })));
  settled.forEach((outcome, i) => {
    if (outcome.status === "rejected") {
      console.error("[agents] a run crashed before it could finish; the reaper will close it", toRun[i].runId, outcome.reason);
    }
    report.results.push({ runId: toRun[i].runId, status: outcome.status === "fulfilled" ? outcome.value : null });
  });
  return report;
}
```

- [ ] **Step 6: Create the cron route**

```ts
// src/app/api/cron/agents/route.ts
import { runUnscoped } from "@/server/vertical/context";
import { assertCronRequest } from "@/server/auth/cron";
import { tick } from "@/server/modules/agents/tick";

// Agents: every minute, run whatever is due. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>`; it refuses when CRON_SECRET is unset.
//
// 300 s is the limit src/server/modules/agents/budget.ts is built on, and a
// test reads this file to make sure the two agree. Unscoped only to FIND the
// work: every handler, change and alert runs inside its own run's workspace.
//
// VERIFY ANY CHANGE ON A PRODUCTION BUILD. `next dev` loads context.ts twice,
// so runInVertical silently no-ops there.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    const report = await runUnscoped("cron: agents tick, every company and workspace", () => tick(new Date()));
    return Response.json({ ok: true, ...report });
  } catch (err) {
    console.error("[cron:agents] failed", err);
    return new Response("Error", { status: 500 });
  }
}
```

- [ ] **Step 7: Put it on the clock**

In `vercel.json`, replace:

```json
    { "path": "/api/cron/automations", "schedule": "0 15 * * *" }
  ]
```

with:

```json
    { "path": "/api/cron/automations", "schedule": "0 15 * * *" },
    { "path": "/api/cron/agents", "schedule": "* * * * *" }
  ]
```

- [ ] **Step 8: Run both tests to verify they pass**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/cron-route.test.ts 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/tick.itest.ts 2>&1 | tail -6
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: 4 passed; 8 passed; `typecheck exit=0`.

- [ ] **Step 9: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/reaper.ts src/server/modules/agents/tick.ts src/app/api/cron/agents/route.ts vercel.json src/server/modules/agents/__tests__/cron-route.test.ts src/server/modules/agents/__tests__/tick.itest.ts
git commit -m "feat(agents): a per-minute tick — reap, claim once, five at a time, inside 300 s" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: The production build refuses an enabled agent with no handler

**Files:**
- Create: `src/server/modules/agents/handler-check.ts`, `scripts/check-agent-handlers.ts`
- Modify: `package.json` (`scripts.build`)
- Test: `src/server/modules/agents/__tests__/handler-check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/agents/__tests__/handler-check.test.ts
import { describe, it, expect } from "vitest";
import { formatUnknownHandlers, unknownHandlers } from "../handler-check";

describe("build check: enabled agents with no handler", () => {
  const rows = [
    { company: "Anexa Homes", name: "Hello Agent", handlerKey: "system.hello" },
    { company: "Anexa Homes", name: "NTP Poller", handlerKey: "bank.ntp_poll" },
  ];

  it("finds only the agents this build cannot run", () => {
    expect(unknownHandlers(rows)).toEqual([rows[1]]);
  });

  it("says which company, agent and key, and what to do", () => {
    const text = formatUnknownHandlers(unknownHandlers(rows));
    expect(text).toContain("Anexa Homes / NTP Poller / bank.ntp_poll");
    expect(text).toContain("disable the agent");
  });

  it("passes when every enabled agent has a handler", () => {
    expect(unknownHandlers([rows[0]])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/handler-check.test.ts 2>&1 | tail -4
```

Expected: FAIL — `Failed to resolve import "../handler-check"`.

- [ ] **Step 3: Implement the check**

```ts
// src/server/modules/agents/handler-check.ts
import { HANDLER_KEYS } from "./handler-keys";

/**
 * The build's half of registry integrity. Imports only the key list, so the
 * build script can run it without loading any server module.
 */
export type AgentForCheck = { company: string; name: string; handlerKey: string };

export function unknownHandlers(rows: AgentForCheck[], keys: readonly string[] = HANDLER_KEYS): AgentForCheck[] {
  return rows.filter((r) => !keys.includes(r.handlerKey));
}

export function formatUnknownHandlers(rows: AgentForCheck[]): string {
  return [
    `[check-agent-handlers] ${rows.length} enabled agent(s) point at a handler this build does not contain:`,
    ...rows.map((r) => `  - ${r.company} / ${r.name} / ${r.handlerKey}`),
    "Deploy the handler, or disable the agent on the Agents page, then build again.",
  ].join("\n");
}
```

- [ ] **Step 4: Implement the script**

```ts
// scripts/check-agent-handlers.ts
/**
 * Production build check: every ENABLED agent must point at a handler this
 * build contains. Runs after `prisma generate` and before `next build`; exit 1
 * fails the build, and the previous deployment keeps serving.
 *
 * Previews and local builds skip it, by the same rule as prod-migrate.mjs:
 * they must never read the production database. By the time this runs,
 * prod-migrate has already applied migrations, so `agents` exists.
 */
import { PrismaClient } from "@prisma/client";
import { formatUnknownHandlers, unknownHandlers } from "../src/server/modules/agents/handler-check";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[check-agent-handlers] VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"} — not a production build, skipping.`);
    return;
  }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.agent.findMany({
      where: { enabled: true },
      orderBy: [{ companyId: "asc" }, { name: "asc" }],
      select: { name: true, handlerKey: true, company: { select: { name: true } } },
    });
    const broken = unknownHandlers(rows.map((r) => ({ company: r.company.name, name: r.name, handlerKey: r.handlerKey })));
    if (broken.length > 0) {
      console.error(formatUnknownHandlers(broken));
      process.exitCode = 1;
      return;
    }
    console.log(`[check-agent-handlers] ${rows.length} enabled agent(s), every handler present.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[check-agent-handlers] could not run", err);
  process.exit(1);
});
```

- [ ] **Step 5: Add it to the build**

In `package.json`, replace:

```json
    "build": "node scripts/prod-migrate.mjs && prisma generate && npm run copy-pdf-worker && next build",
```

with:

```json
    "build": "node scripts/prod-migrate.mjs && prisma generate && tsx scripts/check-agent-handlers.ts && npm run copy-pdf-worker && next build",
```

- [ ] **Step 6: Run the test, then the script against `agents_dev` — skipped, broken, fixed**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/server/modules/agents/__tests__/handler-check.test.ts 2>&1 | tail -4
pnpm exec tsx scripts/check-agent-handlers.ts; echo "exit=$?"
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -q -v ON_ERROR_STOP=1 -c "SET search_path TO agents_dev; INSERT INTO agents (id, \"companyId\", name, \"handlerKey\", department, enabled, \"updatedAt\") SELECT gen_random_uuid()::text, id, 'Build Check Probe', 'bank.ntp_poll', 'operations', true, now() FROM companies ORDER BY name LIMIT 1;"
VERCEL_ENV=production pnpm exec tsx scripts/check-agent-handlers.ts; echo "exit=$?"
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -q -v ON_ERROR_STOP=1 -c "SET search_path TO agents_dev; DELETE FROM agents WHERE name = 'Build Check Probe';"
VERCEL_ENV=production pnpm exec tsx scripts/check-agent-handlers.ts; echo "exit=$?"
```

Expected, in order: 3 passed; `… not a production build, skipping.` `exit=0`; the list line `  - Anexa Homes / Build Check Probe / bank.ntp_poll` and `exit=1`; `… 0 enabled agent(s), every handler present.` `exit=0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/handler-check.ts scripts/check-agent-handlers.ts package.json src/server/modules/agents/__tests__/handler-check.test.ts
git commit -m "build(agents): a production build fails while an enabled agent names a handler it does not contain" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Labels, form values, and what saving an agent refuses

**Files:**
- Create: `src/lib/agent-labels.ts`, `src/server/modules/agents/validate-agent.ts`
- Test: `src/lib/__tests__/agent-labels.test.ts`, `src/server/modules/agents/__tests__/validate-agent.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/agent-labels.test.ts
import { describe, it, expect } from "vitest";
import { formatRunDuration, formValuesFor, productOf, timeAgo } from "../agent-labels";

describe("agent labels", () => {
  const now = new Date("2026-09-15T14:00:00.000Z");

  it("says how long ago, in words read at a glance", () => {
    expect(timeAgo(new Date("2026-09-15T13:59:30.000Z"), now)).toBe("just now");
    expect(timeAgo("2026-09-15T13:56:00.000Z", now)).toBe("4 min ago");
    expect(timeAgo("2026-09-15T11:00:00.000Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-09-13T14:00:00.000Z", now)).toBe("2 d ago");
  });

  it("formats a run's duration", () => {
    expect(formatRunDuration(null)).toBe("—");
    expect(formatRunDuration(14)).toBe("14 ms");
    expect(formatRunDuration(2_300)).toBe("2.3 s");
    expect(formatRunDuration(245_000)).toBe("4 min 5 s");
  });

  it("reads a NULL product as Both", () => {
    expect(productOf(null)).toBe("both");
    expect(productOf("solar")).toBe("solar");
    expect(productOf("others")).toBe("both");
  });

  it("turns an agent into the strings its form edits", () => {
    expect(
      formValuesFor({
        name: "Hello Agent",
        description: "d",
        handlerKey: "system.hello",
        vertical: null,
        department: "operations",
        enabled: false,
        schedule: null,
        timeoutSeconds: 60,
        requiresHumanGate: true,
        config: {},
      })
    ).toEqual({
      name: "Hello Agent",
      description: "d",
      handlerKey: "system.hello",
      product: "both",
      department: "operations",
      enabled: false,
      schedule: "",
      timeoutSeconds: "60",
      requiresHumanGate: true,
      config: "{}",
    });
  });
});
```

```ts
// src/server/modules/agents/__tests__/validate-agent.test.ts
import { describe, it, expect } from "vitest";
import { NEW_AGENT_VALUES, type AgentFormValues } from "@/lib/agent-labels";
import { validateAgentInput } from "../validate-agent";

const hello = (over: Partial<AgentFormValues> = {}): AgentFormValues => ({ ...NEW_AGENT_VALUES, name: "Hello Agent", ...over });

describe("validateAgentInput", () => {
  it("accepts the Hello Agent, trimming, and turns Both into a NULL product", () => {
    expect(validateAgentInput(hello({ name: "  Hello Agent  ", schedule: " */15  * * * * " }))).toEqual({
      ok: true,
      value: {
        name: "Hello Agent",
        description: "",
        handlerKey: "system.hello",
        vertical: null,
        department: "operations",
        enabled: false,
        schedule: "*/15 * * * *",
        timeoutSeconds: 60,
        requiresHumanGate: true,
        config: {},
      },
    });
  });

  it("reads a blank schedule as Run now only", () => {
    const r = validateAgentInput(hello({ schedule: "  " }));
    expect(r.ok && r.value.schedule).toBeNull();
  });

  it.each([
    [{ name: " " }, /name/],
    [{ handlerKey: "bank.ntp_poll" }, /No handler is registered for "bank\.ntp_poll"/],
    [{ product: "others" as never }, /Roofing, Solar or Both/],
    [{ schedule: "0 */15 * * * *" }, /5-field/],
    [{ timeoutSeconds: "4" }, /5 to 240/],
    [{ timeoutSeconds: "241" }, /5 to 240/],
    [{ timeoutSeconds: "30.5" }, /5 to 240/],
    [{ config: "{nope" }, /not valid JSON/],
    [{ config: "[]" }, /JSON object/],
    [{ config: '{"portalPassword":"hunter2"}' }, /config\.portalPassword looks like a secret/],
    [{ config: '{"greeting":"hi"}' }, /takes no settings/],
  ])("refuses %o", (over, message) => {
    const r = validateAgentInput(hello(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("still saves an agent whose handler was removed, while the handler is not being changed — but never a secret", () => {
    const kept = { keepHandlerKey: "bank.ntp_poll" };
    expect(validateAgentInput(hello({ handlerKey: "bank.ntp_poll", config: '{"stages":["x"]}' }), kept).ok).toBe(true);
    expect(validateAgentInput(hello({ handlerKey: "bank.ntp_poll", config: '{"password":"x"}' }), kept).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/lib/__tests__/agent-labels.test.ts src/server/modules/agents/__tests__/validate-agent.test.ts 2>&1 | tail -5
```

Expected: FAIL on unresolved imports.

- [ ] **Step 3: Implement the labels**

```ts
// src/lib/agent-labels.ts
import type { AgentDepartment, AgentRunStatus, AgentRunTrigger, Vertical } from "@prisma/client";

/**
 * Words, tones and form values for agents. Safe in a client component: no
 * server module, no database, no handler code.
 */

export const DEPARTMENTS = ["permit", "operations", "accounting", "sales_escalation"] as const satisfies readonly AgentDepartment[];
export const PRODUCTS = ["both", "roofing", "solar"] as const;
export type Product = (typeof PRODUCTS)[number];
export const RUN_STATUSES = ["queued", "running", "success", "failed", "needs_human"] as const satisfies readonly AgentRunStatus[];

export const DEPARTMENT_LABEL: Record<AgentDepartment, string> = {
  permit: "Permit",
  operations: "Operations",
  accounting: "Accounting",
  sales_escalation: "Sales escalation",
};

export const PRODUCT_LABEL: Record<Product, string> = { both: "Both", roofing: "Roofing", solar: "Solar" };

export const STATUS_LABEL: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  success: "Success",
  failed: "Failed",
  needs_human: "Needs a human",
};

/** The chip-* tone classes from globals.css. */
export const STATUS_CHIP: Record<AgentRunStatus, string> = {
  queued: "chip-neutral",
  running: "chip-info",
  success: "chip-good",
  failed: "chip-danger",
  needs_human: "chip-warning",
};

export const TRIGGER_LABEL: Record<AgentRunTrigger, string> = { scheduled: "On schedule", manual: "Run now", event: "Event" };

export const isProduct = (v: unknown): v is Product => typeof v === "string" && (PRODUCTS as readonly string[]).includes(v);
export const isDepartment = (v: unknown): v is AgentDepartment =>
  typeof v === "string" && (DEPARTMENTS as readonly string[]).includes(v);
export const isRunStatus = (v: unknown): v is AgentRunStatus =>
  typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v);

/** NULL means Both. A retired `others` can never be saved, and reads as Both rather than crashing a page. */
export function productOf(vertical: Vertical | null): Product {
  return vertical === "roofing" || vertical === "solar" ? vertical : "both";
}

/** What the agent form holds: strings as typed, validated on save by validate-agent.ts. */
export type AgentFormValues = {
  name: string;
  description: string;
  handlerKey: string;
  product: Product;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string;
  timeoutSeconds: string;
  requiresHumanGate: boolean;
  config: string;
};

export const NEW_AGENT_VALUES: AgentFormValues = {
  name: "",
  description: "",
  handlerKey: "system.hello",
  product: "both",
  department: "operations",
  enabled: false,
  schedule: "",
  timeoutSeconds: "60",
  requiresHumanGate: true,
  config: "{}",
};

export function formValuesFor(agent: {
  name: string;
  description: string;
  handlerKey: string;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  timeoutSeconds: number;
  requiresHumanGate: boolean;
  config: unknown;
}): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description,
    handlerKey: agent.handlerKey,
    product: productOf(agent.vertical),
    department: agent.department,
    enabled: agent.enabled,
    schedule: agent.schedule ?? "",
    timeoutSeconds: String(agent.timeoutSeconds),
    requiresHumanGate: agent.requiresHumanGate,
    config: JSON.stringify(agent.config ?? {}, null, 2),
  };
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function timeAgo(date: Date | string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "14 ms", "2.3 s", "4 min 5 s". */
export function formatRunDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * The clock, for a server component that shows relative times. A named helper
 * rather than `new Date()` in render, which the React purity lint rule refuses
 * — the same reason daysInStage exists.
 */
export function renderedAt(): Date {
  return new Date();
}
```

- [ ] **Step 4: Implement the validation**

```ts
// src/server/modules/agents/validate-agent.ts
import type { AgentDepartment, Vertical } from "@prisma/client";
import { DEPARTMENTS, PRODUCTS, type AgentFormValues } from "@/lib/agent-labels";
import { MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS } from "./budget";
import { findSecretValues } from "./config-guard";
import { handlerFor } from "./registry";
import { validateSchedule } from "./schedule";

export type ValidAgent = {
  name: string;
  description: string;
  handlerKey: string;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  timeoutSeconds: number;
  requiresHumanGate: boolean;
  config: Record<string, unknown>;
};

const fail = (error: string) => ({ ok: false as const, error });

/**
 * Everything saving an agent must refuse, before any write: a handler this
 * build does not contain, a schedule the tick cannot keep, a timeout outside
 * the tick budget, config that is not an object, config holding a secret, and
 * config the handler itself rejects.
 *
 * `keepHandlerKey`: an agent whose handler has since been removed can still
 * have its other fields saved. Its config cannot be checked by a handler that
 * is not there, and enabling it stays refused (setAgentEnabledAction).
 */
export function validateAgentInput(
  input: AgentFormValues,
  opts: { keepHandlerKey?: string } = {}
): { ok: true; value: ValidAgent } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return fail("Give the agent a name.");
  if (name.length > 120) return fail("Keep the name under 120 characters.");

  const description = input.description.trim();
  if (description.length > 1000) return fail("Keep the description under 1,000 characters.");

  const handler = handlerFor(input.handlerKey);
  const keepingMissing = !handler && input.handlerKey === opts.keepHandlerKey;
  if (!handler && !keepingMissing) {
    return fail(`No handler is registered for "${input.handlerKey}". Pick one from the list.`);
  }

  if (!(PRODUCTS as readonly string[]).includes(input.product)) return fail("Pick Roofing, Solar or Both.");
  if (!(DEPARTMENTS as readonly string[]).includes(input.department)) return fail("Pick a department.");

  let schedule: string | null = null;
  if (input.schedule.trim()) {
    const checked = validateSchedule(input.schedule);
    if (!checked.ok) return fail(checked.error);
    schedule = checked.schedule;
  }

  const timeoutSeconds = Number(input.timeoutSeconds);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < MIN_TIMEOUT_SECONDS || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    return fail(`Timeout must be a whole number of seconds from ${MIN_TIMEOUT_SECONDS} to ${MAX_TIMEOUT_SECONDS}.`);
  }

  let config: unknown;
  try {
    config = JSON.parse(input.config.trim() || "{}");
  } catch {
    return fail("Config is not valid JSON.");
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return fail("Config must be a JSON object, like {}.");
  }
  const secret = findSecretValues(config);
  if (secret) return fail(secret);
  if (handler) {
    const parsed = handler.parseConfig(config);
    if (!parsed.ok) return fail(parsed.error);
  }

  return {
    ok: true,
    value: {
      name,
      description,
      handlerKey: input.handlerKey,
      vertical: input.product === "both" ? null : input.product,
      department: input.department,
      enabled: input.enabled === true,
      schedule,
      timeoutSeconds,
      requiresHumanGate: input.requiresHumanGate !== false,
      config: config as Record<string, unknown>,
    },
  };
}
```

- [ ] **Step 5: Run them to verify they pass**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/lib/__tests__/agent-labels.test.ts src/server/modules/agents/__tests__/validate-agent.test.ts 2>&1 | tail -5
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: 4 + 14 passed; `typecheck exit=0`.

- [ ] **Step 6: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/lib/agent-labels.ts src/lib/__tests__/agent-labels.test.ts src/server/modules/agents/validate-agent.ts src/server/modules/agents/__tests__/validate-agent.test.ts
git commit -m "feat(agents): labels and form values, and every reason saving an agent is refused" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: The Hello Agent and starter alerts for every company

**Files:**
- Create: `prisma/migrations/20260915120200_agents_seed_rows/migration.sql`
- Modify: `prisma/seed.ts`, `prisma/seed-clean.ts`

- [ ] **Step 1: Write the migration**

```sql
-- prisma/migrations/20260915120200_agents_seed_rows/migration.sql
--
-- The Hello Agent for every company: disabled, unscheduled, gated. It exists so
-- an admin can press Run now and watch the runner and the run log work end to
-- end, with nothing outside the app involved.
INSERT INTO "agents" (
  "id", "companyId", "name", "description", "handlerKey", "vertical", "department",
  "enabled", "schedule", "nextRunAt", "timeoutSeconds", "config", "requiresHumanGate",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id", 'Hello Agent',
  'Test agent. Logs hello and records a successful run, proving the runner and run log work end to end.',
  'system.hello', NULL, 'operations',
  false, NULL, NULL, 60, '{}'::jsonb, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
ON CONFLICT ("companyId", "name") DO NOTHING;

-- Starter alerts. fireEvent reaches people only through a matching rule, and a
-- rule belongs to one workspace, so every company gets both events in both
-- workspaces: the owner, admins, and everyone holding the Agents access switch.
INSERT INTO "notification_rules" (
  "id", "companyId", "vertical", "name", "event", "conditions", "recipients", "channels",
  "titleTemplate", "bodyTemplate", "active", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id", v.vertical::"Industry", e.rule_name, e.event::"NotificationEvent", '{}'::jsonb,
  '{"roles":["super_admin","admin"],"userIds":[],"dynamic":["agents_access"]}'::jsonb,
  '["in_app"]'::jsonb,
  e.title, '{{status}}', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
CROSS JOIN (VALUES ('roofing'), ('solar')) AS v(vertical)
CROSS JOIN (VALUES
  ('agent_run_failed',  'Agent run failed → Agents access',    'Agent failed: {{agent}}'),
  ('agent_needs_human', 'Agent needs a human → Agents access', 'Needs a human: {{agent}}')
) AS e(event, rule_name, title)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rules" AS r
  WHERE r."companyId" = c."id"
    AND r."vertical" = v.vertical::"Industry"
    AND r."event" = e.event::"NotificationEvent"
);
```

- [ ] **Step 2: Apply it to `agents_dev`, twice, and look**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec prisma migrate deploy 2>&1 | grep -E "Applying|Error"
PGOPTIONS="-c search_path=agents_dev" psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -v ON_ERROR_STOP=1 -f prisma/migrations/20260915120200_agents_seed_rows/migration.sql
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -qAt -c "SET search_path TO agents_dev; SELECT c.name, a.name, a.\"handlerKey\", a.vertical IS NULL, a.enabled FROM agents a JOIN companies c ON c.id = a.\"companyId\" ORDER BY 1;"
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -qAt -c "SET search_path TO agents_dev; SELECT vertical, event, count(*) FROM notification_rules WHERE event::text LIKE 'agent%' GROUP BY 1, 2 ORDER BY 1, 2;"
```

Expected: `Applying migration `20260915120200_agents_seed_rows``; the manual re-run prints `INSERT 0 0` twice (nothing new); `Anexa Homes|Hello Agent|system.hello|t|f`; four rows `roofing|agent_needs_human|1`, `roofing|agent_run_failed|1`, `solar|agent_needs_human|1`, `solar|agent_run_failed|1`.

- [ ] **Step 3: Give the seeds the same rows**

The seeds `TRUNCATE "companies" CASCADE` after migrations have run, so they create these rows themselves.

In `prisma/seed.ts`, directly before:

```ts
  await prisma.activityLog.create({
    data: {
      companyId: company.id,
      type: "system",
      message: "Anexa Homes CRM initialized with seed data.",
```

add:

```ts
  // Agents: the Hello Agent and its starter alerts in both workspaces — the same
  // rows migration 20260915120200_agents_seed_rows gives every existing company.
  await prisma.agent.create({
    data: {
      companyId: company.id,
      name: "Hello Agent",
      description: "Test agent. Logs hello and records a successful run, proving the runner and run log work end to end.",
      handlerKey: "system.hello",
      vertical: null,
      department: "operations",
      enabled: false,
      requiresHumanGate: true,
      config: {},
    },
  });
  const agentAlertRecipients = { roles: ["super_admin", "admin"], userIds: [], dynamic: ["agents_access"] };
  await prisma.notificationRule.createMany({
    data: (["roofing", "solar"] as const).flatMap((vertical) => [
      {
        companyId: company.id,
        vertical,
        name: "Agent run failed → Agents access",
        event: "agent_run_failed" as const,
        conditions: {},
        recipients: agentAlertRecipients,
        channels: ["in_app"],
        titleTemplate: "Agent failed: {{agent}}",
        bodyTemplate: "{{status}}",
      },
      {
        companyId: company.id,
        vertical,
        name: "Agent needs a human → Agents access",
        event: "agent_needs_human" as const,
        conditions: {},
        recipients: agentAlertRecipients,
        channels: ["in_app"],
        titleTemplate: "Needs a human: {{agent}}",
        bodyTemplate: "{{status}}",
      },
    ]),
  });

```

In `prisma/seed-clean.ts`, directly before `  console.log("✅ Clean seed complete.");`, add the identical block.

- [ ] **Step 4: Reseed `agents_dev` and check the seed made the same rows**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec tsx prisma/seed.ts 2>&1 | grep -E "Seed complete|Error"
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -qAt -c "SET search_path TO agents_dev; SELECT count(*) FROM agents; SELECT count(*) FROM notification_rules WHERE event::text LIKE 'agent%';"
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: `✅ Seed complete.`; `1` then `4`; `typecheck exit=0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add prisma/migrations/20260915120200_agents_seed_rows/migration.sql prisma/seed.ts prisma/seed-clean.ts
git commit -m "feat(agents): every company gets the Hello Agent and starter agent alerts" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: What the Agents pages read

**Files:**
- Create: `src/server/modules/agents/queries.ts`
- Test: `src/server/modules/agents/__tests__/queries.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/agents/__tests__/queries.itest.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type AgentDepartment, type AgentRunStatus, type Prisma, type Vertical } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { countNeedsHuman, getAgent, listAgents, listRunsFeed, needsHumanQueue, type Viewer } from "../queries";

/**
 * Agent and AgentRun are shared models, so the pages' workspace boundary lives
 * in these queries and nowhere else. Every case here is a line of that boundary.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let otherId = "";
const agents: Record<string, string> = {};

const owner = (): Viewer => ({ companyId, role: "super_admin", verticals: [] });
const roofingAdmin = (): Viewer => ({ companyId, role: "admin", verticals: ["roofing"] });

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Queries Co", slug: `queries-${process.pid}-${Date.now()}` } })).id;
  otherId = (await db.company.create({ data: { name: "Other Queries Co", slug: `queries-other-${process.pid}-${Date.now()}` } })).id;

  const mk = async (name: string, cid: string, vertical: Vertical | null, department: AgentDepartment) => {
    agents[name] = (await db.agent.create({ data: { companyId: cid, name, handlerKey: "system.hello", vertical, department } })).id;
  };
  await mk("Roofing Poller", companyId, "roofing", "permit");
  await mk("Solar Poller", companyId, "solar", "operations");
  await mk("Both Poller", companyId, null, "operations");
  await mk("Elsewhere", otherId, null, "operations");

  const run = (name: string, cid: string, vertical: Vertical, status: AgentRunStatus, extra: Partial<Prisma.AgentRunUncheckedCreateInput> = {}) =>
    db.agentRun.create({ data: { companyId: cid, agentId: agents[name], vertical, trigger: "scheduled", status, summary: `${name} ${vertical} ${status}`, ...extra } });
  await run("Roofing Poller", companyId, "roofing", "success");
  await run("Solar Poller", companyId, "solar", "failed");
  await run("Both Poller", companyId, "roofing", "needs_human");
  await run("Both Poller", companyId, "solar", "needs_human", { resolvedAt: new Date(), resolution: "closed", resolutionNote: "fine" });
  await run("Elsewhere", otherId, "roofing", "needs_human");
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
  await db.agent.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherId] } } });
  await db.$disconnect();
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("agents pages queries", () => {
  it("lists this company's agents only, each with its last run", async () => {
    const rows = await listAgents(owner(), { product: null, department: null });
    expect(names(rows)).toEqual(["Both Poller", "Roofing Poller", "Solar Poller"]);
    expect(rows.find((r) => r.name === "Solar Poller")?.lastRun?.status).toBe("failed");
    expect(rows.every((r) => !r.handlerMissing)).toBe(true);
  });

  it("filters by product — Roofing includes Both — and by department", async () => {
    expect(names(await listAgents(owner(), { product: "roofing", department: null }))).toEqual(["Both Poller", "Roofing Poller"]);
    expect(names(await listAgents(owner(), { product: "both", department: null }))).toEqual(["Both Poller"]);
    expect(names(await listAgents(owner(), { product: null, department: "permit" }))).toEqual(["Roofing Poller"]);
  });

  it("hides a workspace the viewer does not hold, and another company entirely", async () => {
    expect(names(await listAgents(roofingAdmin(), { product: null, department: null }))).toEqual(["Both Poller", "Roofing Poller"]);
    expect(await getAgent(roofingAdmin(), agents["Solar Poller"])).toBeNull();
    expect(await getAgent(owner(), agents["Elsewhere"])).toBeNull();
    expect((await getAgent(owner(), agents["Both Poller"]))?.form.product).toBe("both");
    const feed = await listRunsFeed(roofingAdmin(), { status: null, product: null, page: 1 });
    expect(feed.runs.map((r) => r.vertical)).toEqual(["roofing", "roofing"]);
  });

  it("filters the feed by status and by product", async () => {
    const failed = await listRunsFeed(owner(), { status: "failed", product: null, page: 1 });
    expect(failed.runs.map((r) => r.summary)).toEqual(["Solar Poller solar failed"]);
    const solar = await listRunsFeed(owner(), { status: null, product: "solar", page: 1 });
    expect(solar.total).toBe(2);
    expect(solar.runs.every((r) => r.vertical === "solar")).toBe(true);
  });

  it("queues only this company's unresolved needs-a-human runs", async () => {
    const queue = await needsHumanQueue(owner());
    expect(queue.map((r) => r.summary)).toEqual(["Both Poller roofing needs_human"]);
    expect(queue[0]).toMatchObject({ agentName: "Both Poller", resolution: null });
    expect(await countNeedsHuman(owner())).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/queries.itest.ts 2>&1 | tail -6
```

Expected: FAIL — `Failed to resolve import "../queries"`.

- [ ] **Step 3: Implement**

```ts
// src/server/modules/agents/queries.ts
import type {
  AgentDepartment,
  AgentRunResolution,
  AgentRunStatus,
  AgentRunTrigger,
  Prisma,
  Role,
  Vertical,
} from "@prisma/client";
import { prisma } from "@/server/db/client";
import { userVerticals } from "@/server/auth/vertical";
import { formValuesFor, type AgentFormValues, type Product } from "@/lib/agent-labels";
import { readDetail } from "./detail";
import { handlerFor } from "./registry";
import type { RunDetail } from "./types";

/**
 * What the Agents pages read. Agent and AgentRun are SHARED models, so the
 * viewer's workspaces are applied here, explicitly, on every query: agents
 * whose product is Both (NULL) or a workspace the viewer holds, and runs in a
 * workspace the viewer holds. Pages check agentCan(user, "read") first.
 */

export const RUNS_PER_AGENT_PAGE = 25;
export const RUNS_FEED_PAGE = 50;
const QUEUE_LIMIT = 100;

export type Viewer = { companyId: string; role: Role; verticals: Vertical[] };

const held = (viewer: Viewer): Vertical[] => userVerticals(viewer);

function visibleAgents(viewer: Viewer): Prisma.AgentWhereInput {
  return { companyId: viewer.companyId, OR: [{ vertical: null }, { vertical: { in: held(viewer) } }] };
}

function visibleRuns(viewer: Viewer): Prisma.AgentRunWhereInput {
  return { companyId: viewer.companyId, vertical: { in: held(viewer) } };
}

/** "Roofing" means every agent that runs in Roofing, so Both agents are included. */
function productWhere(product: Product | null): Prisma.AgentWhereInput {
  if (product === "both") return { vertical: null };
  if (product === "roofing" || product === "solar") return { OR: [{ vertical: product }, { vertical: null }] };
  return {};
}

const fullName = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentListRow = {
  id: string;
  name: string;
  description: string;
  handlerKey: string;
  handlerMissing: boolean;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  lastRun: { status: AgentRunStatus; createdAt: Date } | null;
};

export async function listAgents(
  viewer: Viewer,
  filters: { product: Product | null; department: AgentDepartment | null }
): Promise<AgentListRow[]> {
  const rows = await prisma.agent.findMany({
    where: { AND: [visibleAgents(viewer), productWhere(filters.product), filters.department ? { department: filters.department } : {}] },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      handlerKey: true,
      vertical: true,
      department: true,
      enabled: true,
      schedule: true,
      runs: {
        where: { vertical: { in: held(viewer) } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, createdAt: true },
      },
    },
  });
  return rows.map(({ runs, ...agent }) => ({ ...agent, handlerMissing: !handlerFor(agent.handlerKey), lastRun: runs[0] ?? null }));
}

export type AgentView = {
  id: string;
  name: string;
  description: string;
  handlerKey: string;
  handlerLabel: string | null;
  vertical: Vertical | null;
  department: AgentDepartment;
  enabled: boolean;
  schedule: string | null;
  nextRunAt: string | null;
  timeoutSeconds: number;
  requiresHumanGate: boolean;
  config: unknown;
  updatedAt: string;
  updatedBy: string | null;
  form: AgentFormValues;
};

export async function getAgent(viewer: Viewer, agentId: string): Promise<AgentView | null> {
  const a = await prisma.agent.findFirst({
    where: { AND: [visibleAgents(viewer), { id: agentId }] },
    select: {
      id: true,
      name: true,
      description: true,
      handlerKey: true,
      vertical: true,
      department: true,
      enabled: true,
      schedule: true,
      nextRunAt: true,
      timeoutSeconds: true,
      requiresHumanGate: true,
      config: true,
      updatedAt: true,
      updatedBy: { select: { firstName: true, lastName: true } },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    handlerKey: a.handlerKey,
    handlerLabel: handlerFor(a.handlerKey)?.label ?? null,
    vertical: a.vertical,
    department: a.department,
    enabled: a.enabled,
    schedule: a.schedule,
    nextRunAt: a.nextRunAt?.toISOString() ?? null,
    timeoutSeconds: a.timeoutSeconds,
    requiresHumanGate: a.requiresHumanGate,
    config: a.config,
    updatedAt: a.updatedAt.toISOString(),
    updatedBy: fullName(a.updatedBy),
    form: formValuesFor(a),
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const RUN_SELECT = {
  id: true,
  agentId: true,
  vertical: true,
  trigger: true,
  status: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  summary: true,
  error: true,
  leadId: true,
  leadLabel: true,
  detail: true,
  resolvedAt: true,
  resolution: true,
  resolutionNote: true,
  agent: { select: { name: true } },
  triggeredBy: { select: { firstName: true, lastName: true } },
  resolvedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AgentRunSelect;

type RunRow = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

/** A run as the pages show it. Plain strings, so it crosses into client components. */
export type RunView = {
  id: string;
  agentId: string;
  agentName: string;
  vertical: Vertical;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  triggeredBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  error: string | null;
  leadId: string | null;
  leadLabel: string | null;
  detail: RunDetail;
  resolution: { by: string | null; at: string; how: AgentRunResolution; note: string | null } | null;
};

function toRunView(r: RunRow): RunView {
  return {
    id: r.id,
    agentId: r.agentId,
    agentName: r.agent.name,
    vertical: r.vertical,
    trigger: r.trigger,
    status: r.status,
    triggeredBy: fullName(r.triggeredBy),
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    summary: r.summary,
    error: r.error,
    leadId: r.leadId,
    leadLabel: r.leadLabel,
    detail: readDetail(r.detail),
    resolution:
      r.resolvedAt && r.resolution
        ? { by: fullName(r.resolvedBy), at: r.resolvedAt.toISOString(), how: r.resolution, note: r.resolutionNote }
        : null,
  };
}

export type RunPage = { runs: RunView[]; page: number; pageCount: number; total: number };

async function runPage(where: Prisma.AgentRunWhereInput, page: number, size: number): Promise<RunPage> {
  const total = await prisma.agentRun.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const rows = await prisma.agentRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * size,
    take: size,
    select: RUN_SELECT,
  });
  return { runs: rows.map(toRunView), page: current, pageCount, total };
}

export function listRunsForAgent(viewer: Viewer, agentId: string, page: number): Promise<RunPage> {
  return runPage({ AND: [visibleRuns(viewer), { agentId }] }, page, RUNS_PER_AGENT_PAGE);
}

export function listRunsFeed(
  viewer: Viewer,
  filters: { status: AgentRunStatus | null; product: Product | null; page: number }
): Promise<RunPage> {
  return runPage(
    {
      AND: [
        visibleRuns(viewer),
        filters.status ? { status: filters.status } : {},
        filters.product === "roofing" || filters.product === "solar" ? { vertical: filters.product } : {},
      ],
    },
    filters.page,
    RUNS_FEED_PAGE
  );
}

const unresolvedNeedsHuman = (viewer: Viewer): Prisma.AgentRunWhereInput => ({
  AND: [visibleRuns(viewer), { status: "needs_human", resolvedAt: null }],
});

/** Oldest first: the queue is worked from the top. */
export async function needsHumanQueue(viewer: Viewer): Promise<RunView[]> {
  const rows = await prisma.agentRun.findMany({
    where: unresolvedNeedsHuman(viewer),
    orderBy: { createdAt: "asc" },
    take: QUEUE_LIMIT,
    select: RUN_SELECT,
  });
  return rows.map(toRunView);
}

export function countNeedsHuman(viewer: Viewer): Promise<number> {
  return prisma.agentRun.count({ where: unresolvedNeedsHuman(viewer) });
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/queries.itest.ts 2>&1 | tail -6
pnpm -s typecheck; echo "typecheck exit=$?"
```

Expected: 5 passed; `typecheck exit=0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/queries.ts src/server/modules/agents/__tests__/queries.itest.ts
git commit -m "feat(agents): page reads that apply the viewer's workspaces on every query" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: The server actions

**Files:**
- Create: `src/server/modules/agents/actions.ts`
- Test: `src/server/modules/agents/__tests__/actions.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/agents/__tests__/actions.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { NEW_AGENT_VALUES } from "@/lib/agent-labels";
import { emptyDetail, readDetail } from "../detail";
import type { ChangeRecord } from "../types";

/**
 * Every Agents action is a public endpoint. `agentCan` and `can()` are NOT
 * mocked: the refusals below are the real permission code refusing real users.
 * Only the session (who is calling) and after() (run now's background work)
 * are stood in for.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

type Current = {
  userId: string;
  companyId: string;
  role: Role;
  permissions: Record<string, unknown>;
  verticals: ("roofing" | "solar")[];
  fullName: string;
};
let current: Current;
const pending = vi.hoisted(() => [] as Promise<unknown>[]);

vi.mock("@/server/auth/session", () => ({ requireUser: async () => current, getSessionUser: async () => current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    pending.push(Promise.resolve().then(fn));
  },
}));

const actions = await import("../actions");
const flush = () => Promise.all(pending.splice(0));

const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };
const PEOPLE: Record<string, { role: Role; permissions: Record<string, boolean>; name: string }> = {
  owner: { role: "super_admin", permissions: {}, name: "Olive Owner" },
  admin: { role: "admin", permissions: {}, name: "Ada Admin" },
  coordinator: { role: "manager", permissions: SWITCH, name: "Cora Coordinator" },
  salesManager: { role: "manager", permissions: {}, name: "Sam Manager" },
  accounting: { role: "accounting", permissions: {}, name: "Acc Ounting" },
  rep: { role: "sales_rep", permissions: SWITCH, name: "Rex Rep" },
};

let companyId = "";
let pipelineId = "";
let leadId = "";
let helloId = "";
let pollerId = "";
let heldRunId = "";
const ids: Record<string, string> = {};
const stage: Record<string, string> = {};

const as = (who: keyof typeof PEOPLE) => {
  const p = PEOPLE[who];
  current = { userId: ids[who], companyId, role: p.role, permissions: { ...p.permissions }, verticals: ["roofing", "solar"], fullName: p.name };
};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Actions Co", slug: `agent-actions-${process.pid}-${Date.now()}` } })).id;
  for (const [key, p] of Object.entries(PEOPLE)) {
    const [firstName, lastName] = p.name.split(" ");
    ids[key] = (
      await db.user.create({
        data: { companyId, email: `${key}-${process.pid}@agent-actions.test`, firstName, lastName, role: p.role, status: "active", passwordHash: "x", permissions: p.permissions, verticals: ["roofing", "solar"] },
      })
    ).id;
  }
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  for (const [position, key] of ["from", "side", "main", "other"].entries()) {
    stage[key] = (
      await db.pipelineStage.create({ data: { pipelineId, key, name: key[0].toUpperCase() + key.slice(1), position, isActionRequired: key === "side" } })
    ).id;
  }
  leadId = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Maria", lastName: "Lopez", address: "12 Elm St" } })
  ).id;
  helloId = (await db.agent.create({ data: { companyId, name: "Hello Agent", handlerKey: "system.hello", department: "operations" } })).id;
  pollerId = (await db.agent.create({ data: { companyId, name: "NTP Poller", handlerKey: "system.hello", department: "permit", vertical: "roofing" } })).id;
});

beforeEach(async () => {
  pending.splice(0);
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { leadId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.update({ where: { id: leadId }, data: { stageId: stage.from } });
  const held: ChangeRecord = {
    type: "move_stage",
    leadId,
    toStageKey: "main",
    reason: "Portal shows NTP approved",
    dealLabel: "Maria Lopez · 12 Elm St",
    fromStage: { id: stage.from, key: "from", name: "From" },
    toStage: { id: stage.main, key: "main", name: "Main", position: 2, isActionRequired: false, defaultBlocker: null, stageType: "internally_owned" },
    outcome: "held",
    note: "Held: this agent is gated and Main is not an Action Required stage.",
  };
  heldRunId = (
    await db.agentRun.create({
      data: {
        companyId,
        agentId: pollerId,
        vertical: "roofing",
        trigger: "scheduled",
        status: "needs_human",
        summary: "NTP approved in the portal",
        detail: { ...emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true }), changes: [held] } as unknown as Prisma.InputJsonValue,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.notification.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { leadId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("who may do what", () => {
  it.each([
    ["salesManager", "run"],
    ["salesManager", "resolve"],
    ["accounting", "run"],
    ["accounting", "resolve"],
    ["rep", "run"],
  ] as const)("%s cannot %s", async (who, what) => {
    as(who);
    const res =
      what === "run"
        ? await actions.runAgentNowAction(helloId, { confirmDisabled: true })
        : await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed", note: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission/);
  });

  it.each(["coordinator", "salesManager", "accounting"] as const)("%s cannot create, edit or enable an agent, even with a hand-written override", async (who) => {
    as(who);
    current.permissions = { ...current.permissions, "Agent:create": true, "Agent:update": true };
    expect((await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Nope" })).ok).toBe(false);
    expect((await actions.updateAgentAction(helloId, { ...NEW_AGENT_VALUES, name: "Hello Agent" })).ok).toBe(false);
    expect((await actions.setAgentEnabledAction(helloId, true)).ok).toBe(false);
    expect(await db.agent.count({ where: { companyId, name: "Nope" } })).toBe(0);
  });
});

describe("creating and editing", () => {
  it("lets an admin create an agent, with its next run set from the schedule", async () => {
    as("admin");
    expect((await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Poller", enabled: true, schedule: "*/15 * * * *" })).ok).toBe(true);
    const row = await db.agent.findFirstOrThrow({ where: { companyId, name: "Poller" } });
    expect(row).toMatchObject({ enabled: true, schedule: "*/15 * * * *", updatedById: ids.admin });
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses an unknown handler, a secret in config, and a name already taken", async () => {
    as("admin");
    expect(await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "X", handlerKey: "bank.ntp_poll" })).toMatchObject({ ok: false });
    expect(await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Y", config: '{"apiKey":"sk-live"}' })).toMatchObject({ ok: false });
    expect(await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Hello Agent" })).toEqual({ ok: false, error: "An agent with that name already exists." });
  });

  it("refuses to enable an agent whose handler is not deployed", async () => {
    as("admin");
    const broken = await db.agent.create({ data: { companyId, name: "Broken", handlerKey: "bank.ntp_poll", department: "permit" } });
    expect(await actions.setAgentEnabledAction(broken.id, true)).toMatchObject({ ok: false });
    expect((await db.agent.findUniqueOrThrow({ where: { id: broken.id } })).enabled).toBe(false);
  });
});

describe("runAgentNowAction", () => {
  it("asks before running a disabled agent, then runs it once per workspace", async () => {
    as("admin");
    expect(await actions.runAgentNowAction(helloId)).toMatchObject({ ok: false, needsConfirm: true });
    expect(await db.agentRun.count({ where: { agentId: helloId } })).toBe(0);

    expect((await actions.runAgentNowAction(helloId, { confirmDisabled: true })).ok).toBe(true);
    await flush();
    const runs = await db.agentRun.findMany({ where: { agentId: helloId } });
    expect(runs.map((r) => [r.vertical, r.status, r.summary, r.trigger, r.triggeredById]).sort()).toEqual([
      ["roofing", "success", "Said hello", "manual", ids.admin],
      ["solar", "success", "Said hello", "manual", ids.admin],
    ]);
  });

  it("lets a manager with Agents access run it", async () => {
    as("coordinator");
    expect((await actions.runAgentNowAction(helloId, { confirmDisabled: true })).ok).toBe(true);
    await flush();
    expect(await db.agentRun.count({ where: { agentId: helloId, status: "success" } })).toBe(2);
  });

  it("refuses while a run is already in flight", async () => {
    as("admin");
    await db.agentRun.create({ data: { companyId, agentId: helloId, vertical: "roofing", trigger: "manual", status: "running", startedAt: new Date() } });
    expect(await actions.runAgentNowAction(helloId, { confirmDisabled: true })).toMatchObject({ ok: false });
  });

  it("writes a failed run for a handler that is not deployed", async () => {
    as("admin");
    const broken = await db.agent.create({ data: { companyId, name: "Broken Run", handlerKey: "bank.ntp_poll", department: "permit", vertical: "roofing", enabled: true } });
    expect(await actions.runAgentNowAction(broken.id)).toEqual({
      ok: false,
      error: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
    });
    expect(await db.agentRun.findFirst({ where: { agentId: broken.id } })).toMatchObject({ status: "failed", trigger: "manual" });
  });
});

describe("resolveAgentRunAction", () => {
  it("applies a held change as the person who approved it", async () => {
    as("admin");
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "applied" })).toEqual({ ok: true, failed: 0 });
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.main);
    expect(await db.leadStageEvent.findFirst({ where: { leadId, exitedAt: null } })).toMatchObject({ stageName: "Main", movedById: ids.admin, via: null });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } });
    expect(run).toMatchObject({ status: "needs_human", resolution: "applied", resolvedById: ids.admin });
    expect(readDetail(run.detail).resolution?.changes[0]).toMatchObject({ outcome: "applied" });
  });

  it("refuses when the deal has moved since the agent looked", async () => {
    as("admin");
    await db.lead.update({ where: { id: leadId }, data: { stageId: stage.other } });
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "applied" })).toEqual({
      ok: false,
      error: "Maria Lopez · 12 Elm St has moved since the agent looked (now in Other). Close this run instead.",
    });
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } })).resolvedAt).toBeNull();
  });

  it("closes without applying — only with a note, and only once", async () => {
    as("coordinator");
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed" })).toMatchObject({ ok: false });
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed", note: "Bank fixed it by phone" })).toEqual({ ok: true, failed: 0 });
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } })).toMatchObject({
      resolution: "closed",
      resolutionNote: "Bank fixed it by phone",
      resolvedById: ids.coordinator,
    });
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed", note: "again" })).toEqual({
      ok: false,
      error: "This run has already been resolved.",
    });
  });

  it("does not let a manager with Agents access apply a change to a deal outside their own team", async () => {
    as("coordinator");
    const res = await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "applied" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/can't open Maria Lopez · 12 Elm St/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.from);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/actions.itest.ts 2>&1 | tail -6
```

Expected: FAIL — `Failed to resolve import "../actions"`.

- [ ] **Step 3: Implement**

```ts
// src/server/modules/agents/actions.ts
"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { companyVerticals, userVerticals } from "@/server/auth/vertical";
import { leadAccessible } from "@/server/rbac/lead-access";
import { asActiveVertical, runInVertical } from "@/server/vertical/context";
import { VERTICAL_LABEL } from "@/lib/vertical";
import type { AgentFormValues } from "@/lib/agent-labels";
import { agentCan, canEditAgentConfig } from "./access";
import { moveDeal, runStageEnteredAutomations, TARGET_STAGE_SELECT, type StageMove } from "./apply-changes";
import { missingHandlerMessage, readDetail } from "./detail";
import { handlerFor } from "./registry";
import { AGENT_SELECT, createRun, executeRun, hasRunInFlight, writeMissingHandlerRun } from "./runner";
import { nextRunAtFor } from "./schedule";
import type { ChangeRecord, TargetStage } from "./types";
import { validateAgentInput } from "./validate-agent";
import { agentVisibleTo, viewerRunVerticals } from "./verticals";

/**
 * Every write the Agents pages make. Each export is a public endpoint, so each
 * asks access.ts first, re-reads what it acts on inside the caller's company
 * and workspaces, and trusts nothing it is sent.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

function revalidateAgents(agentId?: string) {
  revalidatePath("/portal/agents");
  revalidatePath("/portal/agents/runs");
  if (agentId) revalidatePath(`/portal/agents/${agentId}`);
}

const idSchema = z.string().uuid();

export async function createAgentAction(input: AgentFormValues) {
  const user = await requireUser();
  if (!canEditAgentConfig(user)) return fail("Only an owner or admin can create agents.");
  const v = validateAgentInput(input);
  if (!v.ok) return fail(v.error);
  if (!agentVisibleTo(v.value.vertical, userVerticals(user))) return fail("You don't have access to that product.");

  const taken = await prisma.agent.findFirst({ where: { companyId: user.companyId, name: v.value.name }, select: { id: true } });
  if (taken) return fail("An agent with that name already exists.");

  const row = await prisma.agent.create({
    data: {
      companyId: user.companyId,
      ...v.value,
      config: v.value.config as Prisma.InputJsonValue,
      nextRunAt: nextRunAtFor(v.value, new Date()),
      updatedById: user.userId,
    },
    select: { id: true },
  });
  revalidateAgents(row.id);
  return { ok: true as const, id: row.id };
}

export async function updateAgentAction(agentId: string, input: AgentFormValues) {
  const user = await requireUser();
  if (!canEditAgentConfig(user)) return fail("Only an owner or admin can edit agents.");
  if (!idSchema.safeParse(agentId).success) return fail("Agent not found.");

  const existing = await prisma.agent.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { id: true, vertical: true, handlerKey: true, enabled: true, schedule: true, nextRunAt: true },
  });
  if (!existing || !agentVisibleTo(existing.vertical, userVerticals(user))) return fail("Agent not found.");

  // `enabled` belongs to the switch in the page header, not to this form.
  const v = validateAgentInput({ ...input, enabled: existing.enabled }, { keepHandlerKey: existing.handlerKey });
  if (!v.ok) return fail(v.error);
  if (!agentVisibleTo(v.value.vertical, userVerticals(user))) return fail("You don't have access to that product.");

  const taken = await prisma.agent.findFirst({
    where: { companyId: user.companyId, name: v.value.name, id: { not: agentId } },
    select: { id: true },
  });
  if (taken) return fail("An agent with that name already exists.");

  // A save that leaves the schedule alone must not skip a run that is already due.
  const nextRunAt = v.value.schedule === existing.schedule ? existing.nextRunAt : nextRunAtFor(v.value, new Date());
  await prisma.agent.update({
    where: { id: agentId },
    data: { ...v.value, config: v.value.config as Prisma.InputJsonValue, nextRunAt, updatedById: user.userId },
  });
  revalidateAgents(agentId);
  return { ok: true as const };
}

export async function setAgentEnabledAction(agentId: string, enabled: boolean) {
  const user = await requireUser();
  if (!canEditAgentConfig(user)) return fail("Only an owner or admin can turn agents on or off.");
  if (!idSchema.safeParse(agentId).success || typeof enabled !== "boolean") return fail("Agent not found.");

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { id: true, vertical: true, handlerKey: true, schedule: true },
  });
  if (!agent || !agentVisibleTo(agent.vertical, userVerticals(user))) return fail("Agent not found.");
  if (enabled && !handlerFor(agent.handlerKey)) return fail(missingHandlerMessage(agent.handlerKey));

  await prisma.agent.update({
    where: { id: agentId },
    data: { enabled, nextRunAt: nextRunAtFor({ enabled, schedule: agent.schedule }, new Date()), updatedById: user.userId },
  });
  revalidateAgents(agentId);
  return { ok: true as const };
}

export async function runAgentNowAction(agentId: string, opts: { confirmDisabled?: boolean } = {}) {
  const user = await requireUser();
  if (!agentCan(user, "run")) return fail("You don't have permission to run agents.");
  if (!idSchema.safeParse(agentId).success) return fail("Agent not found.");

  const held = userVerticals(user);
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { ...AGENT_SELECT, vertical: true, enabled: true },
  });
  if (!agent || !agentVisibleTo(agent.vertical, held)) return fail("Agent not found.");

  // The page asks first. This is what stops a stale page or a direct call from skipping the question.
  if (!agent.enabled && opts.confirmDisabled !== true) {
    return { ok: false as const, needsConfirm: true as const, error: "This agent is turned off. Confirm to run it anyway." };
  }

  const targets = viewerRunVerticals(agent.vertical, companyVerticals(), held);
  if (targets.length === 0) return fail("This agent does not run in any workspace you have access to.");

  if (!handlerFor(agent.handlerKey)) {
    for (const vertical of targets) {
      await writeMissingHandlerRun({ agent, vertical, trigger: "manual", triggeredById: user.userId });
    }
    revalidateAgents(agent.id);
    return fail(missingHandlerMessage(agent.handlerKey));
  }

  for (const vertical of targets) {
    if (await hasRunInFlight(agent.id, vertical)) {
      return fail(
        targets.length > 1
          ? `This agent already has a run in progress in ${VERTICAL_LABEL[vertical]}. Wait for it to finish.`
          : "This agent already has a run in progress. Wait for it to finish."
      );
    }
  }

  // The time budget starts at the click. after() runs within the page's
  // maxDuration (300); anything it does not start, the tick starts.
  const anchorMs = Date.now();
  const runIds: string[] = [];
  for (const vertical of targets) {
    runIds.push((await createRun({ agent, vertical, trigger: "manual", status: "queued", triggeredById: user.userId })).id);
  }
  after(async () => {
    await Promise.allSettled(runIds.map((id) => executeRun(id, { anchorMs })));
  });
  revalidateAgents(agent.id);
  return { ok: true as const, runIds };
}

const resolveSchema = z.object({
  runId: z.string().uuid(),
  resolution: z.enum(["applied", "closed"]),
  note: z.string().trim().max(2000).optional().default(""),
});

type ReadyChange = { change: ChangeRecord; stage: TargetStage };

export async function resolveAgentRunAction(input: z.input<typeof resolveSchema>) {
  const user = await requireUser();
  if (!agentCan(user, "approve")) return fail("You don't have permission to resolve agent runs.");
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { runId, resolution, note } = parsed.data;

  const run = await prisma.agentRun.findFirst({
    where: { id: runId, companyId: user.companyId },
    select: { id: true, agentId: true, vertical: true, status: true, resolvedAt: true, detail: true, agent: { select: { name: true } } },
  });
  if (!run || !(userVerticals(user) as string[]).includes(run.vertical)) return fail("Run not found.");
  if (run.status !== "needs_human") return fail("Only a run that needs a human can be resolved.");
  if (run.resolvedAt) return fail("This run has already been resolved.");

  const detail = readDetail(run.detail);
  const held = detail.changes.filter((c) => c.outcome === "held");

  if (resolution === "closed") {
    if (!note) return fail("Add a note saying why it is closed without applying.");
    const closed = await prisma.agentRun.updateMany({
      where: { id: run.id, resolvedAt: null },
      data: { resolution: "closed", resolvedById: user.userId, resolvedAt: new Date(), resolutionNote: note },
    });
    if (closed.count === 0) return fail("This run has already been resolved.");
    revalidateAgents(run.agentId);
    return { ok: true as const, failed: 0 };
  }

  if (held.length === 0) return fail("Nothing was held on this run, so there is nothing to apply. Close it instead.");

  const vertical = asActiveVertical(run.vertical);

  // Re-check every change before applying any: the viewer can open the deal,
  // the deal is still where the agent saw it, and the target stage still exists.
  const checked = await runInVertical(vertical, async (): Promise<{ error: string } | { ready: ReadyChange[] }> => {
    const ready: ReadyChange[] = [];
    for (const change of held) {
      const lead = await leadAccessible(user, change.leadId);
      if (!lead) {
        return { error: `You can't open ${change.dealLabel ?? "this deal"}, so you can't apply this change. Close the run instead, or ask an admin.` };
      }
      const now = await prisma.lead.findFirst({
        where: { id: lead.id },
        select: { stageId: true, pipelineId: true, stage: { select: { name: true } } },
      });
      if ((now?.stageId ?? null) !== (change.fromStage?.id ?? null)) {
        return { error: `${change.dealLabel ?? "This deal"} has moved since the agent looked (now in ${now?.stage?.name ?? "no stage"}). Close this run instead.` };
      }
      const stage =
        change.toStage && now?.pipelineId
          ? await prisma.pipelineStage.findFirst({ where: { id: change.toStage.id, pipelineId: now.pipelineId }, select: TARGET_STAGE_SELECT })
          : null;
      if (!stage) return { error: `The stage ${change.toStage?.name ?? change.toStageKey} no longer exists. Close this run instead.` };
      ready.push({ change, stage });
    }
    return { ready };
  });
  if ("error" in checked) return fail(checked.error);

  // Claim the resolution before touching a deal, so two people pressing Apply cannot both move it.
  const claimed = await prisma.agentRun.updateMany({
    where: { id: run.id, resolvedAt: null },
    data: { resolution: "applied", resolvedById: user.userId, resolvedAt: new Date(), resolutionNote: note || null },
  });
  if (claimed.count === 0) return fail("This run has already been resolved.");

  const records = await runInVertical(vertical, async () => {
    const out: ChangeRecord[] = [];
    for (const { change, stage } of checked.ready) {
      try {
        await moveDeal(user.companyId, change.leadId, stage, { kind: "person", userId: user.userId, fullName: user.fullName, agentName: run.agent.name });
        out.push({ ...change, toStage: stage, outcome: "applied", note: null });
      } catch (err) {
        out.push({ ...change, outcome: "discarded", note: `Not applied: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return out;
  });

  const moves: StageMove[] = records.flatMap((c) => (c.outcome === "applied" && c.toStage ? [{ leadId: c.leadId, stageId: c.toStage.id }] : []));
  await runStageEnteredAutomations(user.companyId, vertical, moves);

  detail.resolution = { byUserId: user.userId, at: new Date().toISOString(), changes: records };
  await prisma.agentRun.update({ where: { id: run.id }, data: { detail: detail as unknown as Prisma.InputJsonValue } });

  revalidateAgents(run.agentId);
  for (const move of moves) revalidatePath(`/portal/leads/${move.leadId}`);
  return { ok: true as const, failed: records.filter((c) => c.outcome !== "applied").length };
}
```

- [ ] **Step 4: Run it, the row-scope guard, and the typecheck**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/agents/__tests__/actions.itest.ts 2>&1 | tail -6
pnpm exec vitest run src/lib/__tests__/row-scope-boundary.test.ts 2>&1 | tail -4
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/server/modules/agents
```

Expected: `Tests  19 passed (19)`; the row-scope guard passes with no allow-list change (`resolveAgentRunAction` reaches `leadAccessible`); `typecheck exit=0`; eslint prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/actions.ts src/server/modules/agents/__tests__/actions.itest.ts
git commit -m "feat(agents): create, edit, enable, Run now (with a confirm the server enforces) and resolve" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: The Agents access switch on Team → member

**Files:**
- Modify: `src/server/modules/team/actions.ts`, `src/app/portal/team/[id]/page.tsx`
- Create: `src/components/portal/agents/agents-access-card.tsx`
- Test: `src/server/modules/team/__tests__/agents-access.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/team/__tests__/agents-access.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * THE AGENTS ACCESS SWITCH.
 *
 * Operations is not a role — `manager` is both the sales manager and the solar
 * coordinators — so Operations access to agents is three permission keys on one
 * person. The owner alone sets them, only a manager can be given them, and they
 * do not follow somebody into another role.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setAgentsAccessAction, updateTeamMemberAction } = await import("../actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

let companyId = "";
let otherCompanyId = "";
let managerId = "";
let repId = "";
let outsiderId = "";

const member = (cid: string, role: Role, tag: string, permissions: Record<string, unknown> = {}) =>
  db.user.create({
    data: {
      companyId: cid,
      email: `${tag}-${process.pid}@agents-access.test`,
      passwordHash: "x",
      firstName: tag,
      lastName: "Member",
      role,
      verticals: ["roofing"],
      permissions,
    },
  });

const as = (role: Role) =>
  session.requireUser.mockResolvedValue({ userId: `${role}-session`, companyId, role, permissions: {} });

const permissionsOf = async (id: string) =>
  (await db.user.findUniqueOrThrow({ where: { id }, select: { permissions: true } })).permissions as Record<string, unknown>;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Agents Access Co", slug: `aa-${process.pid}-${Date.now()}` } })).id;
  otherCompanyId = (await db.company.create({ data: { name: "Other Access Co", slug: `aa-other-${process.pid}-${Date.now()}` } })).id;
});

beforeEach(async () => {
  await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  managerId = (await member(companyId, "manager", "cora", { "Lead:delete": true })).id;
  repId = (await member(companyId, "sales_rep", "rex")).id;
  outsiderId = (await member(otherCompanyId, "manager", "otto")).id;
  as("super_admin");
});

afterAll(async () => {
  await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await db.$disconnect();
});

describe("setAgentsAccessAction", () => {
  it("lets the owner turn it on for a manager, keeping every other key", async () => {
    expect(await setAgentsAccessAction({ userId: managerId, on: true })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true, ...SWITCH });
  });

  it("turning it off deletes the three keys and nothing else", async () => {
    await setAgentsAccessAction({ userId: managerId, on: true });
    expect(await setAgentsAccessAction({ userId: managerId, on: false })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true });
  });

  it.each(["admin", "manager", "accounting"] as const)("refuses a caller who is %s", async (role) => {
    as(role);
    expect(await setAgentsAccessAction({ userId: managerId, on: true })).toMatchObject({ ok: false });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true });
  });

  it("refuses anyone who is not a manager, and anyone in another company", async () => {
    expect(await setAgentsAccessAction({ userId: repId, on: true })).toEqual({
      ok: false,
      error: "Agents access can only be given to a manager.",
    });
    expect(await permissionsOf(repId)).toEqual({});
    expect(await setAgentsAccessAction({ userId: outsiderId, on: true })).toEqual({ ok: false, error: "User not found." });
    expect(await permissionsOf(outsiderId)).toEqual({});
  });
});

describe("changing a manager's role", () => {
  it("takes the switch away, and leaves every other key", async () => {
    await setAgentsAccessAction({ userId: managerId, on: true });
    expect(await updateTeamMemberAction({ userId: managerId, role: "canvasser" })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true });
  });

  it("keeps it through an edit that leaves the role alone", async () => {
    await setAgentsAccessAction({ userId: managerId, on: true });
    expect(await updateTeamMemberAction({ userId: managerId, title: "Project Coordinator" })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true, ...SWITCH });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/team/__tests__/agents-access.itest.ts 2>&1 | tail -8
```

Expected: FAIL — `TypeError: setAgentsAccessAction is not a function` in the first four tests, and the role-change test fails because the keys are never written.

- [ ] **Step 3: Implement the action and the role-change rule**

In `src/server/modules/team/actions.ts`:

After `import { userVerticals } from "@/server/auth/vertical";` add:

```ts
import type { Prisma } from "@prisma/client";
import { AGENT_ACCESS_ROLE, withAgentsAccess, withoutAgentsAccess } from "@/server/modules/agents/access";
```

In `updateTeamMemberAction`, replace:

```ts
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId }, select: { id: true, role: true } });
  if (!target) return fail("User not found.");

  // Resolve the assigned sales rep (canvassers only). The effective role is the
```

with:

```ts
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId }, select: { id: true, role: true, permissions: true } });
  if (!target) return fail("User not found.");

  // Resolve the assigned sales rep (canvassers only). The effective role is the
```

Replace:

```ts
  const clearTeamName = roleChanged && role !== "manager";
```

with:

```ts
  const clearTeamName = roleChanged && role !== "manager";
  // The Agents access switch goes the same way: it was given to a manager, and
  // it does not follow them into a different job. The keys are deleted, never
  // set to false (see modules/agents/access.ts).
  const clearAgentsAccess = roleChanged && role !== AGENT_ACCESS_ROLE;
```

Replace:

```ts
      ...(clearTeamName ? { teamName: null } : {}),
```

with:

```ts
      ...(clearTeamName ? { teamName: null } : {}),
      ...(clearAgentsAccess ? { permissions: withoutAgentsAccess(target.permissions) as Prisma.InputJsonValue } : {}),
```

Then replace:

```ts
  revalidatePath("/portal/team");
  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Pay structure
```

with:

```ts
  revalidatePath("/portal/team");
  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Agents access
// ---------------------------------------------------------------------------

const agentsAccessSchema = z.object({ userId: z.string().min(1), on: z.boolean() });

/**
 * The per-person Agents access switch: read agents and runs, Run now, and
 * resolve a run that needs a human. Never create or edit — config stays with
 * the owner and admins by role. Owner only, and only a manager can be given
 * it, because `manager` is where the solar coordinators sit today.
 */
export async function setAgentsAccessAction(input: z.infer<typeof agentsAccessSchema>) {
  const me = await requireUser();
  if (me.role !== "super_admin") return fail("Only the owner can change Agents access.");
  const parsed = agentsAccessSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { userId, on } = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
    select: { id: true, role: true, permissions: true },
  });
  if (!target) return fail("User not found.");
  // Turning it OFF works on anyone, so a stale key can always be cleared.
  if (on && target.role !== AGENT_ACCESS_ROLE) return fail("Agents access can only be given to a manager.");

  const permissions = on ? withAgentsAccess(target.permissions) : withoutAgentsAccess(target.permissions);
  await prisma.user.update({ where: { id: target.id }, data: { permissions: permissions as Prisma.InputJsonValue } });
  revalidatePath(`/portal/team/${target.id}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Pay structure
```

- [ ] **Step 4: Run it, and the team tests beside it**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" \
  pnpm exec vitest run --config vitest.integration.config.ts src/server/modules/team/__tests__ 2>&1 | tail -6
```

Expected: `agents-access.itest.ts` 8 passed; `team-name.itest.ts` and `pay-structure-roles.itest.ts` pass as they did at the Task 0 baseline.

- [ ] **Step 5: The card**

```tsx
// src/components/portal/agents/agents-access-card.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setAgentsAccessAction } from "@/server/modules/team/actions";

/**
 * Team → member, on a manager, seen by the owner. One switch, and one sentence
 * saying exactly what it grants and what it does not.
 */
export function AgentsAccessCard({ userId, name, on }: { userId: string; name: string; on: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = React.useState(on);
  const [seen, setSeen] = React.useState(on);
  const [busy, setBusy] = React.useState(false);
  if (seen !== on) {
    setSeen(on);
    setChecked(on);
  }

  async function change(next: boolean) {
    setBusy(true);
    setChecked(next);
    try {
      const res = await setAgentsAccessAction({ userId, on: next });
      if (!res.ok) {
        setChecked(!next);
        toast.error(res.error);
        return;
      }
      toast.success(next ? `${name} now has Agents access` : `Agents access removed from ${name}`);
      router.refresh();
    } catch {
      setChecked(!next);
      toast.error("Could not change Agents access. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="agents-access-card" className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <Bot className="size-4 text-muted-foreground" /> Agents access
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Can view agents and runs, run an agent, and resolve runs that need a human. Cannot create or edit agents.
          </p>
        </div>
        <Switch checked={checked} onCheckedChange={change} disabled={busy} aria-label={`Agents access for ${name}`} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Put it on the member page**

In `src/app/portal/team/[id]/page.tsx`:

After `import { RepVendorLink } from "@/components/portal/rep-vendor-link";` add:

```ts
import { AgentsAccessCard } from "@/components/portal/agents/agents-access-card";
import { AGENT_ACCESS_ROLE, hasAgentsAccess } from "@/server/modules/agents/access";
```

Replace:

```ts
    : [[], null];

  const links = [
```

with:

```ts
    : [[], null];

  // The Agents access switch: the owner's decision, offered only on a manager
  // (modules/agents/access.ts says why it is a person and not a role).
  const showAgentsAccess = user.role === "super_admin" && detail.role === AGENT_ACCESS_ROLE;
  const agentsAccessOn = showAgentsAccess
    ? hasAgentsAccess(
        (await prisma.user.findFirst({ where: { id: detail.id, companyId: user.companyId }, select: { permissions: true } }))
          ?.permissions
      )
    : false;

  const links = [
```

Replace:

```tsx
            showOverrides={showOverrides}
          />
```

with:

```tsx
            showOverrides={showOverrides}
          />

          {showAgentsAccess && <AgentsAccessCard userId={detail.id} name={detail.name} on={agentsAccessOn} />}
```

- [ ] **Step 7: Typecheck, lint, commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/server/modules/team/actions.ts "src/app/portal/team/[id]/page.tsx" src/components/portal/agents/agents-access-card.tsx; echo "eslint exit=$?"
git add src/server/modules/team/actions.ts "src/app/portal/team/[id]/page.tsx" src/components/portal/agents/agents-access-card.tsx src/server/modules/team/__tests__/agents-access.itest.ts
git commit -m "feat(agents): the owner's Agents access switch on a manager, cleared when their role changes" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: `typecheck exit=0`, `eslint exit=0`. The card is exercised in the browser by Task 20's spec.

---

## Task 20: The sidebar item, the shared pieces, and the Agents list

**Files:**
- Modify: `src/lib/nav.ts`
- Create: `src/components/portal/agents/href.ts`, `src/components/portal/agents/agent-tabs.tsx`, `src/components/portal/agents/filter-chips.tsx`, `src/components/portal/agents/local-time.tsx`, `src/components/portal/agents/run-status-pill.tsx`, `src/components/portal/agents/agent-enabled-switch.tsx`, `src/app/portal/agents/page.tsx`
- Test: `src/lib/__tests__/agents-href.test.ts`, `e2e/agents.spec.ts`

Playwright runs on `next dev`. That is fine here: these pages read the shared `Agent`/`AgentRun` models and the Hello handler touches no workspace-scoped model. Workspace behaviour is verified on a production build in Task 24.

- [ ] **Step 1: Write the failing browser tests**

```ts
// e2e/agents.spec.ts
import { test, expect, type Page } from "@playwright/test";

/**
 * The Agents pages, as the people who use them. The runner is proven by the
 * integration tests; these prove who sees what, that Run now reaches a real
 * run row through the page, and that the queue sits where the spec puts it.
 *
 * ORDER MATTERS (workers: 1, file order). The owner test turns Priya's switch
 * on and back off, so the "no access" test runs before it; the Runs test reads
 * the run the admin test writes.
 */

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

test("a sales manager has no Agents item, and the page sends them away", async ({ page }) => {
  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/dashboard");
  await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0);
  await page.goto("/portal/agents");
  await page.waitForURL("**/portal/dashboard", { timeout: 15000 });
});

test("the owner gives a manager Agents access, and the manager can then read Agents", async ({ page }) => {
  await login(page, "owner@anexahomes.com");
  await page.goto("/portal/team");
  await page.getByText("Priya Shah").first().click();
  await page.waitForURL(/\/portal\/team\/[0-9a-f-]+$/, { timeout: 15000 });
  const memberUrl = page.url();

  const card = page.getByTestId("agents-access-card");
  await expect(card).toContainText("Cannot create or edit agents.");
  const toggle = card.getByRole("switch", { name: "Agents access for Priya Shah" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Priya Shah now has Agents access")).toBeVisible({ timeout: 10000 });

  await login(page, "manager@anexahomes.com");
  await page.goto("/portal/dashboard");
  await page.getByRole("link", { name: "Agents", exact: true }).first().click();
  await page.waitForURL(/\/portal\/agents$/, { timeout: 15000 });
  await expect(page.getByRole("link", { name: "Hello Agent" })).toBeVisible();
  // Read and run, never edit: no New agent, and no on/off switch on the row.
  await expect(page.getByRole("link", { name: "New agent" })).toHaveCount(0);
  await expect(page.getByTestId("agent-enabled")).toHaveCount(0);

  // Put it back for every spec that logs in as Priya after this one.
  await login(page, "owner@anexahomes.com");
  await page.goto(memberUrl);
  await page.getByTestId("agents-access-card").getByRole("switch").click();
  await expect(page.getByText("Agents access removed from Priya Shah")).toBeVisible({ timeout: 10000 });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
find . -maxdepth 1 -name '.next-e2e-3017' -mmin -10   # prints a path = another session is using port 3017 right now; wait
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -20
```

Expected: both FAIL. `/portal/agents` is a 404 for everyone, so the first never reaches the dashboard, and the second finds no Agents link to click.

- [ ] **Step 3: Write the failing unit test for the link helper**

```ts
// src/lib/__tests__/agents-href.test.ts
import { describe, it, expect } from "vitest";
import { hrefWith } from "@/components/portal/agents/href";

describe("hrefWith", () => {
  it("sets, replaces and removes query parameters, in a stable order", () => {
    expect(hrefWith("/portal/agents", {}, {})).toBe("/portal/agents");
    expect(hrefWith("/portal/agents", { product: "solar" }, { department: "permit" })).toBe(
      "/portal/agents?department=permit&product=solar"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed", page: "3" }, { status: null, page: null })).toBe(
      "/portal/agents/runs"
    );
    expect(hrefWith("/portal/agents/runs", { status: "failed" }, { page: 2 })).toBe("/portal/agents/runs?page=2&status=failed");
  });
});
```

Run: `cd /Users/mustafajoulani/Desktop/anexa-agents-wt && pnpm exec vitest run src/lib/__tests__/agents-href.test.ts 2>&1 | tail -4`

Expected: FAIL — `Failed to resolve import "@/components/portal/agents/href"`.

- [ ] **Step 4: Implement**

```ts
// src/components/portal/agents/href.ts
/**
 * A link to the same page with some query parameters changed. Filters live in
 * the URL and are read on the server, so every filter chip and page link is a
 * plain <Link>. `null` or "" removes a parameter; keys are sorted so the same
 * filters always produce the same URL.
 */
export function hrefWith(
  path: string,
  current: Record<string, string | null | undefined>,
  patch: Record<string, string | number | null | undefined>
): string {
  const merged: Record<string, string | number | null | undefined> = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const key of Object.keys(merged).sort()) {
    const value = merged[key];
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
```

In `src/lib/nav.ts`, replace:

```ts
  ReceiptText,
  type LucideIcon,
```

with:

```ts
  ReceiptText,
  Bot,
  ListChecks,
  type LucideIcon,
```

Replace:

```ts
/** Every route an item owns — its own plus its tabs'. Used for highlighting. */
```

with:

```ts
/**
 * Agents and their run log. One sidebar row; Runs is where the needs-a-human
 * queue lives, so it is a tab beside the list rather than a second row.
 */
export const AGENT_TABS: NavTab[] = [
  { label: "Agents", href: "/portal/agents", icon: Bot, resource: "Agent" },
  { label: "Runs", href: "/portal/agents/runs", icon: ListChecks, resource: "Agent" },
];

/** Every route an item owns — its own plus its tabs'. Used for highlighting. */
```

Replace:

```ts
  { label: "Team", href: "/portal/team", icon: UserCog, resource: "User", group: "admin" },
```

with:

```ts
  // Read by role for owner, admin and accounting; a manager only with the Agents
  // access switch, which is an override `can()` honours. `roles` stops a stale
  // override on any other role from drawing the item — the pages refuse it too.
  {
    label: "Agents",
    href: "/portal/agents",
    icon: Bot,
    resource: "Agent",
    roles: ["super_admin", "admin", "accounting", "manager"],
    tabs: AGENT_TABS,
    group: "admin",
  },
  { label: "Team", href: "/portal/team", icon: UserCog, resource: "User", group: "admin" },
```

```tsx
// src/components/portal/agents/agent-tabs.tsx
import Link from "next/link";
import { AGENT_TABS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Agents | Runs. Both tabs belong to everyone who can open either, so unlike
 * PayTabs there is no per-tab check. `waiting` is the unresolved needs-a-human
 * count, drawn on Runs so it is seen from the Agents list as well.
 */
export function AgentTabs({ active, waiting }: { active: "/portal/agents" | "/portal/agents/runs"; waiting: number }) {
  return (
    <nav aria-label="Agents sections" className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
      {AGENT_TABS.map((t) => {
        const isActive = t.href === active;
        const count = t.href === "/portal/agents/runs" ? waiting : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              isActive
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            <t.icon className="size-4 shrink-0" />
            {t.label}
            {count > 0 && (
              <span className="rounded-full border chip-warning px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {count}
                <span className="sr-only"> need a human</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
```

```tsx
// src/components/portal/agents/filter-chips.tsx
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One row of filter choices, each a link: filters live in the URL and are read
 * on the server. "All" is the `null` option.
 */
export function FilterChips({
  label,
  options,
  active,
  hrefFor,
}: {
  label: string;
  options: { value: string | null; label: string }[];
  active: string | null;
  hrefFor: (value: string | null) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden className="mr-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {options.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={o.value ?? "all"}
            href={hrefFor(o.value)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
```

```tsx
// src/components/portal/agents/local-time.tsx
"use client";

import * as React from "react";
import { renderedAt, timeAgo } from "@/lib/agent-labels";

const noSubscribe = () => () => {};

/**
 * False during the server render and hydration, true after. For anything that
 * depends on the viewer's clock or time zone, which the server cannot know:
 * rendering it on the server would disagree with the browser and fail
 * hydration.
 */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(noSubscribe, () => true, () => false);
}

/** "4 min ago" (or the local date and time), with the local date and time on hover. UTC until hydrated. */
export function LocalTime({ iso, mode = "relative" }: { iso: string; mode?: "relative" | "absolute" }) {
  const client = useIsClient();
  if (!client) return <time dateTime={iso}>{`${iso.slice(0, 16).replace("T", " ")} UTC`}</time>;
  const local = new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={iso} title={local}>
      {mode === "relative" ? timeAgo(iso, renderedAt()) : local}
    </time>
  );
}
```

```tsx
// src/components/portal/agents/run-status-pill.tsx
import type { AgentRunStatus } from "@prisma/client";
import { STATUS_CHIP, STATUS_LABEL } from "@/lib/agent-labels";
import { cn } from "@/lib/utils";

export function RunStatusPill({ status }: { status: AgentRunStatus }) {
  return (
    <span
      data-testid="run-status"
      className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_CHIP[status])}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
```

```tsx
// src/components/portal/agents/agent-enabled-switch.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setAgentEnabledAction } from "@/server/modules/agents/actions";

/** On/off, for an owner or admin. The pages show everyone else the words instead. */
export function AgentEnabledSwitch({ agentId, name, enabled }: { agentId: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = React.useState(enabled);
  const [seen, setSeen] = React.useState(enabled);
  const [busy, setBusy] = React.useState(false);
  if (seen !== enabled) {
    setSeen(enabled);
    setChecked(enabled);
  }

  async function change(next: boolean) {
    setBusy(true);
    setChecked(next);
    try {
      const res = await setAgentEnabledAction(agentId, next);
      if (!res.ok) {
        setChecked(!next);
        toast.error(res.error);
        return;
      }
      toast.success(`${name} turned ${next ? "on" : "off"}`);
      router.refresh();
    } catch {
      setChecked(!next);
      toast.error("Could not change the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Switch
      data-testid="agent-enabled"
      checked={checked}
      onCheckedChange={change}
      disabled={busy}
      aria-label={`Enabled — ${name}`}
    />
  );
}
```

```tsx
// src/app/portal/agents/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { agentCan, canEditAgentConfig } from "@/server/modules/agents/access";
import { countNeedsHuman, listAgents } from "@/server/modules/agents/queries";
import { describeSchedule } from "@/server/modules/agents/schedule";
import {
  DEPARTMENTS,
  DEPARTMENT_LABEL,
  PRODUCTS,
  PRODUCT_LABEL,
  isDepartment,
  isProduct,
  productOf,
} from "@/lib/agent-labels";
import { EmptyState, PageHeader } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AgentEnabledSwitch } from "@/components/portal/agents/agent-enabled-switch";
import { AgentTabs } from "@/components/portal/agents/agent-tabs";
import { FilterChips } from "@/components/portal/agents/filter-chips";
import { hrefWith } from "@/components/portal/agents/href";
import { LocalTime } from "@/components/portal/agents/local-time";
import { RunStatusPill } from "@/components/portal/agents/run-status-pill";

export const metadata = { title: "Agents" };

const HEAD = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; department?: string }>;
}) {
  const user = await requireUser();
  if (!agentCan(user, "read")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const product = isProduct(sp.product) ? sp.product : null;
  const department = isDepartment(sp.department) ? sp.department : null;
  const current = { product, department };

  const [agents, waiting] = await Promise.all([listAgents(user, { product, department }), countNeedsHuman(user)]);
  const canEdit = canEditAgentConfig(user);
  const filtered = product !== null || department !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Back-office automations: what each one does, when it runs, and how its last run went."
        action={
          canEdit ? (
            <Button asChild size="sm">
              <Link href="/portal/agents/new">
                <Plus className="size-4" /> New agent
              </Link>
            </Button>
          ) : undefined
        }
      />

      <AgentTabs active="/portal/agents" waiting={waiting} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterChips
          label="Product"
          active={product}
          options={[{ value: null, label: "All" }, ...PRODUCTS.map((p) => ({ value: p, label: PRODUCT_LABEL[p] }))]}
          hrefFor={(value) => hrefWith("/portal/agents", current, { product: value })}
        />
        <FilterChips
          label="Department"
          active={department}
          options={[{ value: null, label: "All" }, ...DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] }))]}
          hrefFor={(value) => hrefWith("/portal/agents", current, { department: value })}
        />
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={filtered ? "No agents match these filters" : "No agents yet"}
          description={
            filtered
              ? "Clear a filter to see more."
              : canEdit
                ? "Create one with New agent."
                : "An owner or admin creates agents."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table className="[&_td]:px-4 [&_th]:px-4">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={HEAD}>Agent</TableHead>
                <TableHead className={HEAD}>Product</TableHead>
                <TableHead className={`hidden md:table-cell ${HEAD}`}>Department</TableHead>
                <TableHead className={`hidden lg:table-cell ${HEAD}`}>Schedule</TableHead>
                <TableHead className={HEAD}>Enabled</TableHead>
                <TableHead className={HEAD}>Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.id} data-testid="agent-row">
                  <TableCell className="max-w-md whitespace-normal align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/portal/agents/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      {a.handlerMissing && (
                        <span className="rounded-full border chip-danger px-2 py-0.5 text-[11px] font-medium">Handler missing</span>
                      )}
                    </div>
                    {a.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.description}</p>}
                  </TableCell>
                  <TableCell className="align-top text-sm">{PRODUCT_LABEL[productOf(a.vertical)]}</TableCell>
                  <TableCell className="hidden align-top text-sm md:table-cell">{DEPARTMENT_LABEL[a.department]}</TableCell>
                  <TableCell className="hidden align-top lg:table-cell">
                    <div className="text-sm">{describeSchedule(a.schedule)}</div>
                    {a.schedule && <code className="text-xs text-muted-foreground">{a.schedule}</code>}
                  </TableCell>
                  <TableCell className="align-top">
                    {canEdit ? (
                      <AgentEnabledSwitch agentId={a.id} name={a.name} enabled={a.enabled} />
                    ) : (
                      <span className="text-sm">{a.enabled ? "On" : "Off"}</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {a.lastRun ? (
                      <div className="flex flex-col items-start gap-1">
                        <RunStatusPill status={a.lastRun.status} />
                        <span className="text-xs text-muted-foreground">
                          <LocalTime iso={a.lastRun.createdAt.toISOString()} />
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never run</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the unit test, the browser tests, the typecheck and lint**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm exec vitest run src/lib/__tests__/agents-href.test.ts 2>&1 | tail -4
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/lib/nav.ts src/components/portal/agents src/app/portal/agents; echo "eslint exit=$?"
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -12
```

Expected: 1 unit test passed; `typecheck exit=0`; `eslint exit=0`; `2 passed`.

- [ ] **Step 6: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/lib/nav.ts src/components/portal/agents/href.ts src/components/portal/agents/agent-tabs.tsx src/components/portal/agents/filter-chips.tsx src/components/portal/agents/local-time.tsx src/components/portal/agents/run-status-pill.tsx src/components/portal/agents/agent-enabled-switch.tsx src/app/portal/agents/page.tsx src/lib/__tests__/agents-href.test.ts e2e/agents.spec.ts
git commit -m "feat(agents): the Agents sidebar item and list, filtered by product and department" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: Agent detail, New agent, and Run now

**Files:**
- Create: `src/components/portal/agents/change-list.tsx`, `src/components/portal/agents/resolve-run.tsx`, `src/components/portal/agents/run-list.tsx`, `src/components/portal/agents/run-now-button.tsx`, `src/components/portal/agents/agent-config-form.tsx`, `src/components/portal/agents/pagination.tsx`, `src/components/portal/agents/auto-refresh.tsx`, `src/components/portal/agents/product-choices.ts`, `src/app/portal/agents/[id]/page.tsx`, `src/app/portal/agents/new/page.tsx`
- Modify: `e2e/agents.spec.ts`

- [ ] **Step 1: Add the failing browser tests**

Append to `e2e/agents.spec.ts`:

```ts
test("an admin runs the disabled Hello Agent, after confirming, and reads the run", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents");
  await page.getByRole("link", { name: "Hello Agent" }).click();
  await page.waitForURL(/\/portal\/agents\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Hello Agent", level: 1 })).toBeVisible();

  await page.getByTestId("agent-run-now").click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Run a disabled agent?");
  await confirm.getByRole("button", { name: "Run anyway" }).click();

  // The run is written queued and finishes inside after(). The page refreshes
  // itself while anything is in flight; a reload is the fallback.
  const done = page.getByTestId("agent-run").filter({ hasText: "Said hello" }).first();
  await expect(async () => {
    if (!(await done.isVisible())) await page.reload();
    await expect(done).toHaveAttribute("data-status", "success", { timeout: 2000 });
  }).toPass({ timeout: 45000 });

  await done.getByRole("button", { name: /Said hello/ }).click();
  const detail = done.getByTestId("agent-run-detail");
  await expect(detail).toContainText('"greeting": "hello"');
  await expect(detail).toContainText("Run now by Dana Hill");
});

test("an admin creates an agent — and a secret in its config is refused", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents");
  await page.getByRole("link", { name: "New agent" }).click();
  await page.waitForURL("**/portal/agents/new", { timeout: 15000 });

  await page.getByLabel("Name", { exact: true }).fill("E2E Poller");
  await page.getByRole("combobox", { name: "Schedule" }).click();
  await page.getByRole("option", { name: "Every 15 minutes" }).click();
  await expect(page.getByTestId("agent-upcoming-runs")).toBeVisible();

  await page.getByLabel("Config (JSON)", { exact: true }).fill('{"password":"hunter2"}');
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/config\.password looks like a secret/)).toBeVisible({ timeout: 10000 });

  await page.getByLabel("Config (JSON)", { exact: true }).fill("{}");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.waitForURL(/\/portal\/agents\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "E2E Poller", level: 1 })).toBeVisible();
});

test("accounting reads an agent and its config, with no Run now and nothing to edit", async ({ page }) => {
  await login(page, "accounting@anexahomes.com");
  await page.goto("/portal/agents");
  await page.getByRole("link", { name: "Hello Agent" }).click();
  await page.waitForURL(/\/portal\/agents\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByTestId("agent-config-readonly")).toContainText("system.hello");
  await expect(page.getByTestId("agent-run-now")).toHaveCount(0);
  await expect(page.getByTestId("agent-enabled")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save changes|Create agent/ })).toHaveCount(0);

  await page.goto("/portal/agents/new");
  await page.waitForURL(/\/portal\/agents$/, { timeout: 15000 });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -16
```

Expected: the two Task 20 tests pass; the three new ones FAIL — clicking Hello Agent lands on a 404, so the `level: 1` heading is never visible.

- [ ] **Step 3: Implement the run pieces**

```tsx
// src/components/portal/agents/change-list.tsx
import Link from "next/link";
import type { ChangeOutcome, ChangeRecord } from "@/server/modules/agents/types";
import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<ChangeOutcome, string> = {
  applied: "Applied",
  noop: "Already there",
  held: "Held for a person",
  discarded: "Not applied",
  invalid: "Invalid",
};

const OUTCOME_CHIP: Record<ChangeOutcome, string> = {
  applied: "chip-good",
  noop: "chip-neutral",
  held: "chip-warning",
  discarded: "chip-danger",
  invalid: "chip-danger",
};

/** "Move Maria Lopez · 12 Elm St from NTP Submitted to NTP Approved". */
export function changeSentence(c: ChangeRecord): string {
  const deal = c.dealLabel ?? "a deal that could not be found";
  const to = c.toStage?.name ?? c.toStageKey;
  return c.fromStage ? `Move ${deal} from ${c.fromStage.name} to ${to}` : `Move ${deal} to ${to}`;
}

export function ChangeList({ changes }: { changes: ChangeRecord[] }) {
  if (changes.length === 0) return null;
  return (
    <ul data-testid="agent-run-changes" className="space-y-2">
      {changes.map((c, i) => (
        <li key={`${c.leadId}-${i}`} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", OUTCOME_CHIP[c.outcome])}>
              {OUTCOME_LABEL[c.outcome]}
            </span>
            <span>{changeSentence(c)}</span>
            {c.dealLabel && (
              <Link href={`/portal/leads/${c.leadId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                Open deal
              </Link>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{`Reason: ${c.reason}`}</p>
          {c.note && <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>}
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// src/components/portal/agents/resolve-run.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAgentRunAction } from "@/server/modules/agents/actions";

/**
 * The two ways out of the queue. Apply moves the deal now, as the person
 * pressing it, and runs that stage's automations — so it asks first. Close
 * needs a sentence saying why, because that sentence is the only record of
 * the decision.
 */
export function ResolveRun({ runId, heldCount }: { runId: string; heldCount: number }) {
  const router = useRouter();
  const noteId = React.useId();
  const [confirmApply, setConfirmApply] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function resolve(resolution: "applied" | "closed") {
    setBusy(true);
    try {
      const res = await resolveAgentRunAction({ runId, resolution, note: note.trim() });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (resolution === "closed") toast.success("Closed without applying");
      else if (res.failed > 0) toast.warning(`Applied, but ${res.failed} of the changes could not be. The run says why.`);
      else toast.success(heldCount === 1 ? "Change applied" : "Changes applied");
      setConfirmApply(false);
      setClosing(false);
      setNote("");
      router.refresh();
    } catch {
      toast.error("Could not resolve the run. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="resolve-run" className="flex flex-wrap gap-2">
      {heldCount > 0 && (
        <Button size="sm" onClick={() => setConfirmApply(true)} disabled={busy}>
          <Check className="size-4" /> {heldCount === 1 ? "Apply change" : `Apply ${heldCount} changes`}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setClosing(true)} disabled={busy}>
        <X className="size-4" /> Close without applying
      </Button>

      <AlertDialog open={confirmApply} onOpenChange={(open) => !busy && setConfirmApply(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{heldCount === 1 ? "Apply this change?" : `Apply ${heldCount} changes?`}</AlertDialogTitle>
            <AlertDialogDescription>
              The deal moves now, recorded as you, and that stage&apos;s automations run. If the deal has moved since the
              agent looked, nothing is applied.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void resolve("applied");
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={closing} onOpenChange={(open) => !busy && setClosing(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close without applying</DialogTitle>
            <DialogDescription>Nothing changes on the deal. Say why, so the next person reading this run knows.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={noteId} className="text-xs">
              Why it is closed
            </Label>
            <Textarea
              id={noteId}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Bank confirmed NTP by phone; the deal was already moved."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void resolve("closed")} disabled={busy || note.trim() === ""}>
              {busy && <Loader2 className="size-4 animate-spin" />} Close run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

```tsx
// src/components/portal/agents/run-list.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatRunDuration, PRODUCT_LABEL, productOf, TRIGGER_LABEL } from "@/lib/agent-labels";
import type { RunView } from "@/server/modules/agents/queries";
import { ChangeList } from "./change-list";
import { LocalTime } from "./local-time";
import { ResolveRun } from "./resolve-run";
import { RunStatusPill } from "./run-status-pill";

/** The handler's own figure when it finished; otherwise start to finish. */
function durationMs(run: RunView): number | null {
  if (run.detail.durationMs !== null) return run.detail.durationMs;
  if (run.startedAt && run.finishedAt) return Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return null;
}

function headline(run: RunView): string {
  if (run.summary) return run.summary;
  if (run.status === "queued") return "Waiting to start";
  if (run.status === "running") return "Running…";
  return "No summary";
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

const PRE = "max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs";

/**
 * Run history. Each row opens in place to everything the runner recorded — the
 * spec's success test ends with a person reading exactly this.
 */
export function RunList({
  runs,
  canResolve,
  showAgent = false,
  emptyText,
}: {
  runs: RunView[];
  canResolve: boolean;
  showAgent?: boolean;
  emptyText: string;
}) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (runs.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {runs.map((run) => {
        const expanded = open.has(run.id);
        const detailId = `agent-run-detail-${run.id}`;
        const held = run.detail.changes.filter((c) => c.outcome === "held").length;
        const facts = [
          showAgent ? run.agentName : null,
          PRODUCT_LABEL[productOf(run.vertical)],
          TRIGGER_LABEL[run.trigger],
          run.resolution ? (run.resolution.how === "applied" ? "Applied" : "Closed") : null,
        ].filter(Boolean);

        return (
          <li key={run.id} data-testid="agent-run" data-status={run.status}>
            <button
              type="button"
              onClick={() => toggle(run.id)}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              {expanded ? (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              )}
              <RunStatusPill status={run.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{headline(run)}</span>
                <span className="block truncate text-xs text-muted-foreground">{facts.join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <LocalTime iso={run.createdAt} />
                <span className="block tabular-nums">{formatRunDuration(durationMs(run))}</span>
              </span>
            </button>

            {expanded && (
              <div id={detailId} data-testid="agent-run-detail" className="space-y-4 border-t border-border bg-muted/20 px-4 py-4 text-sm">
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Agent">
                    <Link href={`/portal/agents/${run.agentId}`} className="hover:underline">
                      {run.agentName}
                    </Link>
                  </Fact>
                  <Fact label="Trigger">
                    {run.triggeredBy ? `${TRIGGER_LABEL[run.trigger]} by ${run.triggeredBy}` : TRIGGER_LABEL[run.trigger]}
                  </Fact>
                  <Fact label="Started">{run.startedAt ? <LocalTime iso={run.startedAt} mode="absolute" /> : "Not started"}</Fact>
                  <Fact label="Finished">{run.finishedAt ? <LocalTime iso={run.finishedAt} mode="absolute" /> : "—"}</Fact>
                  <Fact label="Duration">{formatRunDuration(durationMs(run))}</Fact>
                  <Fact label="Workspace">{PRODUCT_LABEL[productOf(run.vertical)]}</Fact>
                  <Fact label="Human gate">{run.detail.gated ? "On" : "Off"}</Fact>
                  {run.leadId && run.leadLabel && (
                    <Fact label="Deal">
                      <Link href={`/portal/leads/${run.leadId}`} className="hover:underline">
                        {run.leadLabel}
                      </Link>
                    </Fact>
                  )}
                </dl>

                {run.detail.changes.length > 0 && (
                  <Section title="Requested changes">
                    <ChangeList changes={run.detail.changes} />
                  </Section>
                )}
                {run.error && (
                  <Section title="Error">
                    <pre className={`${PRE} whitespace-pre-wrap text-destructive`}>{run.error}</pre>
                  </Section>
                )}
                {run.detail.log.length > 0 && (
                  <Section title="Log">
                    <pre className={PRE}>{run.detail.log.join("\n")}</pre>
                  </Section>
                )}
                {run.detail.handler && (
                  <Section title="Handler detail">
                    <pre className={PRE}>{JSON.stringify(run.detail.handler, null, 2)}</pre>
                  </Section>
                )}
                {run.detail.lateResult != null && (
                  <Section title="Late result">
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      The handler answered after this run had been closed. Nothing in it was applied.
                    </p>
                    <pre className={PRE}>{JSON.stringify(run.detail.lateResult, null, 2)}</pre>
                  </Section>
                )}

                {run.resolution ? (
                  <Section title="Resolution">
                    <p>
                      {`${run.resolution.how === "applied" ? "Applied" : "Closed without applying"} by ${run.resolution.by ?? "a former user"}, `}
                      <LocalTime iso={run.resolution.at} mode="absolute" />
                    </p>
                    {run.resolution.note && <p className="mt-1 text-muted-foreground">{run.resolution.note}</p>}
                    {run.detail.resolution && run.detail.resolution.changes.length > 0 && (
                      <div className="mt-2">
                        <ChangeList changes={run.detail.resolution.changes} />
                      </div>
                    )}
                  </Section>
                ) : run.status === "needs_human" && canResolve ? (
                  <ResolveRun runId={run.id} heldCount={held} />
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

```tsx
// src/components/portal/agents/run-now-button.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { runAgentNowAction } from "@/server/modules/agents/actions";

/**
 * Run now. A disabled agent asks first: once real portal agents exist,
 * "disabled" usually means somebody turned it off on purpose. The server asks
 * the same question (`needsConfirm`), so a page that was open when the agent
 * was switched off still gets the prompt.
 */
export function RunNowButton({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function run(confirmDisabled: boolean) {
    setBusy(true);
    try {
      const res = await runAgentNowAction(agentId, { confirmDisabled });
      if (!res.ok) {
        if ("needsConfirm" in res && res.needsConfirm) {
          setAsking(true);
          return;
        }
        toast.error(res.error);
        router.refresh(); // a missing handler has still written its failed runs
        return;
      }
      setAsking(false);
      toast.success(
        res.runIds.length === 1 ? "Started. The run appears below." : `Started in ${res.runIds.length} workspaces. The runs appear below.`
      );
      router.refresh();
    } catch {
      toast.error("Could not start the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" data-testid="agent-run-now" disabled={busy} onClick={() => (enabled ? void run(false) : setAsking(true))}>
        {busy && !asking ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run now
      </Button>
      <AlertDialog open={asking} onOpenChange={(open) => !busy && setAsking(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run a disabled agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent is turned off, possibly on purpose. Running it now does not turn it back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void run(true);
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

```tsx
// src/components/portal/agents/pagination.tsx
import Link from "next/link";

/** Previous / Next for a server-rendered list. Not drawn when there is one page. */
export function Pagination({
  page,
  pageCount,
  total,
  noun,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  noun: string;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const step = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{`Page ${page} of ${pageCount} · ${total} ${noun}`}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={`${step} hover:bg-muted/40`}>
            Previous
          </Link>
        ) : (
          <span className={`${step} text-muted-foreground opacity-50`}>Previous</span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={`${step} hover:bg-muted/40`}>
            Next
          </Link>
        ) : (
          <span className={`${step} text-muted-foreground opacity-50`}>Next</span>
        )}
      </div>
    </nav>
  );
}
```

```tsx
// src/components/portal/agents/auto-refresh.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page every few seconds while something on it is queued or
 * running, so a Run now is followed through to its result without a reload.
 * Stops as soon as nothing on the page is in flight.
 */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
```

- [ ] **Step 4: Implement the form**

```ts
// src/components/portal/agents/product-choices.ts
import type { Product } from "@/lib/agent-labels";
import { companyVerticals, userVerticals } from "@/server/auth/vertical";

/** What an editor may set an agent's product to: Both, or a live workspace they hold. */
export function productChoicesFor(user: Parameters<typeof userVerticals>[0]): Product[] {
  const held = userVerticals(user);
  return ["both", ...companyVerticals().filter((v) => held.includes(v))];
}
```

```tsx
// src/components/portal/agents/agent-config-form.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import type { AgentDepartment } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  FieldGrid,
  NumField,
  Panel,
  SaveBar,
  SelectField,
  TextAreaField,
  TextField,
  ToggleRow,
  useDraft,
} from "@/components/portal/settings-kit";
import { DEPARTMENTS, DEPARTMENT_LABEL, PRODUCT_LABEL, type AgentFormValues, type Product } from "@/lib/agent-labels";
import { createAgentAction, updateAgentAction } from "@/server/modules/agents/actions";
import { SCHEDULE_PRESETS, upcomingRuns, validateSchedule } from "@/server/modules/agents/schedule";
import { useIsClient } from "./local-time";

const NONE = "none";
const CUSTOM = "custom";

const isPreset = (schedule: string) => SCHEDULE_PRESETS.some((p) => p.schedule === schedule);

/**
 * An agent's config, for an owner or admin. The server re-validates everything
 * (validate-agent.ts); what this form checks is only what it can show while
 * someone types — a schedule that will not parse, and when it would next run.
 */
export function AgentConfigForm({
  mode,
  initial,
  handlers,
  products,
}: {
  mode: { kind: "create" } | { kind: "edit"; agentId: string };
  initial: AgentFormValues;
  handlers: { value: string; label: string }[];
  products: Product[];
}) {
  const router = useRouter();
  const client = useIsClient();
  const { draft, set, dirty, reset } = useDraft(initial);
  const [customMode, setCustomMode] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const trimmed = draft.schedule.trim();
  const custom = customMode || (trimmed !== "" && !isPreset(trimmed));
  const scheduleChoice = custom ? CUSTOM : trimmed === "" ? NONE : trimmed;
  const checked = trimmed ? validateSchedule(trimmed) : null;
  const upcoming = client && checked?.ok ? upcomingRuns(checked.schedule, 3) : [];

  // A removed handler, or a product this editor could not normally pick, still
  // shows as the current value rather than as a blank box.
  const handlerChoices = handlers.some((h) => h.value === draft.handlerKey)
    ? handlers
    : [{ value: draft.handlerKey, label: `${draft.handlerKey} — not deployed` }, ...handlers];
  const productChoices = (products.includes(draft.product) ? products : [draft.product, ...products]).map((p) => ({
    value: p,
    label: PRODUCT_LABEL[p],
  }));

  async function save() {
    setBusy(true);
    try {
      if (mode.kind === "create") {
        const res = await createAgentAction(draft);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`${draft.name.trim()} created`);
        router.push(`/portal/agents/${res.id}`);
      } else {
        const res = await updateAgentAction(mode.agentId, draft);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Saved");
        router.refresh();
      }
    } catch {
      toast.error("Could not save the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Agent">
        <div className="space-y-3">
          <TextField label="Name" value={draft.name} onChange={(v) => set("name", v)} placeholder="NTP Poller" />
          <TextAreaField
            label="Description"
            value={draft.description}
            onChange={(v) => set("description", v)}
            rows={2}
            placeholder="What it checks, and what it does about it."
          />
          <SelectField
            label="Handler"
            value={draft.handlerKey}
            onChange={(v) => set("handlerKey", v)}
            options={handlerChoices}
            hint="The code this agent runs. Only handlers in this deployment are listed."
          />
          <FieldGrid>
            <SelectField<Product>
              label="Product"
              value={draft.product}
              onChange={(v) => set("product", v)}
              options={productChoices}
              hint="Both runs once in each workspace."
            />
            <SelectField<AgentDepartment>
              label="Department"
              value={draft.department}
              onChange={(v) => set("department", v)}
              options={DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] }))}
            />
          </FieldGrid>
          {mode.kind === "create" && (
            <ToggleRow
              label="Turn it on now"
              description="Off, it never runs on its schedule. Run now still works, after a confirmation."
              checked={draft.enabled}
              onChange={(v) => set("enabled", v)}
            />
          )}
        </div>
      </Panel>

      <Panel title="When it runs">
        <div className="space-y-3">
          <SelectField
            label="Schedule"
            value={scheduleChoice}
            onChange={(v) => {
              if (v === CUSTOM) {
                setCustomMode(true);
                return;
              }
              setCustomMode(false);
              set("schedule", v === NONE ? "" : v);
            }}
            options={[
              { value: NONE, label: "Only when someone presses Run now" },
              ...SCHEDULE_PRESETS.map((p) => ({ value: p.schedule as string, label: p.label })),
              { value: CUSTOM, label: "Custom cron" },
            ]}
          />
          {custom && (
            <TextField
              label="Cron expression"
              value={draft.schedule}
              onChange={(v) => set("schedule", v)}
              placeholder="*/10 * * * *"
              hint="Five fields — minute hour day month weekday — in UTC."
            />
          )}
          {checked && !checked.ok && <p className="text-xs text-destructive">{checked.error}</p>}
          {upcoming.length > 0 && (
            <div data-testid="agent-upcoming-runs" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="font-medium">Next runs, in your time</div>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {upcoming.map((d) => (
                  <li key={d.toISOString()}>
                    {d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <NumField
            label="Timeout (seconds)"
            value={draft.timeoutSeconds}
            onChange={(v) => set("timeoutSeconds", v)}
            step="1"
            hint="5 to 240. A run still going at its timeout is stopped and recorded as failed."
          />
        </div>
      </Panel>

      <Panel title="Human gate">
        <ToggleRow
          label="Hold stage moves for a person"
          description={
            draft.requiresHumanGate
              ? "On: by itself, this agent can only move a deal into an Action Required stage. Any other move waits in Runs → Needs a human."
              : "Off: this agent can advance deals by itself."
          }
          checked={draft.requiresHumanGate}
          onChange={(v) => set("requiresHumanGate", v)}
        />
      </Panel>

      <Panel title="Config">
        <TextAreaField
          label="Config (JSON)"
          value={draft.config}
          onChange={(v) => set("config", v)}
          rows={6}
          hint="Settings for the handler, checked when you save. Never a password or key — name where it lives instead, like env:AGENT_BANK_TOKEN."
        />
      </Panel>

      {mode.kind === "create" ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create agent
          </Button>
        </div>
      ) : (
        <SaveBar
          dirty={dirty}
          busy={busy}
          onSave={save}
          onDiscard={() => {
            reset();
            setCustomMode(false);
          }}
          what="this agent"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement the two pages**

```tsx
// src/app/portal/agents/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { agentCan, canEditAgentConfig } from "@/server/modules/agents/access";
import { countNeedsHuman, getAgent, listRunsForAgent, type AgentView } from "@/server/modules/agents/queries";
import { handlerOptions } from "@/server/modules/agents/registry";
import { describeSchedule } from "@/server/modules/agents/schedule";
import { DEPARTMENT_LABEL, PRODUCT_LABEL, productOf } from "@/lib/agent-labels";
import { cn } from "@/lib/utils";
import { AgentConfigForm } from "@/components/portal/agents/agent-config-form";
import { AgentEnabledSwitch } from "@/components/portal/agents/agent-enabled-switch";
import { AgentTabs } from "@/components/portal/agents/agent-tabs";
import { AutoRefresh } from "@/components/portal/agents/auto-refresh";
import { hrefWith } from "@/components/portal/agents/href";
import { LocalTime } from "@/components/portal/agents/local-time";
import { Pagination } from "@/components/portal/agents/pagination";
import { productChoicesFor } from "@/components/portal/agents/product-choices";
import { RunList } from "@/components/portal/agents/run-list";
import { RunNowButton } from "@/components/portal/agents/run-now-button";

export const metadata = { title: "Agent" };
// Run now's after() and a resolve's stage automations both run inside this
// page's server actions, so they get the same 300 s the cron tick has.
export const maxDuration = 300;

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function ReadOnlyConfig({ agent }: { agent: AgentView }) {
  const rows: [string, React.ReactNode][] = [
    ["Handler", agent.handlerLabel ? `${agent.handlerLabel} (${agent.handlerKey})` : `${agent.handlerKey} — not deployed`],
    ["Product", PRODUCT_LABEL[productOf(agent.vertical)]],
    ["Department", DEPARTMENT_LABEL[agent.department]],
    ["Schedule", agent.schedule ? `${describeSchedule(agent.schedule)} (${agent.schedule}, UTC)` : "Only when someone presses Run now"],
    ["Timeout", `${agent.timeoutSeconds} seconds`],
    ["Human gate", agent.requiresHumanGate ? "On" : "Off — can advance deals by itself"],
    ["Last edited", agent.updatedBy ? `${agent.updatedBy}` : "—"],
  ];
  return (
    <div data-testid="agent-config-readonly" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">Config</div>
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
          {JSON.stringify(agent.config ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  if (!agentCan(user, "read")) redirect("/portal/dashboard");
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const agent = await getAgent(user, id);
  if (!agent) notFound();

  const [runs, waiting] = await Promise.all([listRunsForAgent(user, agent.id, Number(sp.page) || 1), countNeedsHuman(user)]);
  const canEdit = canEditAgentConfig(user);
  const inFlight = runs.runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="space-y-6">
      <AutoRefresh active={inFlight} />
      <Link href="/portal/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All agents
      </Link>

      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{agent.name}</h1>
          {agent.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{agent.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <Chip>{PRODUCT_LABEL[productOf(agent.vertical)]}</Chip>
            <Chip>{DEPARTMENT_LABEL[agent.department]}</Chip>
            {agent.handlerLabel ? (
              <Chip>{agent.handlerLabel}</Chip>
            ) : (
              <span className="rounded-full border chip-danger px-2 py-0.5">{`Handler missing: ${agent.handlerKey}`}</span>
            )}
            <span className={cn("rounded-full border px-2 py-0.5", agent.requiresHumanGate ? "chip-info" : "chip-warning")}>
              {agent.requiresHumanGate ? "Human gate" : "Can advance deals"}
            </span>
            <Chip>{describeSchedule(agent.schedule)}</Chip>
            {agent.enabled && agent.nextRunAt && (
              <Chip>
                Next run <LocalTime iso={agent.nextRunAt} mode="absolute" />
              </Chip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {canEdit ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              Enabled
              <AgentEnabledSwitch agentId={agent.id} name={agent.name} enabled={agent.enabled} />
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{agent.enabled ? "Enabled" : "Turned off"}</span>
          )}
          {agentCan(user, "run") && <RunNowButton agentId={agent.id} enabled={agent.enabled} />}
        </div>
      </div>

      <AgentTabs active="/portal/agents" waiting={waiting} />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          <h2 className="font-semibold">Run history</h2>
          <RunList runs={runs.runs} canResolve={agentCan(user, "approve")} emptyText="No runs yet." />
          <Pagination
            page={runs.page}
            pageCount={runs.pageCount}
            total={runs.total}
            noun="runs"
            hrefFor={(p) => hrefWith(`/portal/agents/${agent.id}`, {}, { page: p === 1 ? null : p })}
          />
        </section>
        <section className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Config</h2>
          {canEdit ? (
            <AgentConfigForm
              mode={{ kind: "edit", agentId: agent.id }}
              initial={agent.form}
              handlers={handlerOptions()}
              products={productChoicesFor(user)}
            />
          ) : (
            <ReadOnlyConfig agent={agent} />
          )}
        </section>
      </div>
    </div>
  );
}
```

```tsx
// src/app/portal/agents/new/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditAgentConfig } from "@/server/modules/agents/access";
import { handlerOptions } from "@/server/modules/agents/registry";
import { NEW_AGENT_VALUES } from "@/lib/agent-labels";
import { PageHeader } from "@/components/portal/ui";
import { AgentConfigForm } from "@/components/portal/agents/agent-config-form";
import { productChoicesFor } from "@/components/portal/agents/product-choices";

export const metadata = { title: "New agent" };

export default async function NewAgentPage() {
  const user = await requireUser();
  // Anyone else who can read agents lands on the list; the list itself sends
  // away everyone who cannot.
  if (!canEditAgentConfig(user)) redirect("/portal/agents");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/portal/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All agents
      </Link>
      <PageHeader
        title="New agent"
        description="A handler, when it runs, and what it may do on its own. It starts turned off unless you turn it on here."
      />
      <AgentConfigForm mode={{ kind: "create" }} initial={NEW_AGENT_VALUES} handlers={handlerOptions()} products={productChoicesFor(user)} />
    </div>
  );
}
```

- [ ] **Step 6: Run the browser tests, the typecheck and lint**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/components/portal/agents src/app/portal/agents; echo "eslint exit=$?"
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -14
```

Expected: `typecheck exit=0`; `eslint exit=0`; `5 passed`. If the Hello run never reaches `success`, read the dev server output that Playwright prints for `[agents]` lines before changing anything: a run stuck `queued` means `after()` did not run, which the tick would cover in production but which this test deliberately does not wait for.

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/components/portal/agents/change-list.tsx src/components/portal/agents/resolve-run.tsx src/components/portal/agents/run-list.tsx src/components/portal/agents/run-now-button.tsx src/components/portal/agents/agent-config-form.tsx src/components/portal/agents/pagination.tsx src/components/portal/agents/auto-refresh.tsx src/components/portal/agents/product-choices.ts "src/app/portal/agents/[id]/page.tsx" src/app/portal/agents/new/page.tsx e2e/agents.spec.ts
git commit -m "feat(agents): agent detail with run history, config form, Run now, and New agent" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: The Runs page — Needs a human first

**Files:**
- Create: `src/components/portal/agents/needs-human-card.tsx`, `src/app/portal/agents/runs/page.tsx`
- Modify: `e2e/agents.spec.ts`

- [ ] **Step 1: Add the failing browser test**

Append to `e2e/agents.spec.ts`:

```ts
test("Runs puts Needs a human first, and the status filter narrows the feed", async ({ page }) => {
  // Reads the success run the admin test above wrote: run the whole file.
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents/runs");

  const needs = page.getByRole("heading", { name: /Needs a human/ });
  const all = page.getByRole("heading", { name: "All runs" });
  await expect(needs).toBeVisible();
  await expect(all).toBeVisible();
  expect((await needs.boundingBox())!.y).toBeLessThan((await all.boundingBox())!.y);

  const status = page.getByRole("group", { name: "Status" });
  await status.getByRole("link", { name: "Success", exact: true }).click();
  await expect(page).toHaveURL(/[?&]status=success/);
  await expect(status.getByRole("link", { name: "Success", exact: true })).toHaveAttribute("aria-current", "true");
  const rows = page.getByTestId("agent-run");
  await expect(rows.first()).toBeVisible();
  expect(new Set(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-status"))))).toEqual(new Set(["success"]));

  await status.getByRole("link", { name: "Failed", exact: true }).click();
  await expect(page).toHaveURL(/[?&]status=failed/);
  await expect(page.getByText("No runs match these filters.")).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -12
```

Expected: 5 passed, 1 FAILED — `/portal/agents/runs` is a 404, so the heading is never visible.

- [ ] **Step 3: Implement**

```tsx
// src/components/portal/agents/needs-human-card.tsx
import Link from "next/link";
import { PRODUCT_LABEL, productOf } from "@/lib/agent-labels";
import type { RunView } from "@/server/modules/agents/queries";
import { changeSentence } from "./change-list";
import { LocalTime } from "./local-time";
import { ResolveRun } from "./resolve-run";

/**
 * One run waiting on a person: which agent, which deal, what it wants to do
 * in words, and the two ways to answer it.
 */
export function NeedsHumanCard({ run, canResolve }: { run: RunView; canResolve: boolean }) {
  const held = run.detail.changes.filter((c) => c.outcome === "held");
  return (
    <article data-testid="needs-human-card" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/portal/agents/${run.agentId}`} className="font-semibold hover:underline">
            {run.agentName}
          </Link>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {PRODUCT_LABEL[productOf(run.vertical)]}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          <LocalTime iso={run.createdAt} />
        </span>
      </header>

      {run.summary && <p className="text-sm">{run.summary}</p>}

      {held.length > 0 ? (
        <ul className="space-y-1.5">
          {held.map((c, i) => (
            <li key={`${c.leadId}-${i}`} className="rounded-lg border chip-warning px-3 py-2 text-sm">
              <div className="font-medium">{changeSentence(c)}</div>
              <div className="mt-0.5 text-xs">{`Why: ${c.reason}`}</div>
              <Link href={`/portal/leads/${c.leadId}`} className="mt-1 inline-block text-xs underline-offset-2 hover:underline">
                Open deal
              </Link>
            </li>
          ))}
        </ul>
      ) : run.leadId && run.leadLabel ? (
        <Link href={`/portal/leads/${run.leadId}`} className="text-sm underline-offset-2 hover:underline">
          {run.leadLabel}
        </Link>
      ) : null}

      {run.error && <p className="text-xs text-muted-foreground">{run.error}</p>}

      {canResolve ? (
        <ResolveRun runId={run.id} heldCount={held.length} />
      ) : (
        <p className="text-xs text-muted-foreground">An owner, an admin or someone with Agents access resolves this run.</p>
      )}
    </article>
  );
}
```

```tsx
// src/app/portal/agents/runs/page.tsx
import { redirect } from "next/navigation";
import { Hand } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { agentCan } from "@/server/modules/agents/access";
import { countNeedsHuman, listRunsFeed, needsHumanQueue } from "@/server/modules/agents/queries";
import { PRODUCT_LABEL, RUN_STATUSES, STATUS_LABEL, isRunStatus } from "@/lib/agent-labels";
import { PageHeader } from "@/components/portal/ui";
import { AgentTabs } from "@/components/portal/agents/agent-tabs";
import { AutoRefresh } from "@/components/portal/agents/auto-refresh";
import { FilterChips } from "@/components/portal/agents/filter-chips";
import { hrefWith } from "@/components/portal/agents/href";
import { NeedsHumanCard } from "@/components/portal/agents/needs-human-card";
import { Pagination } from "@/components/portal/agents/pagination";
import { RunList } from "@/components/portal/agents/run-list";

export const metadata = { title: "Agent runs" };
// Apply runs the deal's stage automations inside this page's server action.
export const maxDuration = 300;

export default async function AgentRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; product?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (!agentCan(user, "read")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const status = isRunStatus(sp.status) ? sp.status : null;
  // A run always happened in one workspace, so "Both" is not a filter here.
  const product = sp.product === "roofing" || sp.product === "solar" ? sp.product : null;
  const current = { status, product };

  const [queue, waiting, feed] = await Promise.all([
    needsHumanQueue(user),
    countNeedsHuman(user),
    listRunsFeed(user, { status, product, page: Number(sp.page) || 1 }),
  ]);
  const canResolve = agentCan(user, "approve");
  const inFlight = feed.runs.some((r) => r.status === "queued" || r.status === "running");

  return (
    <div className="space-y-6">
      <AutoRefresh active={inFlight} />
      <PageHeader title="Agents" description="Every run across the agents you can see. Anything waiting on a person comes first." />
      <AgentTabs active="/portal/agents/runs" waiting={waiting} />

      <section aria-labelledby="needs-human" className="space-y-3">
        <h2 id="needs-human" className="flex items-center gap-2 font-semibold">
          <Hand className="size-4 text-muted-foreground" />
          Needs a human
          <span className="rounded-full border chip-warning px-2 py-0.5 text-[11px] font-semibold tabular-nums">{waiting}</span>
        </h2>
        {queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing is waiting on a person.
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {queue.map((run) => (
              <NeedsHumanCard key={run.id} run={run} canResolve={canResolve} />
            ))}
          </div>
        )}
        {waiting > queue.length && (
          <p className="text-xs text-muted-foreground">{`Showing the oldest ${queue.length} of ${waiting}.`}</p>
        )}
      </section>

      <section aria-labelledby="all-runs" className="space-y-3">
        <h2 id="all-runs" className="font-semibold">
          All runs
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <FilterChips
            label="Status"
            active={status}
            options={[{ value: null, label: "All" }, ...RUN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
            hrefFor={(value) => hrefWith("/portal/agents/runs", current, { status: value, page: null })}
          />
          <FilterChips
            label="Product"
            active={product}
            options={[
              { value: null, label: "All" },
              { value: "roofing", label: PRODUCT_LABEL.roofing },
              { value: "solar", label: PRODUCT_LABEL.solar },
            ]}
            hrefFor={(value) => hrefWith("/portal/agents/runs", current, { product: value, page: null })}
          />
        </div>
        <RunList
          runs={feed.runs}
          canResolve={canResolve}
          showAgent
          emptyText={status || product ? "No runs match these filters." : "No runs yet."}
        />
        <Pagination
          page={feed.page}
          pageCount={feed.pageCount}
          total={feed.total}
          noun="runs"
          hrefFor={(p) => hrefWith("/portal/agents/runs", current, { page: p === 1 ? null : p })}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the browser tests, the typecheck and lint**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm exec eslint src/components/portal/agents src/app/portal/agents; echo "eslint exit=$?"
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -12
```

Expected: `typecheck exit=0`; `eslint exit=0`; `6 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/components/portal/agents/needs-human-card.tsx src/app/portal/agents/runs/page.tsx e2e/agents.spec.ts
git commit -m "feat(agents): the Runs page, with the needs-a-human queue above the feed" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 23: The browser suites this work touches

No new code. This runs every spec whose screens this plan changed, and proves any failure outside `agents.spec.ts` was already failing before this branch.

**Files:** none, unless a failure is this plan's fault — then the fix and its commit name the spec.

- [ ] **Step 1: Run them**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
find . -maxdepth 1 -name '.next-e2e-3017' -mmin -10   # a path printed = someone else is on 3017 now; wait
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts e2e/deal-stage-actions.spec.ts e2e/automations.spec.ts e2e/payroll.spec.ts e2e/manager-team.spec.ts e2e/notifications.spec.ts e2e/pipeline-view.spec.ts e2e/row-scope.spec.ts 2>&1 | tail -40
```

Why these: `deal-stage-actions` (Advance now skips side-states), `automations` (stage automations fire from the extracted `stageEntryData`), `payroll` (Payment Issue sits inside the roofing payroll window), `manager-team` (the member page gained a card), `notifications` (two new events in the catalog), `pipeline-view` (three new roofing stages), `row-scope` (deal access is unchanged).

Expected: `agents.spec.ts` 6 passed. Record every other failure as `file:line`.

- [ ] **Step 2: For each failure outside `agents.spec.ts`, check it against `main`'s code**

The tree must be clean first — every task commits — and the baseline gets its own schema and build directory.

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git status --short                      # must print nothing
rm -rf .next-e2e-3017
git switch --detach c0a1a7e && pnpm exec prisma generate
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents_base" \
  pnpm exec playwright test e2e/payroll.spec.ts:68 2>&1 | tail -15      # substitute each recorded file:line
rm -rf .next-e2e-3017
git switch feat/agents-control-plane && pnpm exec prisma generate
pnpm exec tsx -e 'import { PrismaClient } from "@prisma/client"; new PrismaClient().agent.count().then((n) => { console.log("agents:", n); process.exit(0); })'
```

Expected: every failure from Step 1 also fails on `c0a1a7e`; the last line prints `agents:` and a number, not an error (the generated client is this branch's again). A spec that passes on `c0a1a7e` and fails here is this plan's bug: fix it, rerun Step 1, and commit the fix with the spec's name in the message.

---

## Task 24: Full verification, and the production-build check

**Files:** none tracked. A temporary `playwright.verify-agents.config.ts` is created and deleted.

- [ ] **Step 1: Static checks, unit and integration suites, schema drift**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm -s lint; echo "lint exit=$?"
pnpm test 2>&1 | tail -5
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" pnpm test:integration 2>&1 | tail -8
pnpm exec vitest run src/lib/__tests__/row-scope-boundary.test.ts src/lib/__tests__/export-route-guard.test.ts 2>&1 | tail -4
pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://anexa:anexa@127.0.0.1:5544/anexa_agents_shadow --exit-code; echo "drift exit=$?"
```

Expected:
- `typecheck exit=0`, `lint exit=0`.
- Unit: the Task 0 baseline plus 18 files and 108 tests (152 → 170 files, 2334 → 2442 tests). If the totals differ, reconcile them against each task's own expected count before going on.
- Integration: the Task 0 baseline plus 8 files and 66 tests, and no failure that was not in the baseline.
- Both CI guards pass: `resolveAgentRunAction` reaches `leadAccessible` with no allow-list entry, and the export-route guard is untouched (the cron route exports nothing).
- `drift exit=0`: the migrations produce exactly the schema.

- [ ] **Step 2: Build for production**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
find . -maxdepth 1 -name '.next-*' -type d      # delete any this worktree left behind: stale build dirs hide type errors
rm -rf .next-verify-agents
git status --short > "$TMPDIR/agents-before-build.txt"
NEXT_DIST_DIR=.next-verify-agents SOLAR_VERTICAL_ENABLED=1 pnpm exec next build > "$TMPDIR/agents-build.txt" 2>&1; echo "build exit=$?"
tail -40 "$TMPDIR/agents-build.txt"
git status --short | diff "$TMPDIR/agents-before-build.txt" -
```

Expected: `build exit=0`; the route list includes `/api/cron/agents`, `/portal/agents`, `/portal/agents/[id]`, `/portal/agents/new`, `/portal/agents/runs`; the final `diff` prints nothing. If `next-env.d.ts` or `tsconfig.json` shows up there, `git checkout -- next-env.d.ts tsconfig.json`.

- [ ] **Step 3: Start it**

Run in the background:

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
NEXT_DIST_DIR=.next-verify-agents SOLAR_VERTICAL_ENABLED=1 CRON_SECRET=agents-verify AUTH_TRUST_HOST=true \
  pnpm exec next start -p 3318
```

Then wait until it answers:

```bash
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3318/login)" = "200" ]; do sleep 2; done; echo up
```

Expected: `up`.

- [ ] **Step 4: Run now through the production server**

The Hello Agent is still disabled in `agents_dev`, which is what this browser test expects.

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
cat > playwright.verify-agents.config.ts <<'TS'
// Temporary: points e2e/agents.spec.ts at the production build on 3318. Deleted in Step 8.
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3318", headless: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
TS
pnpm exec playwright test -c playwright.verify-agents.config.ts e2e/agents.spec.ts -g "an admin runs the disabled Hello Agent" 2>&1 | tail -8
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -qAt -c "SET search_path TO agents_dev; SELECT r.vertical, r.status, r.trigger, r.summary FROM agent_runs r JOIN agents a ON a.id = r.\"agentId\" WHERE a.name = 'Hello Agent' AND r.trigger = 'manual' AND r.\"createdAt\" > now() - interval '5 minutes' ORDER BY r.\"createdAt\" DESC;"
```

Expected: `1 passed`; two rows, `roofing|success|manual|Said hello` and `solar|success|manual|Said hello` (in either order). That is `after()` finishing a run on a real production server.

- [ ] **Step 5: The cron route refuses strangers**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3318/api/cron/agents
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong" http://localhost:3318/api/cron/agents
```

Expected: `401` twice.

- [ ] **Step 6: A tick with one working agent, one broken one, and a manager with the switch**

```bash
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -v ON_ERROR_STOP=1 <<'SQL'
SET search_path TO agents_dev;
UPDATE users SET permissions = permissions || '{"Agent:read":true,"Agent:run":true,"Agent:approve":true}'::jsonb
 WHERE email = 'manager@anexahomes.com';
UPDATE agents SET enabled = true, schedule = '* * * * *', "nextRunAt" = now() - interval '1 minute'
 WHERE name = 'Hello Agent';
INSERT INTO agents (id, "companyId", name, description, "handlerKey", vertical, department, enabled, schedule,
                    "nextRunAt", "timeoutSeconds", config, "requiresHumanGate", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, id, 'Broken Probe', 'Verification only; deleted after.', 'bank.ntp_poll', NULL,
       'permit', true, '* * * * *', now() - interval '1 minute', 60, '{}'::jsonb, true, now(), now()
  FROM companies;
SQL
curl -s -H "Authorization: Bearer agents-verify" http://localhost:3318/api/cron/agents; echo
```

Expected: `{"ok":true,"reaped":0,"started":2,"missingHandler":2,"skippedInFlight":0,"results":[…two entries with "status":"success"…]}`.

- [ ] **Step 7: Check the runs, and that the alerts reached the right people**

```bash
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -qAt <<'SQL'
SET search_path TO agents_dev;
SELECT a.name, r.vertical, r.status, r.trigger, CASE WHEN r.status = 'failed' THEN left(coalesce(r.error, r.summary), 24) ELSE r.summary END
  FROM agent_runs r JOIN agents a ON a.id = r."agentId"
 WHERE r.trigger = 'scheduled' ORDER BY 1, 2;
SELECT u.email, n.title, count(*)
  FROM notifications n JOIN users u ON u.id = n."userId"
 WHERE n.event = 'agent_run_failed' GROUP BY 1, 2 ORDER BY 1;
SQL
```

Expected, first query:

```
Broken Probe|roofing|failed|scheduled|No handler is registered
Broken Probe|solar|failed|scheduled|No handler is registered
Hello Agent|roofing|success|scheduled|Said hello
Hello Agent|solar|success|scheduled|Said hello
```

Second query:

```
admin@anexahomes.com|Agent failed: Broken Probe|2
manager@anexahomes.com|Agent failed: Broken Probe|2
owner@anexahomes.com|Agent failed: Broken Probe|2
```

`pm@anexahomes.com` — also a manager, without the switch — must not appear. Two alerts each, one per workspace, is the proof that matters: notification rules are workspace-scoped, so they could only have matched inside `runInVertical`, on a production build.

- [ ] **Step 8: Put everything back**

Stop the `next start` process, then:

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
psql "postgresql://anexa:anexa@127.0.0.1:5544/anexa" -v ON_ERROR_STOP=1 <<'SQL'
SET search_path TO agents_dev;
DELETE FROM notifications WHERE event::text LIKE 'agent%';
DELETE FROM agent_runs WHERE "agentId" IN (SELECT id FROM agents WHERE name IN ('Broken Probe', 'Hello Agent'));
DELETE FROM agents WHERE name = 'Broken Probe';
UPDATE agents SET enabled = false, schedule = NULL, "nextRunAt" = NULL WHERE name = 'Hello Agent';
UPDATE users SET permissions = permissions - 'Agent:read' - 'Agent:run' - 'Agent:approve' WHERE email = 'manager@anexahomes.com';
SQL
rm -rf .next-verify-agents playwright.verify-agents.config.ts
git status --short
```

Expected: the SQL succeeds; `git status --short` prints nothing.

---

## Task 25: Ship

Deploying is a standing instruction for this repository: verified work is pushed to `origin/main`, and Vercel deploys it. The production build applies the three migrations before `next build` runs, so **a failed build has still changed production's database**. All three are additive.

- [ ] **Step 1: See what `main` did while this was built**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git status --short                      # must print nothing
git fetch origin
git log --oneline HEAD..origin/main | head -40
```

- [ ] **Step 2: Stop if the sibling payroll work, or new stage migrations, reached `main`**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git grep -n "solarStageRequirementError" origin/main -- src | head -3
git ls-tree -r --name-only origin/main -- src/server/modules/pipeline/stage-entry-data.ts
for f in $(git diff --name-only --diff-filter=AM c0a1a7e origin/main -- prisma/migrations); do git show "origin/main:$f" | grep -q pipeline_stages && echo "$f"; done
```

Expected: all three print nothing.

If any prints something, **stop and tell the user**, quoting what printed:
- `solarStageRequirementError` on `main`: the spec's merge-time check applies. The applier must call it before applying, with a failing check becoming a `held` change.
- `stage-entry-data.ts` on `main`: Task 7's extraction collides with it, and the two copies must become one.
- A new migration touching `pipeline_stages`: the positions `20260915120100_action_required_stages` inserts at, and its itest fixture, must be re-checked against it.

- [ ] **Step 3: Rebase**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git rebase origin/main
```

On a conflict in `pnpm-lock.yaml`, take `main`'s and regenerate it:

```bash
git show origin/main:pnpm-lock.yaml > pnpm-lock.yaml && pnpm install --lockfile-only && git add pnpm-lock.yaml && git rebase --continue
```

On any other conflict (`package.json`, `vercel.json`, `src/lib/nav.ts`, `src/server/rbac/matrix.ts`, the seeds), keep both sides' additions, `git add` that path, and `git rebase --continue`.

- [ ] **Step 4: Verify again on top of `main`**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy 2>&1 | tail -2
pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://anexa:anexa@127.0.0.1:5544/anexa_agents_shadow --exit-code; echo "drift exit=$?"
pnpm -s typecheck; echo "typecheck exit=$?"
pnpm -s lint; echo "lint exit=$?"
pnpm test 2>&1 | tail -4
VERTICAL_TEST_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=vertical_test_agents" pnpm test:integration 2>&1 | tail -6
E2E_PORT=3017 E2E_DATABASE_URL="postgresql://anexa:anexa@127.0.0.1:5544/anexa?schema=e2e_agents" \
  pnpm exec playwright test e2e/agents.spec.ts 2>&1 | tail -8
```

Expected: `drift exit=0`, `typecheck exit=0`, `lint exit=0`; unit and integration at their Task 24 counts plus whatever `main` added; `6 passed`. If `main` brought more than a handful of commits, run Task 24 Steps 2–8 again as well.

- [ ] **Step 5: Look at exactly what is about to ship**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD | tail -3
```

Expected: every commit is one of this plan's. A commit you cannot name a reason for means stop.

- [ ] **Step 6: Push**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git push origin HEAD:main
```

A rejection means someone pushed in the meantime: go back to Step 1.

- [ ] **Step 7: Watch the deployment until it is Ready**

Vercel is linked in the main checkout. These commands only read, and change nothing there.

```bash
cd "/Users/mustafajoulani/Desktop/Anexa Homes /anexa-homes"
npx vercel ls 2>&1 | head -6
```

Repeat about once a minute until the newest Production row reads `● Ready`.
- `● Error` in under about 30 seconds, dying at the migrate step: a database blip. Run `npx vercel inspect <that url> --logs` to confirm, then `npx vercel redeploy <that url>`.
- Any other `● Error`: the migrations have already been applied and the previous deployment is serving code that predates them. They are additive, so nothing is broken, but fix forward now. Never run `vercel --prod`.

- [ ] **Step 8: Read-only checks against production**

```bash
cd "/Users/mustafajoulani/Desktop/Anexa Homes /anexa-homes"
ENVF=$(mktemp -t agents-prod-env)
npx vercel env pull "$ENVF" --environment=production --yes > /dev/null
RAW=$(grep '^DATABASE_URL=' "$ENVF" | cut -d= -f2- | tr -d '"')
rm -f "$ENVF"
BASE=$(echo "$RAW" | sed -E 's/:6543/:5432/; s#\?.*$##'); PGURL="${BASE}?sslmode=require"
psql "$PGURL" -qAt -v ON_ERROR_STOP=1 <<'SQL'
SET default_transaction_read_only = on;
SELECT migration_name, finished_at IS NOT NULL FROM _prisma_migrations WHERE migration_name LIKE '20260915120%' ORDER BY 1;
SELECT (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM agents WHERE name = 'Hello Agent') AS hello_agents;
SELECT vertical, event, count(*) FROM notification_rules WHERE event::text LIKE 'agent%' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT p.industry, count(*) FROM pipeline_stages s JOIN pipelines p ON p.id = s."pipelineId" WHERE s."isActionRequired" GROUP BY 1 ORDER BY 1;
SELECT s.position, s.key, s.name, s."isActionRequired"
  FROM pipeline_stages s JOIN pipelines p ON p.id = s."pipelineId"
 WHERE p.industry = 'roofing' ORDER BY p.id, s.position;
SQL
unset RAW BASE PGURL
```

Expected:
- the three `20260915120…` migrations, each `t`;
- `hello_agents` equals `companies`;
- `roofing` and `solar` rows for both agent events, each count equal to `companies`;
- action-required stages: `roofing` 4 and `solar` 6 for the single production company;
- the roofing list reads 25 stages, with `claim_denied` straight after `adjuster_meeting_complete_16`, `qc_failed` straight after `qc_inspection`, `payment_issue` straight after `depreciation_requested`, and `supplement_needed` flagged.

- [ ] **Step 9: The cron route is live and locked**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://anexahomes.com/api/cron/agents
```

Expected: `401`. In the Vercel dashboard (project → Logs, filtered on `/api/cron/agents`), a `200` appears within two minutes, then every minute after.

- [ ] **Step 10: Hand the success test to the user**

Ask the user to sign in to production as the owner, open **Agents → Hello Agent**, press **Run now**, and confirm **Run anyway**. Then read back what happened:

```bash
cd "/Users/mustafajoulani/Desktop/Anexa Homes /anexa-homes"
ENVF=$(mktemp -t agents-prod-env)
npx vercel env pull "$ENVF" --environment=production --yes > /dev/null
RAW=$(grep '^DATABASE_URL=' "$ENVF" | cut -d= -f2- | tr -d '"'); rm -f "$ENVF"
PGURL="$(echo "$RAW" | sed -E 's/:6543/:5432/; s#\?.*$##')?sslmode=require"
psql "$PGURL" -qAt -c "SET default_transaction_read_only = on; SELECT r.vertical, r.status, r.trigger, r.summary FROM agent_runs r JOIN agents a ON a.id = r.\"agentId\" WHERE a.name = 'Hello Agent' ORDER BY r.\"createdAt\" DESC LIMIT 2;"
unset RAW PGURL
```

Expected: `roofing|success|manual|Said hello` and `solar|success|manual|Said hello`. That is the spec's success test, in production.

---

## What this plan assumes

- **Advance (spec decision 13, confirmed):** Task 8 changes Advance and the progress count to main-line stages in both verticals, including Solar's Advance.
- **Open question 3 is not decided, and this plan decides nothing about it.** The build ships the behaviour the spec describes as interim: a manager with Agents access reads every run in their workspaces, can Close any held change, and is refused Apply on a deal outside their team. Task 18's `actions.itest.ts` pins that refusal so any change to it is deliberate. No agent in this plan requests changes, so nothing is held until a real gated agent exists.
- **Open question 1 (portal credentials) stays a blocker** for the first real portal agent. `deps.secrets` resolves only `env:AGENT_*` and `lender:<id>`.
- **Merge risk:** the unmerged `feat/solar-commission-payroll` work touches the same stage-move code and may add stage migrations. Task 25 Step 2 stops the push if any of it has reached `main`.
