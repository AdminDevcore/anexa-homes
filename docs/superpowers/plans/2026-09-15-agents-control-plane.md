# Agents Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Agents control plane — `agents` + `agent_runs`, a handler registry, a per-minute cron runner with a human gate and a reaper, three portal pages, the per-person Agents access switch, a Hello stub agent — plus the approved action-required stage changes, all on `main`.

**Architecture:** Pure, unit-tested modules (schedule, gate, budget, validation, access) sit under `src/server/modules/agents/`. The runner composes them with Prisma, executing each handler inside `runInVertical` and applying the stage changes a handler returns through one applier that mirrors `moveLeadStage`. A Vercel Cron route drives `tick()`; Run now drives the same `executeRun()` through `after()`. Pages are server components reading `queries.ts`; the interactive pieces are small client components calling `"use server"` actions.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 6 on Postgres, zod v3, Vitest (unit + integration), Playwright, Tailwind v4 with the existing shadcn and settings-kit components, `croner` 10.0.1 for cron expressions.

**Spec:** `docs/superpowers/specs/2026-09-15-agents-control-plane-design.md`

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
| `timeout.ts` | `withTimeout` — race a handler against a deadline, abort on expiry. |
| `verticals.ts` | Which workspaces an agent runs in, and who can see it. |
| `access.ts` | `agentCan`, `canEditAgentConfig`, the switch's permission keys. |
| `validate-agent.ts` | Form values ↔ validated agent row. |
| `labels.ts` | Human labels and chip tones. Client-safe. |
| `deal-label.ts` | "Name · address" for a deal. |
| `secrets.ts` | Resolve `env:AGENT_*` / `lender:<id>` references. |
| `deps.ts` | Build the real `AgentDeps` for a run. |
| `apply-changes.ts` | Resolve requested changes; move a deal the way `moveLeadStage` does. |
| `notify.ts` | Fire `agent_run_failed` / `agent_needs_human` inside the run's workspace. |
| `runner.ts` | `createRun`, `hasRunInFlight`, `writeMissingHandlerRun`, `executeRun`. |
| `reaper.ts` | `reapStuckRuns`. |
| `tick.ts` | `tick` — reap, start stale queued, claim due, execute concurrently. |
| `handler-check.ts` | Pure check used by the build script. |
| `queries.ts` | Page reads: agents, runs, the needs-a-human queue. |
| `actions.ts` | `"use server"`: create, update, enable, run now, resolve. |

**Created — elsewhere**

| File | Responsibility |
|---|---|
| `src/server/modules/pipeline/stage-entry-data.ts` | `stageEntryData`, moved out of `leads/actions.ts`. |
| `src/lib/stage-progress.ts` | Main-line progress and the next stage Advance offers. |
| `src/app/api/cron/agents/route.ts` | The per-minute cron entry point. |
| `scripts/check-agent-handlers.ts` | Production build check for enabled agents with no handler. |
| `src/app/portal/agents/page.tsx` | Agents list. |
| `src/app/portal/agents/new/page.tsx` | Create an agent. |
| `src/app/portal/agents/[id]/page.tsx` | Agent detail: config + run history. |
| `src/app/portal/agents/runs/page.tsx` | Global run feed with the needs-a-human queue first. |
| `src/components/portal/agents/*.tsx` | Tabs, status pill, filter chips, auto-refresh, enabled switch, run-now button, config form, run list, resolve controls, needs-a-human card, pagination, Agents access card. |
| `prisma/migrations/20260915120000_agents_control_plane/migration.sql` | Enums, tables, notification event values. |
| `prisma/migrations/20260915120100_agents_seed_rows/migration.sql` | Hello Agent + starter notification rules. |
| `prisma/migrations/20260915120200_action_required_stages/migration.sql` | Stage flags + three roofing stages. |
| `e2e/agents.spec.ts` | Browser coverage. |
| Tests under `src/server/modules/agents/__tests__/`, `src/lib/__tests__/stage-progress.test.ts`, `src/server/rbac/__tests__/agent-grants.test.ts`, `src/server/modules/pipeline/__tests__/action-required-stages.itest.ts` | As each task says. |

