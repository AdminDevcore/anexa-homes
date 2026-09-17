# Agents: a control plane for back-office automation

Date: 2026-09-15
Status: approved 2026-09-15, with amendments (decisions 8–14). Open questions 1 and 3 are decided later and do not block this build.
Branch: `feat/agents-control-plane` (worktree `~/Desktop/anexa-agents-wt`, off `origin/main` at `c0a1a7e`)

## Problem

Permit, Operations and Accounting spend much of the day on narrow, repetitive
work against outside portals: submitting a design to the design partner,
submitting a job to a bank portal, checking back until a status changes, then
moving the deal. Each of those jobs will become an agent that does one thing on
a schedule.

Before any of them exists, the frame they plug into has to be solid: somewhere
to register an agent, a clock that runs it, a runner that records everything it
saw and did, a gate that stops it advancing a deal on its own when it should
not, and pages Operations can work from each morning.

This spec is that frame and nothing else. No portal automation, no browser
scripts, no model calls.

**Success test:** an Admin clicks **Run now** on the Hello Agent, a run appears,
it reads `success` with the summary "Said hello", and expanding it shows what
the runner recorded.

## Design principle

An agent is a **registry entry, not a page**. Adding one means:

1. one handler module in `src/server/modules/agents/handlers/`, with its key
   added to `handler-keys.ts` and `registry.ts`;
2. one row in `agents`, created from the Agents page.

No new UI, route, cron entry or migration per agent.

## What this builds on

Verified against `origin/main` and against production on 2026-09-15.

- **A deal is a `Lead`** (`leads`). Its stage is `Lead.stageId` →
  `PipelineStage`, a per-company, per-workspace editable list with a `key` that
  is unique and stable within its pipeline. `Project` is 1:1 with `Lead` and
  carries production status.
- **A person's stage move** is `moveLeadStage`
  (`src/server/modules/leads/actions.ts`): company stage lookup →
  `lead.update(stageEntryData(stage))` → `recordStageEntry` (the deal timeline)
  → activity log → `fireEvent("stage_changed")` →
  `runAutomations("stage_entered")`. `stageEntryData` is a private function in
  that `"use server"` file. **There is no stage-requirement check on `main`.**
- **The deal page's Advance button** (`src/components/portal/deal-stage-bar.tsx`)
  offers the next stage that is not `isLost`. It knows nothing about
  action-required side-states.
- **Workspace isolation** is a Prisma extension (`src/server/vertical/`).
  `Lead`, `Project`, `Pipeline` and `NotificationRule` are scoped; code that
  touches them needs an active workspace, established with `runInVertical`.
- **RBAC** is `role → resource → verbs` in `src/server/rbac/matrix.ts`, checked
  with `can()` / `requireCan()`. `User.permissions` (`{"Resource:action":
  bool}`) overrides the role inside `can()` and is re-read on every request,
  but nothing in the app writes it today.
- **Sidebar** items (`src/lib/nav.ts`) name a resource; `portal/layout.tsx`
  shows an item when `can(user, "read", resource)` and, where the item sets
  `roles`, the user's role is listed.
- **Scheduling** is Vercel Cron only: ten GET routes under
  `src/app/api/cron/*`, authorised by `assertCronRequest` (`CRON_SECRET`, fails
  closed). There is no queue, lock, retry or cron-expression parser.
- **Secrets.** Company-wide keys are Vercel env vars. Per-tenant secrets are
  AES-256-GCM columns via `encryptField` / `decryptField`
  (`src/server/lib/crypto.ts`), e.g. `SolarLender.apiKeyEncrypted`.
  `CompanySettings.bookkeepingApiKey` is stored in **plaintext**
  (`src/server/modules/bookkeeping/actions.ts:305`) — a pattern this work must
  not copy.
- **The Automation rules engine** (`src/server/modules/automations/`) is the
  nearest relative: settings-driven "when X happens, do Y" rules with an
  `AutomationRun` log. Agents stay separate — they are code against external
  systems, on a clock, behind a human gate — but reuse the stage-move steps and
  the failure-notification pattern.
- **Notifications** reach people only through `NotificationRule` rows, which are
  workspace-scoped. `fireEvent` returns early when no rule matches, and
  swallows every error it hits.

## Decisions

| # | Decision |
|---|---|
| 1 | Operations access is a per-person **Agents access** switch on Team → member, set by the owner (`super_admin`) only. It grants `read`, `run` and `approve` on `Agent` — never `create` or `update`. Editing agent config stays with `super_admin` and `admin`, on the same principle that keeps sales managers out of design and document templates. |
| 2 | "Needs attention" means `PipelineStage.isActionRequired`. A gated agent may move a deal only into a stage flagged that way. |
| 3 | A missing handler fails the production build, is refused on save, and writes a `failed` run whenever the broken agent comes due or is run. The app never checks handlers at boot and never crashes on one. |
| 4 | Accounting holds `read` on agents and runs. No run, no resolve. |
| 5 | Existing theme tokens and `chip-*` tone classes. No brand hex literals. |
| 6 | Built in a worktree off `origin/main`. The uncommitted work on `feat/solar-commission-payroll` is not touched. |
| 7 | Schedules are 5-field cron expressions evaluated in UTC, like `vercel.json`. The UI shows upcoming runs in the viewer's local time. |
| 8 | Failure and needs-a-human notifications go to `super_admin`, `admin`, **and everyone holding the Agents access switch** — they work the queue. |
| 9 | Execution inside a tick is concurrent, capped at 5 runs, and bound to a hard deadline, so a tick cannot outlive the cron function's 300-second limit (see Tick budget). |
| 10 | Run now on a disabled agent stays, behind a confirmation prompt that the server enforces too. |
| 11 | Stage flags: Solar's six "Action Required" stages are flagged; Roofing's Supplement Needed is flagged; three new roofing action-required stages are added — Claim Denied, QC Failed, Payment Issue. Nothing waiting on a carrier or homeowner, and nothing on the forward path, is flagged. |
| 12 | Built on `main` as it stands: with no stage-requirement check there, the gate has no "blocked" outcome. |
| 13 | Advance and the progress count use main-line stages only — not `isLost`, not `isActionRequired` — in both Roofing and Solar, including the change to Solar's Advance. Side-states stay reachable from the Move menu. Confirmed 2026-09-15. |
| 14 | Two deploys. First the agents control plane, the Hello Agent and the Advance change (invisible while production has no action-required stage). Then the stage migration alone, after the roofing and solar teams have been told. Open question 3: option A approved as the stopgap. Decided at build approval, 2026-09-15. |

