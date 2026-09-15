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
| `src/components/portal/agents/` | `href`, `agent-tabs`, `filter-chips`, `pagination`, `local-time`, `auto-refresh`, `run-status-pill`, `change-list`, `resolve-run`, `run-list`, `needs-human-card`, `run-now-button`, `agent-enabled-switch`, `agent-config-form`, `agents-access-card`. |
| `prisma/migrations/20260915120000_agents_control_plane/` | Enums, tables, notification event values (generated). |
| `prisma/migrations/20260915120100_action_required_stages/` | Stage flags and three roofing stages. |
| `prisma/migrations/20260915120200_agents_seed_rows/` | Hello Agent and starter notification rules. |
| `e2e/agents.spec.ts` | Browser coverage. |

**Tests created**

- Unit (`pnpm test`): `src/server/modules/agents/__tests__/{schedule,registry,handler-purity,config-guard,result,gate,budget,access,deal-label,cron-route,handler-check,validate-agent}.test.ts`, `src/server/rbac/__tests__/agent-grants.test.ts`, `src/server/modules/pipeline/__tests__/stage-entry-data.test.ts`, `src/lib/__tests__/{stage-progress,agent-labels}.test.ts`, `src/server/modules/notifications/__tests__/agent-events.test.ts`.
- Integration (`pnpm test:integration`): `src/server/modules/agents/__tests__/{apply-changes,runner,tick,queries,actions}.itest.ts`, `src/server/modules/notifications/__tests__/agents-access-recipients.itest.ts`, `src/server/modules/pipeline/__tests__/action-required-stages.itest.ts`, `src/server/modules/team/__tests__/agents-access.itest.ts`.

**Modified**

`prisma/schema.prisma` · `prisma/seed.ts` · `prisma/seed-clean.ts` · `src/server/rbac/matrix.ts` · `src/lib/nav.ts` · `src/lib/stage-history.ts` · `src/components/portal/deal-stage-timeline.tsx` · `src/components/portal/deal-stage-bar.tsx` · `src/app/portal/leads/[id]/page.tsx` · `src/server/modules/leads/actions.ts` · `src/server/modules/notifications/{types,actions,engine}.ts` · `src/server/modules/team/actions.ts` · `src/app/portal/team/[id]/page.tsx` · `vercel.json` · `package.json` · `pnpm-lock.yaml`

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
pnpm typecheck 2>&1 | tail -3; echo "typecheck exit=${PIPESTATUS[0]}"
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