**Modified**

`prisma/schema.prisma` · `src/server/rbac/matrix.ts` · `src/lib/nav.ts` · `src/lib/stage-history.ts` · `src/components/portal/deal-stage-timeline.tsx` · `src/components/portal/deal-stage-bar.tsx` · `src/app/portal/leads/[id]/page.tsx` · `src/server/modules/leads/actions.ts` · `src/server/modules/notifications/{types,actions,engine}.ts` · `src/server/modules/team/actions.ts` · `src/app/portal/team/[id]/page.tsx` · `prisma/seed.ts` · `prisma/seed-clean.ts` · `vercel.json` · `package.json` · `pnpm-lock.yaml`

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

## Task 2: The handler contract, the Hello handler, the registry

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

## Task 3: Config guard, result validation, run detail

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

Expected: PASS (11 + 8 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/config-guard.ts src/server/modules/agents/result.ts src/server/modules/agents/detail.ts src/server/modules/agents/__tests__/config-guard.test.ts src/server/modules/agents/__tests__/result.test.ts
git commit -m "feat(agents): config holds references to secrets, and a handler's result is checked before it is believed" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Gate, budget, timeout, workspaces

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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("the cron route really declares the limit the budget assumes", () => {
    const route = readFileSync(join(__dirname, "../../../../app/api/cron/agents/route.ts"), "utf8");
    expect(route).toMatch(new RegExp(`export const maxDuration = ${CRON_MAX_DURATION_SECONDS};`));
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

Expected: FAIL — unresolved imports. (The route-file case keeps failing until Task 12 creates the route; that is expected and is the guard doing its job.)

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
  return records.map((c) =>
    c.outcome === "applied"
      ? { ...c, outcome: "discarded", note: "Not applied: another change in this run was invalid." }
      : c
  );
}

export function discardAll(changes: RequestedChange[], note: string): ChangeRecord[] {
  return changes.map((c) => ({
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
 * src/app/api/cron/agents/route.ts — a test reads the route file to make sure.
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

Expected: everything passes except `the cron route really declares the limit the budget assumes` (ENOENT until Task 12).

- [ ] **Step 7: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/modules/agents/gate.ts src/server/modules/agents/budget.ts src/server/modules/agents/timeout.ts src/server/modules/agents/verticals.ts src/server/modules/agents/__tests__/gate.test.ts src/server/modules/agents/__tests__/budget.test.ts
git commit -m "feat(agents): the gate, and a tick that cannot outlive its function" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: RBAC — the Agent resource and the access rules

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

In `GRANTS.super_admin`, after `Proposal: ALL,` add:

```ts
    Agent: ALL,
```

In `GRANTS.admin`, after `Proposal: ALL,` add:

```ts
    // No delete: nothing deletes an agent — disabling is how one is retired.
    Agent: ["create", "read", "update", "run", "approve"],
```

In `GRANTS.accounting`, after `Proposal: ["read"],` add:

```ts
    // Reads agents and their runs. Running and resolving belong to Operations.
    Agent: ["read"],
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

Expected: both new files PASS; the full suite is the Task 0 baseline plus the new tests, with only the one known route-file failure from Task 4.

- [ ] **Step 6: Commit**

```bash
cd /Users/mustafajoulani/Desktop/anexa-agents-wt
git add src/server/rbac/matrix.ts src/server/modules/agents/access.ts src/server/rbac/__tests__/agent-grants.test.ts src/server/modules/agents/__tests__/access.test.ts
git commit -m "feat(agents): an Agent resource — owners and admins edit, accounting reads, Operations by name" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

<!-- PLAN CONTINUES -->