## Data model

Two tables and four enums, all additive. Names follow the repo: camelCase
fields, snake_case table names.

```prisma
enum AgentDepartment    { permit operations accounting sales_escalation }
enum AgentRunTrigger    { scheduled manual event }
enum AgentRunStatus     { queued running success failed needs_human }
enum AgentRunResolution { applied closed }

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

Back-relations are added on `Company`, `User` (three named relations) and `Lead`.

### One run in flight

At most one `queued` or `running` run per agent per workspace. The partial
unique index `agent_runs_one_in_flight` on `("agentId", "vertical") WHERE status
IN ('queued', 'running')` enforces this. It is written by hand in the migration,
because Prisma 6 cannot declare it and `migrate diff` ignores it. `createRun`
returns `null` when the index refuses. Without it, a tick and a Run now could
both pass the in-flight check and move the same deals twice: history,
notifications and stage automations, all doubled. `agent_runs` is also indexed
on `leadId`, so a deleted deal does not scan the table. *(Amended after the
Task 2 review.)*

### Where this differs from the original brief

- `deal_id` → `leadId`, because a deal is a `Lead`.
- `product` → `vertical`, the enum the rest of the app uses; the UI calls it
  Product and offers Roofing, Solar or Both.
- Added `companyId` (every table is per-tenant), `nextRunAt` (makes "due" an
  indexed lookup and gives the tick a race-free claim), `timeoutSeconds`,
  `leadLabel`, `AgentRun.vertical`, `triggeredById`, `updatedById`, and the
  resolution fields.

### Isolation class: shared

Neither model is registered in `src/server/vertical/models.ts`. The Runs page
is one queue across Roofing and Solar, and the tick needs one pass over every
agent. Instead:

- pages filter to the workspaces the viewer holds (`userVerticals(user)`):
  agents whose `vertical` is NULL or held, runs whose `vertical` is held;
- every handler executes inside `runInVertical(run.vertical)`, so each deal
  query a handler makes is isolated like the rest of the app.

### The `detail` layout

Keys the runner writes sit at the top level; whatever the handler returns sits
under `handler`.

```jsonc
{
  "handlerKey": "system.hello",
  "configSnapshot": {},           // config as it was for THIS run
  "gated": true,
  "durationMs": 14,
  "log": ["hello"],
  "handler": { "greeting": "hello", "at": "2026-09-15T14:00:00.000Z" },
  "changes": [{
    "type": "move_stage",
    "leadId": "…",
    "toStageKey": "ntp_action_required_10",
    "reason": "Bank portal shows a stipulation on the NTP",
    "dealLabel": "Maria Lopez · 12 Elm St, Dallas",
    "fromStage": { "id": "…", "key": "ntp_submitted_9", "name": "NTP Submitted" },
    "toStage": { "id": "…", "key": "ntp_action_required_10", "name": "NTP Action Required", "isActionRequired": true, "position": 3, "defaultBlocker": null, "stageType": "internally_owned" },
    "outcome": "applied",         // applied | noop | held | discarded | invalid
    "note": null
  }],
  "resolution": null,             // what Apply did, once a human resolved the run
  "lateResult": null              // a result that arrived after the run was reaped
}
```

## Handler contract

Files live under `src/server/modules/agents/`.

```ts
// handler-keys.ts — no imports; the build check reads this file alone
export const HANDLER_KEYS = ["system.hello"] as const;
export type HandlerKey = (typeof HANDLER_KEYS)[number];

// types.ts
export type AgentHandler<C = unknown> = {
  key: HandlerKey;
  /** Shown in the handler picker. */
  label: string;
  /** Validates Agent.config. Runs on save, and again before every run. */
  parseConfig(raw: unknown): { ok: true; config: C } | { ok: false; error: string };
  run(ctx: AgentContext<C>): Promise<AgentResult>;
};

export type AgentContext<C> = {
  companyId: string;
  vertical: "roofing" | "solar";
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

/** Every door to the outside world. Tests pass fakes; portal clients join here later. */
export type AgentDeps = {
  now(): Date;
  secrets: { get(ref: string): Promise<string | null> };
  deals: {
    get(leadId: string): Promise<DealSnapshot | null>;
    inStages(stageKeys: string[], opts?: { limit?: number }): Promise<DealSnapshot[]>;
  };
};

export type DealSnapshot = {
  id: string;
  /** Customer name and address. */
  label: string;
  stageKey: string | null;
  stageName: string | null;
  stageChangedAt: Date | null;
};

export type AgentResult = {
  status: "success" | "failed" | "needs_human";
  /** One line, e.g. "Submitted NTP for deal 4821". Truncated to 280 characters. */
  summary: string;
  detail?: Record<string, unknown>;
  changes?: RequestedChange[];
  error?: string;
};

export type RequestedChange = {
  type: "move_stage";
  leadId: string;
  /** A key in the deal's OWN pipeline, so a roofing key can never move a solar deal. */
  toStageKey: string;
  reason: string;
};

// registry.ts
export const HANDLERS = {
  "system.hello": systemHelloHandler,
} satisfies Record<HandlerKey, AgentHandler>;
```

Rules:

- **Handlers never write.** `deps.deals` is read-only, and handlers return the
  changes they want. A guard test (`__tests__/handler-purity.test.ts`) fails
  when a file under `handlers/` imports `@/server/db/client`, a runtime value
  from `@prisma/client`, or `next/*`.
- **The key list and the registry cannot drift.** `satisfies Record<HandlerKey,
  …>` makes the type check inside `next build` fail on a key with no handler or
  a handler with no key.
- **Results are validated.** The runner parses every result with zod; a
  malformed result fails the run.
- `RequestedChange` is a union with one member today. A second change type is
  one new variant plus its branch in the applier.

### Secret references

`deps.secrets.get(ref)` accepts exactly two forms today:

- `env:AGENT_<NAME>` — an env var whose name starts with `AGENT_`. The prefix
  stops a config from pointing a handler at `AUTH_SECRET` or `CRON_SECRET`.
- `lender:<uuid>` — that lender's decrypted `apiKeyEncrypted`, only when the
  lender belongs to the run's company.

Saving a config is refused when any key, at any depth, names a secret (the
words `password`, `passwd`, `passcode`, `secret`, `token`, `api key`,
`credential(s)`, `otp`, `totp`, `mfa`, matched as whole words inside camelCase
or snake_case keys) unless the key ends in `Ref` and its value is a valid
reference. Portal logins have no form yet — see Open question 1.

## Runner

### The tick

`vercel.json` gains `{ "path": "/api/cron/agents", "schedule": "* * * * *" }`.
The route authorises with `assertCronRequest`, sets `maxDuration = 300`, and
calls `tick(now)`:

1. **Reap** stuck runs (see The reaper).
2. **Start stale queued runs**: manual runs still `queued` 30 seconds after
   creation, in case `after()` never ran them. They count toward the cap.
3. **Find due agents**: `enabled` and `nextRunAt <= now`, oldest first.
4. **Claim** each one with a compare-and-set, and only if every workspace it
   will run in still fits under the cap:
   `updateMany({ where: { id, enabled: true, nextRunAt: <value read> }, data: { nextRunAt: <next after now> } })`.
   A count of 0 means another tick claimed it, so skip. No locks table and no
   raw SQL (raw SQL is lint-banned in this repo).
5. **For each workspace** — `[agent.vertical]`, or for a "both" agent every
   live workspace (Solar only when `SOLAR_VERTICAL_ENABLED` is on):
   - if a run for this agent and workspace is already `queued` or `running`,
     skip; that run is the record. The check is only the polite path. The
     partial unique index `agent_runs_one_in_flight` is what holds when a tick
     and Run now race, so a refused create is also a skip;
   - if the handler is missing, write a `failed` run immediately — `No handler
     is registered for "bank.ntp_poll". Deploy the handler or disable this
     agent.` — and notify;
   - otherwise create the run as `running` with `startedAt`.
6. Execute every started run **concurrently** (`Promise.allSettled`) and await
   them all.

### Tick budget

The cron function stops at 300 seconds. Execution is concurrent, never
sequential, and three limits keep a tick inside that:

| Limit | Value | Why |
|---|---|---|
| Runs started per tick | 5 (stale queued included) | The runtime pool is `connection_limit=10`; five concurrent runs leave headroom. |
| Handler deadline | `min(timeoutSeconds, 240 s − time since the tick started)` | Every handler has finished or been aborted by 240 s. A run with under 5 s left is not started. |
| Apply deadline | 285 s after the tick started | Changes are applied only before this. A run that reaches it is finalised `failed` and its changes recorded as `discarded`. |

Worst case: handlers end by 240 s; applying changes, finalising and notifying
for at most five runs happens between 240 s and 285 s; 15 s of margin remain
under 300 s. Every limit is measured from the tick's own start, so time spent
reaping and claiming comes out of the budget rather than adding to it.

Run now uses the same limits, anchored at the click, inside `after()` on a page
that sets `maxDuration = 300`.

### `executeRun(runId)`

Shared by the tick and Run now. It knows nothing about Vercel, so a future
external worker can call it without schema changes. Such a worker has no 300 s
kill, and the reaper relies on that kill (see The reaper). A worker must impose
its own ceiling on a run, at most 300 s from `startedAt`, or the reaper's clock
must change with it. Otherwise a live run can be reaped mid-apply. What it did
would still be kept in `detail.lateResult`, but the run would read `failed`.

1. A run created `queued` (Run now) is flipped to `running` with a
   compare-and-set; lost the race → return. A run the tick created `running`
   is already owned.
2. Look up the handler. Missing → `failed`.
3. `parseConfig`. Invalid → `failed` with its message.
4. Inside `runInVertical(run.vertical)`: build `deps`, start an
   `AbortController`, race `handler.run(ctx)` against the handler deadline.
   - throws → `failed`, `error` = message and stack;
   - times out → abort the signal, `failed`, `Timed out after 60 s.`;
   - malformed result → `failed`.
5. Apply requested changes through the gate (next section), unless the handler
   itself returned `failed` — then nothing is applied and every change is
   recorded as `discarded`.
6. Final status, strongest wins: `failed` > `needs_human` > `success`.
7. Finalise with a compare-and-set on `status = running`. If the reaper got
   there first, the status stays `failed` and what came back is stored under
   `detail.lateResult`.
8. `failed` or `needs_human` → notify (see Notifications). Nothing is retried;
   a failure waits for a human.

### The reaper

At the start of every tick:

- a run `running` for longer than 300 s (the function limit) + 60 seconds →
  `failed`: `Reaped: still marked running N min past the 300 s limit on any
  run. The process running it stopped (deploy, crash or platform limit);
  nothing after the last log line is known to have happened.`

  The clock is the function limit, not the agent's `timeoutSeconds`. Every run
  executes inside a function killed 300 s after it starts: the tick's start, or
  Run now's click, both at or before `startedAt`. A younger run may still be
  applying changes (until 285 s). Reaping it would record that nothing happened
  over deals that did move. `timeoutSeconds` can also be edited mid-run.
  *(Amended after the Task 2 review.)*
- a run `queued` for longer than 10 minutes → `failed`: `Never started.`

Both notify. No run can stay `running`.

### Run now

`runAgentNow(agentId, { confirmDisabled })`:

- needs `run` on `Agent`; the agent must be in the viewer's company and in a
  workspace they hold;
- **a disabled agent** is refused unless the request carries
  `confirmDisabled: true`. The button opens a confirmation first — "Run a
  disabled agent? This agent is turned off, possibly on purpose." — and only
  its **Run anyway** sends the flag, so a stale page or a direct call cannot
  skip the prompt;
- if the handler is missing, writes a `failed` run and returns its error;
- refuses while that agent already has a run in flight in a target workspace
  (a create the in-flight index refuses counts the same; runs created for the
  other workspaces still start);
- creates one `queued` run per target workspace (the agent's own, or for a
  "both" agent each live workspace the viewer holds) with `triggeredById`,
  hands them to `after(() => executeRun(...))`, and returns;
- the agent page refreshes every 3 seconds while any run on screen is `queued`
  or `running`.

`after()` runs within the page's `maxDuration` (Next 16 docs:
`01-app/03-api-reference/04-functions/after.md` and `maxDuration.md`, "set the
maxDuration at the page level to change the default timeout of all Server
Actions used on the page"). If `after()` is ever cut short, the tick's
stale-queued step picks the run up, and the reaper catches anything that dies
mid-flight.

## The gate

Every `move_stage` change is checked before **any** change is applied, so a run
never half-applies.

A run may move a deal only once. A second change for a deal the same run already named is `invalid`, so the run applies nothing, and every other change, held ones included, is recorded as `discarded`. *(Added after the Task 5 review.)*

1. **Resolve** the deal (in this company and workspace) and `toStageKey` inside
   the deal's own pipeline. Either not found → the change is `invalid`, the run
   is `failed`, and nothing in the run is applied (other changes are recorded
   as `discarded`).
2. **Decide** each change. This is a pure function, unit-tested as a table:

   | Deal already in target stage | Agent gated | Target `isActionRequired` | Outcome |
   |---|---|---|---|
   | yes | — | — | `noop` |
   | no | yes | no | `held` → run `needs_human` |
   | no | yes | yes | `applied` |
   | no | no | — | `applied` |

3. **Apply** each `applied` change with the steps a person's move takes:
   1. `lead.update({ data: stageEntryData(stage) })` — `stageEntryData` moves
      out of `leads/actions.ts` into `src/server/modules/pipeline/stage-entry-data.ts`
      so `moveLeadStage` and the applier share one copy;
   2. `recordStageEntry({ …, movedById: null, via: "agent" })` — `StageMoveVia`
      in `src/lib/stage-history.ts` gains `"agent"`, and the deal's Timeline tab
      reads "by an agent";
   3. activity log: `Agent "NTP Poller" moved the deal to NTP Action Required`;
   4. `fireEvent("stage_changed")`, so per-stage notifications fire exactly as
      they do on a person's move;
   5. after leaving the runner's workspace wrapper,
      `runAutomations({ trigger: "stage_entered", depth: 0 })`. The engine owns
      its workspace, and rules waiting at that stage still run.

   Agents are never triggered by automations, so this cannot loop.

**Merge-time check.** The unmerged `feat/solar-commission-payroll` branch adds
`solarStageRequirementError` and its own `stage-entry-data.ts`. If either
reaches `main` before this ships, the applier calls the requirement check
before applying, and a failing check becomes a `held` change with the reason in
its `note`.

### Main's rules on solar stage moves

*(Added 2026-09-15, after rebasing onto main. The user decided that agents obey both rules.)*

Main enforces two rules on every write that moves a solar deal, and agents follow them. Neither rule touches roofing deals.

- **Contract Signed** (`pipeline/contract-signed.ts`). No move to or past Contract Signed until the signed proposal and a completed contract are both on file.
  - A change that crosses the line without them is `invalid` at run time: the run fails and nothing in it applies.
  - Apply refuses the change too, whoever presses it.
- **M1 Funding** (`payroll/funding-authority.ts`). No move to or past M1 Funding before the rep's M1 milestone is certified, unless the mover may certify funding: owner, admin or accounting.
  - An agent holds no such authority. A change that would apply by itself is `invalid`.
  - A `held` change stays held. At Apply, the approving person's own authority decides, so a manager holding Agents access cannot carry the deal past the line.

The run-time check happens in `resolveChanges`, before anything applies, so a run never half-applies. `moveDeal` itself does not re-check.

Both checks use main's own rules from `pipeline/stage-guard.ts` and its parts:
- **At run time:** `contractSignedMoveError`, and `fundingGateError` with `actor: null`. An agent, like an automation rule, carries no one's authority. The two are asked separately because the gate treats them differently.
- **At Apply:** `stageMoveError`, with the approving person as `actor`.

`apply-changes.ts` writes deal stages, so main's CI test `stage-moves-guarded.test.ts` covers it. *(Revised after main's `d694e57`.)*

### Resolving a `needs_human` run

The queue is `status = needs_human AND resolvedAt IS NULL`. Resolving does not
change `status`, so the history still says a human was needed; it records who,
when, how and why.

`resolveRun(runId, { resolution, note })` needs `approve` on `Agent`.

- **Apply change** (offered only when the run has `held` changes). Every change
  is re-checked before any is applied:
  - the viewer can open the deal (`leadAccessible`);
  - the deal is still in the stage the agent saw — otherwise refused: `Maria
    Lopez · 12 Elm St has moved since the agent looked (now in Scope Received).
    Close this run instead.`

  Each change is then applied through the same steps with `movedById` = the
  resolver and no `via`, and the outcomes land in `detail.resolution`.
  `resolution = applied`.
- **Close without applying.** A note is required. `resolution = closed`. This
  is the only option for a run the handler itself marked `needs_human`.

A `manager` holding the Agents access switch is refused Apply on any deal
outside their team, and can still read and close the run. Whether that is
right is Open question 3.

## Registry integrity

Three checks. There is no boot check, and `instrumentation.ts` is untouched.

1. **Build.** `scripts/check-agent-handlers.ts` runs in the production build
   after `prisma generate`:

   ```
   node scripts/prod-migrate.mjs && prisma generate && tsx scripts/check-agent-handlers.ts && npm run copy-pdf-worker && next build
   ```

   It exits 0 unless `VERCEL_ENV=production`, the same rule as `prod-migrate`
   (previews never read the production database). It imports only
   `handler-keys.ts`, reads every enabled agent, and exits 1 listing
   `company / agent / handlerKey` for each unknown key. A failed build leaves
   the previous deployment serving. `tsx` sits in the same dependency block as
   `prisma`, which the build already runs, so it is installed at build time.
   `prod-migrate` has already applied migrations when this check runs, just as
   it has before today's type check.
2. **Save.** Creating an agent, changing its handler, or enabling it is refused
   for an unregistered key, and `parseConfig` must pass.
3. **Runtime.** A broken agent writes a `failed` run every time it comes due or
   is run, and the Agents list shows a `Handler missing` danger chip on its row.

## Permissions

### Matrix (`src/server/rbac/matrix.ts`)

`RESOURCES` gains `"Agent"`; `ACTIONS` gains `"run"`.

| Role | `Agent` verbs |
|---|---|
| `super_admin` | `manage` (everything) |
| `admin` | `create`, `read`, `update`, `run`, `approve` |
| `accounting` | `read` |
| `manager` | none by role; `read`, `run`, `approve` with the Agents access switch |
| `sales_rep`, `canvasser`, `marketing`, `installer` | none |

Nothing deletes an agent. Disabling is how one is retired.

### The Agents access switch

- A card on Team → member, rendered only when the viewer is `super_admin` and
  the member's role is `manager`. The owner and admins already hold more,
  accounting stays read-only (decision 4), and field and outside roles are
  refused.
- `setAgentsAccess(userId, on)`: `super_admin` only, same company, target role
  `manager`.
  - **On** writes `Agent:read`, `Agent:run` and `Agent:approve` = `true` into
    `User.permissions`, keeping any other keys.
  - **Off** deletes those three keys. It never writes `false`, which would
    override a role grant.
- It takes effect on the member's next request, because the session re-reads
  `permissions` every time.
- Changing a member's role away from `manager` clears the three keys, so the
  switch never follows someone into another job.

### Enforcement

One module, `src/server/modules/agents/access.ts`, used by every page and
action:

- `agentCan(user, "read" | "run" | "approve")` — the role grant, or for a
  `manager` the override keys. Overrides on any other role are ignored.
- `canEditAgentConfig(user)` — the role is `super_admin` or `admin`. **Role
  only; overrides are ignored**, so a hand-edited `Agent:update: true` can
  never become config access.

| Surface | Check |
|---|---|
| `/portal/agents`, `/portal/agents/[id]`, `/portal/agents/runs` | `agentCan(read)`, else redirect to the dashboard. An agent or run outside the viewer's workspaces is not found. |
| `/portal/agents/new`, create, update, enable toggle | `canEditAgentConfig` |
| Run now | `agentCan(run)` |
| Resolve | `agentCan(approve)`; Apply also checks `leadAccessible` for each deal (who should get past that check is Open question 3) |
| Agents access switch | `super_admin` only |
| `/api/cron/agents` | `CRON_SECRET` |
| Sidebar item | `resource: "Agent"`, `roles: ["super_admin", "admin", "accounting", "manager"]` — the same set `agentCan(read)` can allow |

`resolveRun` names `leadId`, so it must reach `leadAccessible`; that keeps
`row-scope-boundary.test.ts` green without an allow-list entry.

## UI

Existing tokens (`bg-card`, `border-border`, `text-muted-foreground` and the
rest), `chip-*` tone classes, the settings-kit form fields, and the existing
`PageHeader`, `EmptyState`, table, switch and alert-dialog components. No new
colours, fonts or layout primitives. Filters live in the URL and are read on the
server.

**Status pills:** `queued` neutral · `running` info · `success` good · `failed`
danger · `needs_human` warning, labelled "Needs a human".

**Sidebar.** **Agents** in the admin group, with two tabs: **Agents** and
**Runs** (the Runs tab carries a count of unresolved needs-a-human runs).

**Agents list** (`/portal/agents`)

- Table columns: name, with the description underneath · product (Roofing /
  Solar / Both) · department · schedule, in plain words with the cron
  underneath · enabled (a switch for editors, text for everyone else) · last
  run, as relative time · last run status pill.
- Filters: product, department.
- A **New agent** button for editors. A `Handler missing` chip on any row whose
  handler is not registered.

**Agent detail** (`/portal/agents/[id]`)

- Header: name, product, department, handler, a gate badge ("Human gate" or
  "Can advance deals"), enabled, and **Run now** for anyone holding `run` (with
  the disabled-agent confirmation).
- Config. Editors get a form: name, description, handler (a picker built from
  the registry), product, department, schedule (presets every 5, 15 or 30
  minutes, hourly, daily, weekdays, or a custom cron, with the next three runs
  shown), timeout, human gate, and config JSON (validated by `parseConfig` and
  the secret guard on save). Everyone else sees the same fields read-only.
- Run history, newest first, 25 per page. Each row expands to show:
  - the summary;
  - the trigger, and who pressed Run now;
  - started, finished and duration;
  - the requested changes as `from → to` with each outcome;
  - the handler's detail JSON, pretty-printed;
  - the log lines;
  - the error, in a monospace block;
  - for an unresolved `needs_human` run, **Apply change** and **Close without
    applying** (for anyone holding `approve`); for a resolved one, who resolved
    it, how, and their note.

**Runs** (`/portal/agents/runs`)

- **Needs a human** comes first, always: every unresolved `needs_human` run as
  a card, with a count. Each card shows the agent, a link to each deal, the
  summary, the held change in words ("Move Maria Lopez · 12 Elm St from NTP
  Submitted to NTP Approved"), and the resolve buttons.
- Below it, the feed of runs across every agent the viewer can see, newest
  first, 50 per page, filterable by status and product.

**Team → member.** The Agents access card: a switch and one line — "Can view
agents and runs, run an agent, and resolve runs that need a human. Cannot
create or edit agents."

## Notifications

- `NotificationEvent` gains `agent_run_failed` and `agent_needs_human`. Both
  join the Settings → Notifications catalog, with the tokens `{{agent}}`,
  `{{customer}}` and `{{status}}`, and link to `/portal/agents/runs`.
- A new dynamic recipient, **`agents_access`** ("People with Agents access"),
  resolves when the notification fires to every active `manager` whose
  `permissions` carry `Agent:approve`. Resolving at fire time means turning the
  switch on or off takes effect on the next alert, with no rule to edit.
- `fireEvent` delivers only to matching rules, so a data migration adds two
  starter rules per company per workspace: in-app, recipients `roles:
  ["super_admin", "admin"]` plus `dynamic: ["agents_access"]`.
- Events are fired inside `runInVertical(run.vertical)` — rules are
  workspace-scoped, and `fireEvent` swallows the missing-workspace error, so a
  call outside it would notify nobody and say nothing — through `await
  import()` inside try/catch, as the automations engine does: the run row is
  the business record and must survive the notifier failing to load.

## Stage flags and the Advance button

### Solar

Flag every solar stage whose name contains "Action Required" (matched by name,
because production's keys were generated by the stage builder). In production
that is exactly six: `ntp_action_required_10`, `design_action_required_13`,
`permit_action_required_15`, `inspection_action_required_21`,
`monitoring_action_required_29`, `interconnection_action_required_25`. Seeded
solar pipelines already flag their own redline and corrections stages.

### Roofing

- **Flag** `supplement_needed` (Supplement Needed).
- **Add** three action-required stages, each placed straight after the step it
  branches from, with later stages shifted down one position:

  | New stage | Key | Placed after (production) | Fallback anchor |
  |---|---|---|---|
  | Claim Denied — Action Required | `claim_denied` | Adjuster Meeting Complete (`adjuster_meeting_complete_16`) | Adjuster Meeting Scheduled (`adjuster_meeting`) |
  | QC Failed — Action Required | `qc_failed` | QC Inspection (`qc_inspection`) | — |
  | Payment Issue — Action Required | `payment_issue` | Depreciation Requested (`depreciation_requested`) | — |

  Colour rose `#E11D48`. The user chose it on 2026-09-15 because `#EF4444`, the
  colour of the solar action-required stages, is exactly roofing Cancelled's red.
  `internally_owned`, no SLA, no notification recipient. A pipeline
  missing an anchor is skipped for that stage; one that already has the key or
  name is left alone.
- **Not flagged:** Supplement Submitted, Invoice Sent, Depreciation Requested
  (waiting on the carrier or the homeowner), and every forward step.

Consequences, checked against the code on `main`:

- **Sale line** (at or past Contract Signed counts as sold): QC Failed and
  Payment Issue count as sold; Claim Denied does not.
- **Roofing payroll gate** (at or past Depreciation Requested,
  `payroll/gate.ts`): a deal in Payment Issue stays commission-eligible; Claim
  Denied and QC Failed are not eligible.
- **`isWon`** (Paid, Closed): unchanged.
- `prisma/seed.ts` and `prisma/seed-clean.ts` gain the same three stages and the
  Supplement Needed flag, so local, e2e and any new company match production.

### Advance skips action-required stages

Today Advance offers the next stage that is not Cancelled. With the new roofing
stages in line, Advance from Adjuster Meeting Complete would offer Claim Denied.
So Advance and the progress bar count only **main-line** stages — not `isLost`,
not `isActionRequired`:

- Advance offers the next main-line stage after the current one; from a
  side-state it offers the next main-line stage after that side-state.
- Progress ("step N of M") counts main-line stages only.
- Side-states stay reachable from the Move menu, and agents move deals into
  them.

This also changes Solar once its six stages are flagged: from NTP Submitted,
Advance offers NTP Approved rather than NTP Action Required. It ships one deploy
before the stage migration (decision 14): the production build applies
migrations before it compiles, so in a single deploy the old Advance would serve
beside the new stages for as long as the build ran. With no action-required
stage in production, the new Advance changes nothing until the migration lands.
Confirmed 2026-09-15 (decision 13).

## Migrations and rollout

Three migrations, because Postgres will not use an enum value inside the
transaction that adds it:

1. `agents_control_plane` — the four enums, both tables, indexes and foreign
   keys, and the two `NotificationEvent` values.
2. `agents_seed_rows` — the Hello Agent per company and the starter
   notification rules.
3. `action_required_stages` — the solar and roofing flags and the three new
   roofing stages.

1 and 2 ship with the agents build; 3 ships alone in a later deploy, once the
roofing and solar teams have been told (decision 14). Its folder is timestamped
after 2, so it sorts last. All are additive and ship through `prod-migrate`. One new
dependency, `croner` 10.0.1, parses and validates cron expressions. The
per-minute cron entry needs a Vercel plan that allows sub-daily crons; the
existing `*/15` entries show this project's plan does.

After pushing, confirm the production deployment reads `● Ready` in `vercel ls`
— a failed build still has its migrations applied.

## Stub agent

- `handlers/system-hello.ts`: key `system.hello`, label "Hello (test agent)",
  config must be `{}`. `run` calls `ctx.log("hello")` and returns
  `{ status: "success", summary: "Said hello", detail: { greeting: "hello", at: <now> } }`.
  It requests no changes.
- A data migration inserts one row per company: **Hello Agent** · "Test agent.
  Logs hello and records a successful run, proving the runner and run log work
  end to end." · `system.hello` · Both · Operations · disabled · no schedule ·
  gated · config `{}`. `prisma/seed.ts` creates the same row locally.
- Because it is disabled, Run now asks for confirmation first. It then writes
  one run per workspace the viewer holds, so the owner sees two runs: Roofing
  and Solar.

## Testing

**Unit (Vitest)**

- the gate decision table and final-status precedence;
- change planning: invalid deal, invalid stage, noop, held, applied;
- result validation;
- the secret-key guard and reference parsing (the `env:AGENT_` prefix, the
  lender reference shape, keys like `footprint` not mistaken for `otp`);
- schedule validation (5 fields only) and next-run computation;
- the tick budget: handler deadline and the not-started threshold;
- the handler purity guard, the registry/key agreement, and the build check
  against a fake agent list;
- matrix grants per role; `agentCan` with overrides: a manager with the switch
  (allowed), a rep with a stale override (denied), an `Agent:update` override
  (ignored); switch merge and delete semantics;
- Advance: next main-line stage, from a side-state, never Cancelled; progress
  counts main-line stages only.

**Integration (`.itest.ts`, real database, `can()` not mocked)**

- two concurrent ticks claim one due agent exactly once;
- run rows for success, a throw, a timeout, a malformed result and a missing
  handler;
- the reaper, for `running` and `queued` runs;
- a gated change held → Apply, including the moved-since refusal → Close;
- an ungated change applied, producing a `LeadStageEvent` with `via = "agent"`,
  an activity line and a fired `stage_entered` automation;
- notifications reach `super_admin`, `admin` and a manager with the switch, and
  not a manager without it;
- Run now on a disabled agent refused without `confirmDisabled`, allowed with
  it;
- the refusal matrix for every action: a manager without the switch, accounting
  trying to run and resolve, a manager with the switch trying to update;
- the stage migration against a copy of production's pipelines: six solar flags,
  Supplement Needed flagged, three roofing stages at the right positions, and a
  second run changes nothing.

**E2E (Playwright)**

- admin: Agents → Hello Agent → Run now → confirm → a `success` run reading
  "Said hello" appears and expands to its JSON;
- manager: no Agents item, and `/portal/agents` redirects;
- Runs: the Needs a human section renders, and the status filter works.

**Production-build check.** Workspace behaviour is verified on
`next build && next start`, not `next dev`, which loads the workspace context
twice and makes `runInVertical` silently no-op.

**After deploy.** Run now on the Hello Agent in production writes `success`
runs, the function log shows `/api/cron/agents` answering 200 every minute, and
a read-only query confirms the stage flags and the three new roofing stages.

## Out of scope

- Portal automation, browser scripts, model calls, and any real handler.
- Event-triggered runs. The `event` trigger value exists but nothing produces
  it; the first event-driven agent adds the hook, most likely beside the
  `runAutomations` call in `moveLeadStage`.
- A credential store (Open question 1).
- Retries, config version history, deleting agents.
- Splitting the `manager` role (see Known debt).

## Follow-up: run retention

Every run is kept, including runs that change nothing. A per-minute schedule
adds about 1,440 rows a day per workspace. The Hello Agent ships disabled and
unscheduled, so nothing accumulates from this build. A retention rule is needed
before the first agent on a frequent schedule: for example, delete successful
runs with no changes after N days, and keep failures, gated runs and anything
that moved a deal. *(Raised in the Task 2 review.)*

## Known debt: `manager` is overloaded

`manager` is two jobs at once:

- the **sales manager** — roofing commissions pay every active sales manager,
  and the matrix grants note that "sales managers can invite staff";
- the **solar coordinators** — `STAGE_OWNERS` in `src/lib/solar-pipeline.ts`
  maps Project Coordinator, Designer, Install Scheduler and QC Inspector to
  `manager` (Permitting and Interconnection Coordinator map to `admin`).

So no role-level rule can say "Operations yes, Sales Manager no", which is why
Operations access here is a per-person switch. Splitting the role is a future
task, not this one: pay, team and row-scope code all key off `manager` today.

## Open questions

### 1. Portal credential storage — BLOCKER for the first real portal agent

Portal agents will need a username, a password and some answer to MFA, per
company and per portal. There is nowhere to keep them today, and this spec
deliberately does not invent one. Decide before the first portal handler ships:

- **Storage.** Encrypted at rest and per company; a dedicated table referenced
  from config (e.g. `credential:<id>`) is the natural shape. **Never
  plaintext**, the way `CompanySettings.bookkeepingApiKey` is stored
  (`src/server/modules/bookkeeping/actions.ts:305`).
- **Key.** `encryptField` derives its key from `ONBOARDING_ENC_KEY` /
  `AUTH_SECRET`, and that derivation is load-bearing: rotating `AUTH_SECRET`
  silently orphans every stored secret. Decide whether portal credentials share
  that key or get their own.
- **MFA.** Per portal: a stored TOTP seed, a human entering a code at run time
  (a `needs_human` pause), or a long-lived trusted-device session.
- **Access.** Write-only after save; who may enter or rotate a credential;
  every run recording which credential reference it used, never the value.
- **Where portal runs execute.** Vercel functions stop at 300 seconds. Headless
  Chromium already runs there for proposal PDFs, but a portal login flow may
  not fit. `executeRun(runId)` is platform-agnostic, so an external worker can
  take over without changing the tables.

Until this is decided, `deps.secrets` resolves only `env:AGENT_*` and
`lender:<id>`.

### 2. Advance skipping action-required stages — resolved

Confirmed 2026-09-15 (decision 13): main-line only for Advance and the progress
count, in both verticals, including Solar's Advance. Side-states stay reachable
from the Move menu.

### 3. Runs about deals a manager can't open — decide before the first gated agent

**Stopgap approved 2026-09-15: option A**, with the Apply-refusal test locked in.
The lasting decision is still due before the first gated agent.

Not decided, and not blocking: the Hello Agent requests no changes, so nothing
is ever held. It must be decided before the first agent that returns changes
while gated.

**The facts.**

- A `manager`'s deal scope (`listScope(user, "Lead")` in
  `src/server/rbac/policies.ts`) is their team: deals assigned to or created by
  the manager, a rep who reports to them, or a canvasser under one of those
  reps. `super_admin`, `admin` and `accounting` see every deal in the company,
  so this question is only about managers holding the switch.
- The solar coordinators are `manager` accounts and mostly have no reports, so
  their scope is roughly the deals assigned to or created by them.
- The Agents pages filter runs by company and workspace, never by deal (both
  models are shared, and a run can name many deals).
- Apply re-checks `leadAccessible` for every held change. Close does not look
  at the deal. Run now checks only `agentCan(run)`.

**What the build does in the meantime.** For a deal a switch holder cannot
open:

- it **shows** them the customer's name and address (`leadLabel` and each
  change's `dealLabel`), with a deal link that 404s; the stage the deal is in
  and the stage the agent wants; the agent's summary and reason; the handler's
  `detail` JSON, the log lines and any error text — for a future portal agent
  that could be a loan status, a stipulation, or a permit or application
  number; and alert text built with `{{customer}}`;
- it lets them **Close** a held change on that deal, dismissing the agent's
  proposal without seeing the deal;
- it **refuses Apply**, so the change waits for the owner or an admin;
- it lets them press **Run now**, which on an *ungated* agent moves deals
  anywhere in the workspace — including ones they cannot open — as the agent.

`actions.itest.ts` pins the Apply refusal ("does not let a manager with Agents
access apply a change to a deal outside their own team"). That is today's
behaviour, recorded so any change to it is deliberate, not the answer.

**Options.**

| | What changes | On a deal they can't open, a switch holder… | Consequences |
|---|---|---|---|
| **A. Keep it** | Nothing. | …reads everything listed above, can Close, cannot Apply. | Gated work on out-of-team deals queues for the owner and admins. A coordinator with no reports can Apply on almost nothing, so for them the switch means reading, closing and Run now. The row-scope invariant is untouched. |
| **B. The switch authorises Apply** | Apply skips `leadAccessible` for switch holders. Still same company and workspace, still the moved-since check. | …reads everything, can Close, and can Apply: the deal moves under their name, and `stage_changed` alerts and `stage_entered` automations (generated documents, emails) fire on a deal they cannot open to check. | The first row-scope exception for a role that does not already see the whole company: `row-scope-boundary.test.ts` needs a reviewed allow-list entry with a new kind of reason (the existing "the permission is the boundary" entries rely on the role being company-wide). A sales manager given the switch can move another team's deals, limited to what an agent proposed. |
| **C. Hide it** | A switch holder sees a run, and gets its alert, only when they can open every deal it names. The rest is the owner's and admins'. | …sees nothing. The run does not exist for them. | Exposes nothing new. A coordinator's queue is close to empty, so the switch does little for gated agents. The most work: changes live in `detail` JSON, so filtering needs a per-change table or in-memory filtering that breaks page counts; `agents_access` alerts need a per-deal recipient check; a sweep run naming many deals needs a rule. Run now is unchanged. |
| **D. Widen their deal scope** | Holding the switch makes that manager's `listScope(user, "Lead")` the whole company, in the workspaces they hold. | …can open the deal, so nothing is out of scope and Apply works. | The switch stops meaning "agents" and means "every deal", through every screen built on `listScope`: pipeline, search, deal pages, documents, pricing, and team and report numbers that assume a manager sees a team. On a sales manager it shows every other team's customers and prices. It is the Operations-role split (Known debt) done through a permission key. |
| **E. Redact it** | Out-of-scope runs show to switch holders without the customer ("a deal outside your team"), without a deal link, and without handler detail, log or error. Close allowed with a note; Apply refused. | …sees the agent, the two stage names and that a proposal exists; can Close; cannot Apply. | Triage without the customer data. Handlers must keep customer details out of `summary` and `reason`, which stay visible. Redaction is per run and per viewer, so every page read pays a scope check. Apply still falls to the owner and admins. |

**Separately, whichever option:** Run now on an ungated agent acts on deals the
person pressing it may not be able to open. If that matters, Run now for switch
holders can be limited to gated agents, independently of A–E.
