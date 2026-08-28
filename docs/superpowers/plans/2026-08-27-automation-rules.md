# Automation Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a deal hits a milestone, the CRM does the paperwork itself — generates and files a document, sends one for signature, compiles the install photos, and moves the job on — configured from Settings → Automations.

**Architecture:** A new `AutomationRule` table (trigger × conditions × ordered actions) read by a `runAutomations` engine called from the same places `fireEvent` is already called from. Actions are a registry of small modules, each one calling session-free core functions — never the RBAC-guarded server actions, because an automation has no logged-in user. Every run is recorded in `AutomationRun`, which is both the failure surface and the mechanism enforcing "once per deal".

**Tech Stack:** Next.js 15 App Router, Prisma + Postgres, Zod, pdf-lib, Vitest (unit + DB integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-automation-rules-design.md`

---

## Corrections found during execution

Three things the tests taught us that the tasks below predate. Where a later
task disagrees with this section, this section wins.

1. **The engine establishes the workspace, not the caller.** `AutomationRule`,
   `Lead` and `Project` are all vertical-scoped, so an action called with no
   ambient vertical throws `MissingVerticalContextError`. `runAutomations`
   wraps its whole body in `runInVertical(asActiveVertical(args.vertical), …)`.
   Consequences: the cron in Task 11 does NOT need its own wrapper, and any
   test calling an action directly must wrap it (see
   `__tests__/stage-actions.itest.ts`).

2. **Chaining goes through `StepResult.follow`.** An action whose own effect is
   a trigger — `move_stage` landing in a stage IS `stage_entered` — reports
   `follow: { trigger, payload }` and the engine re-enters at `depth + 1`. The
   action must never call the engine itself: the engine imports the registry,
   so that would be an import cycle. `follow` is stripped before the step is
   stored.

3. **Reporting a failure is lazily imported and guarded.** The notification
   engine reaches branding → session helpers → next-auth, a graph the cron has
   no use for and vitest cannot resolve. `notifyFailure` uses
   `await import(...)` inside a try/catch; the `AutomationRun` row is the
   business record and survives the notifier being unavailable.

---

## Before you start

Read the spec. Then read these three files — the plan assumes you know them:

- `src/server/modules/notifications/engine.ts` — the event bus this rides on, and the never-throw pattern to copy
- `src/server/vertical/models.ts` — why `AutomationRule` must be registered as scoped
- `src/server/modules/esign/service.ts:830-965` — `generatePackagePdf` and `generateTemplatePreviewPdf`, the two existing callers of `generateSignedPdf`

**Two traps in this codebase that will cost you an afternoon each:**

1. **A stale dev server lies.** "Unknown field" or "column X does not exist" after a schema change means the running `next dev` predates your migration. Restart it. Do not go looking for a code bug.
2. **`next dev` loads `src/server/vertical/context.ts` twice**, so `runInVertical` silently no-ops there. Anything relying on it — the cron in Task 11 — must be verified with `npm run build && npm start`, never on the dev server.

**Another session is editing this working tree.** Never `git add -A` or `git commit -a`. Every commit in this plan lists explicit paths. Check `git status` before committing and stage only your own files.

## File structure

**New — the engine and its actions:**

| File | Responsibility |
|---|---|
| `src/server/modules/automations/types.ts` | Trigger catalog, action catalog, shared TS types. No I/O. |
| `src/server/modules/automations/match.ts` | Does this rule's `conditions` match this trigger payload? Pure. |
| `src/server/modules/automations/engine.ts` | Load rules, guard, execute in order, record the run. |
| `src/server/modules/automations/registry.ts` | Maps action `type` → module. The only file that imports all five actions. |
| `src/server/modules/automations/actions/move-stage.ts` | |
| `src/server/modules/automations/actions/set-project-status.ts` | |
| `src/server/modules/automations/actions/generate-document.ts` | |
| `src/server/modules/automations/actions/send-for-signature.ts` | |
| `src/server/modules/automations/actions/compile-photos.ts` | |
| `src/server/modules/automations/actions.server.ts` | Settings CRUD server actions. |
| `src/server/modules/automations/defaults.ts` | Starter rules. |
| `src/server/modules/esign/context.ts` | `ctxForLead` + `LeadForCtx`, moved out of `service.ts` so an automation can build an autofill context without a session. |

One file per action so each stays testable alone and a sixth action is a new file, not an edit to a growing switch.

**Modified:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | 2 enums, 2 models, 1 new `NotificationEvent` value |
| `src/server/vertical/models.ts` | register `AutomationRule` as scoped |
| `src/server/modules/leads/actions.ts` | fire `stage_entered` (2 sites) |
| `src/server/modules/esign/service.ts` | fire `document_completed`; extract `createSignaturePackage`; move `ctxForLead` out |
| `src/server/modules/files/actions.ts` | fire `photo_checklist_completed` |
| `src/lib/settings-sections.ts` | hub card |
| `src/server/modules/settings/inventory.ts` | hub count |
| `vercel.json` | daily cron |

---

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/server/vertical/models.ts`
- Create: `prisma/migrations/<timestamp>_automation_rules/migration.sql` (generated)

- [ ] **Step 1: Add the enums**

In `prisma/schema.prisma`, directly after the `NotificationChannel` enum (~line 228):

```prisma
/// What can set an automation off.
enum AutomationTrigger {
  stage_entered
  photo_checklist_completed
  document_completed
  stage_age_exceeded
}

enum AutomationRunStatus {
  succeeded
  failed
  skipped
}
```

- [ ] **Step 2: Add `automation_failed` to `NotificationEvent`**

An automation that fails silently is worse than no automation. It reports through the notification bus that already exists, so it needs an event there. In the `NotificationEvent` enum (~line 208), after `payroll_approved`:

```prisma
  payroll_approved
  automation_failed
```

- [ ] **Step 3: Add the models**

After the `NotificationRule` model (~line 1906):

```prisma
/// One "when X happens, do Y" rule.
///
/// Sibling of NotificationRule, deliberately NOT a column on it: a rule that
/// emails somebody and a rule that moves a deal through the pipeline have
/// different blast radii and different failure semantics, and sharing a table
/// would mean sharing a settings page.
model AutomationRule {
  id         String            @id @default(uuid())
  companyId  String
  company    Company           @relation(fields: [companyId], references: [id], onDelete: Cascade)
  /// Isolated per vertical: this row belongs to exactly one workspace.
  vertical   Vertical          @default(roofing)
  name       String
  trigger    AutomationTrigger
  /// Trigger-specific match conditions:
  ///   stage_entered              { stageId }
  ///   photo_checklist_completed  { kind: "site" | "install" }
  ///   document_completed         { templateId }
  ///   stage_age_exceeded         { stageId, days }
  /// An empty object matches every occurrence of the trigger.
  conditions Json              @default("{}")
  /// ORDERED list of what to do: [{ type, ...config }]. The order IS the
  /// contract — a run stops at the first action that fails, so "compile the
  /// photos then move the stage" must never silently become the reverse.
  actions    Json              @default("[]")
  /// Run at most once per deal. Off = every time the trigger matches.
  once       Boolean           @default(true)
  active     Boolean           @default(true)
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  runs AutomationRun[]

  @@index([companyId, vertical, trigger, active])
  @@map("automation_rules")
}

/// One firing of one rule against one deal.
///
/// Not merely a log. It is how `once` is enforced (has this rule already
/// succeeded here?) and it is the ONLY place a silent automation becomes
/// visible to a human, which is why the per-action outcome is kept rather than
/// just a pass/fail.
///
/// A CHILD of AutomationRule — no vertical column — exactly like LeadStageEvent
/// is a child of Lead. It is only ever reached through a rule the isolation
/// extension has already scoped. See server/vertical/models.ts.
model AutomationRun {
  id         String              @id @default(uuid())
  companyId  String
  company    Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  ruleId     String
  rule       AutomationRule      @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  leadId     String?
  lead       Lead?               @relation(fields: [leadId], references: [id], onDelete: SetNull)
  status     AutomationRunStatus
  /// Per-action outcome, in order: [{ type, ok, detail }].
  steps      Json                @default("[]")
  error      String?
  startedAt  DateTime            @default(now())
  finishedAt DateTime?

  @@index([companyId, startedAt])
  @@index([ruleId, leadId, status])
  @@map("automation_runs")
}
```

`leadId` is `onDelete: SetNull`, not Cascade: a deleted deal must not erase the record that an automation ran, the same reasoning as `LeadStageEvent.stageId`.

- [ ] **Step 4: Add the back-relations**

On `model Company`, beside the existing `notificationRules` relation:

```prisma
  automationRules AutomationRule[]
  automationRuns  AutomationRun[]
```

On `model Lead`, beside its other child relations:

```prisma
  automationRuns AutomationRun[]
```

- [ ] **Step 5: Register the rule as vertical-scoped**

In `src/server/vertical/models.ts`, in `SCOPED_MODELS`, directly after `"NotificationRule"`:

```ts
  "NotificationRule",
  "AutomationRule",
```

`AutomationRun` is deliberately NOT added — it is a child of a scoped model, reached only through it.

- [ ] **Step 6: Generate the migration**

```bash
npm run db:migrate -- --name automation_rules
```

Expected: a new folder under `prisma/migrations/`, and `CREATE TABLE "automation_rules"` in its `migration.sql`.

- [ ] **Step 7: Verify the client typechecks**

```bash
npm run typecheck
```

Expected: no errors. If you see "Property 'automationRule' does not exist", run `npm run db:generate` and restart any running dev server.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/server/vertical/models.ts
git commit -m "Automations get a table, and a record of every time one fires"
```

---

## Task 2: The trigger and action catalog

Pure data and types. No I/O, so it is trivially testable and every later task imports from it.

**Files:**
- Create: `src/server/modules/automations/types.ts`
- Test: `src/server/modules/automations/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/automations/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import { TRIGGER_DEFS, ACTION_DEFS, triggerLabel, actionLabel } from "../types";

describe("catalog", () => {
  it("defines every trigger in the Prisma enum", () => {
    expect(TRIGGER_DEFS.map((t) => t.value).sort()).toEqual([
      "document_completed",
      "photo_checklist_completed",
      "stage_age_exceeded",
      "stage_entered",
    ]);
  });

  it("defines all five actions", () => {
    expect(ACTION_DEFS.map((a) => a.value).sort()).toEqual([
      "compile_photos",
      "generate_document",
      "move_stage",
      "send_for_signature",
      "set_project_status",
    ]);
  });

  it("labels a known trigger and falls back on an unknown one", () => {
    expect(triggerLabel("stage_entered")).toBe("Deal reaches a stage");
    expect(triggerLabel("nonsense")).toBe("nonsense");
  });

  it("labels a known action", () => {
    expect(actionLabel("compile_photos")).toBe("Compile photos into a PDF");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/server/modules/automations/__tests__/types.test.ts
```

Expected: FAIL — `Cannot find module '../types'`.

- [ ] **Step 3: Write the catalog**

```ts
// src/server/modules/automations/types.ts
import type { AutomationTrigger, Vertical } from "@prisma/client";

/**
 * The catalog the rule builder is drawn from, and the vocabulary the engine
 * speaks. Everything here is data — no database, no I/O — so the UI and the
 * engine cannot drift apart about what a trigger or an action even is.
 */

/** Which single condition control a trigger needs in the editor. */
export type ConditionKind = "stage" | "checklist" | "template" | "stage_age";

export type TriggerDef = {
  value: AutomationTrigger;
  label: string;
  /** Reads after the rule name: "When a deal <blurb>". */
  blurb: string;
  condition: ConditionKind;
};

export const TRIGGER_DEFS: TriggerDef[] = [
  {
    value: "stage_entered",
    label: "Deal reaches a stage",
    blurb: "lands in a pipeline stage",
    condition: "stage",
  },
  {
    value: "photo_checklist_completed",
    label: "Photo checklist is complete",
    blurb: "has every required photo uploaded",
    condition: "checklist",
  },
  {
    value: "document_completed",
    label: "Document is fully signed",
    blurb: "has a document signed by everyone",
    condition: "template",
  },
  {
    value: "stage_age_exceeded",
    label: "Deal sits in a stage too long",
    blurb: "has waited in a stage for too many days",
    condition: "stage_age",
  },
];

export type ActionValue =
  | "generate_document"
  | "send_for_signature"
  | "move_stage"
  | "set_project_status"
  | "compile_photos";

export type ActionDef = {
  value: ActionValue;
  label: string;
  /** What the editor must ask for. Drives which control the action row shows. */
  config: "template" | "template_signer" | "stage" | "project_status" | "checklist";
};

export const ACTION_DEFS: ActionDef[] = [
  { value: "generate_document", label: "Generate and file a document", config: "template" },
  { value: "send_for_signature", label: "Send a document for signature", config: "template_signer" },
  { value: "move_stage", label: "Move the deal to a stage", config: "stage" },
  { value: "set_project_status", label: "Set the project status", config: "project_status" },
  { value: "compile_photos", label: "Compile photos into a PDF", config: "checklist" },
];

export function triggerLabel(v: string): string {
  return TRIGGER_DEFS.find((t) => t.value === v)?.label ?? v;
}

export function actionLabel(v: string): string {
  return ACTION_DEFS.find((a) => a.value === v)?.label ?? v;
}

// --- Engine-facing types ---------------------------------------------------

/** What actually happened, for condition matching. */
export type TriggerPayload = {
  stageId?: string;
  kind?: "site" | "install";
  templateId?: string;
  days?: number;
};

/** One action's outcome, stored verbatim in AutomationRun.steps. */
export type StepResult = { type: string; ok: boolean; detail: string };

/** What every action module receives. Note: no SessionUser — there isn't one. */
export type ActionContext = {
  companyId: string;
  vertical: Vertical;
  leadId: string;
  config: unknown;
  /** How deep in a chain of rules we are. Passed to any re-entrant fire. */
  depth: number;
};

export type AutomationActionModule = {
  type: ActionValue;
  /** Rejects a malformed config before anything is written. */
  parseConfig(raw: unknown): { ok: true; config: unknown } | { ok: false; error: string };
  run(ctx: ActionContext): Promise<StepResult>;
};

/** A chain of rules deeper than this is a loop, not a workflow. */
export const MAX_DEPTH = 3;
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/server/modules/automations/__tests__/types.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/automations/types.ts src/server/modules/automations/__tests__/types.test.ts
git commit -m "The vocabulary a rule is written in"
```

---

## Task 3: Condition matching

Pure function, its own file, because "did this rule want this event?" is the one piece of logic every trigger shares and the easiest to get subtly wrong.

**Files:**
- Create: `src/server/modules/automations/match.ts`
- Test: `src/server/modules/automations/__tests__/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/automations/__tests__/match.test.ts
import { describe, it, expect } from "vitest";
import { matchesConditions } from "../match";

describe("matchesConditions", () => {
  it("matches a stage rule on its stage", () => {
    expect(matchesConditions("stage_entered", { stageId: "s1" }, { stageId: "s1" })).toBe(true);
  });

  it("rejects a stage rule on another stage", () => {
    expect(matchesConditions("stage_entered", { stageId: "s1" }, { stageId: "s2" })).toBe(false);
  });

  it("treats empty conditions as 'every occurrence'", () => {
    expect(matchesConditions("stage_entered", {}, { stageId: "anything" })).toBe(true);
  });

  it("matches a checklist rule on its kind", () => {
    expect(matchesConditions("photo_checklist_completed", { kind: "install" }, { kind: "install" })).toBe(true);
    expect(matchesConditions("photo_checklist_completed", { kind: "install" }, { kind: "site" })).toBe(false);
  });

  it("matches a document rule on its template", () => {
    expect(matchesConditions("document_completed", { templateId: "t1" }, { templateId: "t1" })).toBe(true);
    expect(matchesConditions("document_completed", { templateId: "t1" }, { templateId: "t2" })).toBe(false);
  });

  it("fires a stage-age rule only once the threshold is passed", () => {
    const cond = { stageId: "s1", days: 7 };
    expect(matchesConditions("stage_age_exceeded", cond, { stageId: "s1", days: 7 })).toBe(true);
    expect(matchesConditions("stage_age_exceeded", cond, { stageId: "s1", days: 9 })).toBe(true);
    expect(matchesConditions("stage_age_exceeded", cond, { stageId: "s1", days: 6 })).toBe(false);
  });

  it("rejects a stage-age rule sitting in a different stage", () => {
    expect(
      matchesConditions("stage_age_exceeded", { stageId: "s1", days: 1 }, { stageId: "s2", days: 30 })
    ).toBe(false);
  });

  it("survives a conditions blob that is not an object", () => {
    expect(matchesConditions("stage_entered", null, { stageId: "s1" })).toBe(true);
    expect(matchesConditions("stage_entered", "junk", { stageId: "s1" })).toBe(true);
  });
});
```

The last case matters: `conditions` is a JSON column, so anything can be in it.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/server/modules/automations/__tests__/match.test.ts
```

Expected: FAIL — `Cannot find module '../match'`.

- [ ] **Step 3: Implement it**

```ts
// src/server/modules/automations/match.ts
import type { AutomationTrigger } from "@prisma/client";
import type { TriggerPayload } from "./types";

/**
 * Does this rule want this event?
 *
 * `conditions` is a JSON column, so it may hold anything at all — a hand-edited
 * row, a shape from an older version of the editor. Every read is defensive and
 * an unreadable condition falls back to "match", never to "throw": a rule that
 * fires slightly too often is a visible problem, and an engine that throws
 * while a rep drags a card is an invisible one.
 */
export function matchesConditions(
  trigger: AutomationTrigger,
  conditions: unknown,
  payload: TriggerPayload
): boolean {
  const c = conditions && typeof conditions === "object" ? (conditions as Record<string, unknown>) : {};

  switch (trigger) {
    case "stage_entered":
      return str(c.stageId) === undefined || str(c.stageId) === payload.stageId;

    case "photo_checklist_completed":
      return str(c.kind) === undefined || str(c.kind) === payload.kind;

    case "document_completed":
      return str(c.templateId) === undefined || str(c.templateId) === payload.templateId;

    case "stage_age_exceeded": {
      if (str(c.stageId) !== undefined && str(c.stageId) !== payload.stageId) return false;
      const threshold = num(c.days);
      if (threshold === undefined) return true;
      return (payload.days ?? 0) >= threshold;
    }

    default:
      return false;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/server/modules/automations/__tests__/match.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/automations/match.ts src/server/modules/automations/__tests__/match.test.ts
git commit -m "Did this rule want this event?"
```

---

## Task 4: The two stage actions

Start with the two simplest actions so the engine in Task 6 has something real to execute.

**Files:**
- Create: `src/server/modules/automations/actions/move-stage.ts`
- Create: `src/server/modules/automations/actions/set-project-status.ts`
- Test: `src/server/modules/automations/__tests__/stage-actions.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/automations/__tests__/stage-actions.itest.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { moveStageAction } from "../actions/move-stage";
import { setProjectStatusAction } from "../actions/set-project-status";

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let pipelineId: string;
const stages: Record<string, string> = {};

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Automation Co", slug: `auto-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const p = await db.pipeline.create({ data: { companyId, name: "P", vertical: "solar" } });
  pipelineId = p.id;
  for (const [i, name] of ["Installed", "Inspection"].entries()) {
    const s = await db.pipelineStage.create({
      data: { pipelineId, key: `s${i}`, name, position: i },
    });
    stages[name] = s.id;
  }
});

afterAll(async () => {
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.project.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

let leadId: string;
beforeEach(async () => {
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId,
      stageId: stages["Installed"], firstName: "A", lastName: "Homeowner",
    },
  });
  leadId = lead.id;
});

const ctx = (config: unknown) => ({ companyId, vertical: "solar" as const, leadId, config, depth: 0 });

describe("move_stage", () => {
  it("moves the deal and opens a new stage span", async () => {
    const res = await moveStageAction.run(ctx({ stageId: stages["Inspection"] }));
    expect(res.ok).toBe(true);

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stageId).toBe(stages["Inspection"]);

    const open = await db.leadStageEvent.findFirst({ where: { leadId, exitedAt: null } });
    expect(open?.stageName).toBe("Inspection");
  });

  it("records who did it as the automation, not a person", async () => {
    await moveStageAction.run(ctx({ stageId: stages["Inspection"] }));
    const log = await db.activityLog.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
    expect(log?.actorId).toBeNull();
    expect(log?.message).toContain("Automation");
  });

  it("fails rather than moving the deal to a stage in another company", async () => {
    const other = await db.company.create({ data: { name: "Other", slug: `oth-${Date.now()}` } });
    const otherPipe = await db.pipeline.create({ data: { companyId: other.id, name: "P" } });
    const otherStage = await db.pipelineStage.create({
      data: { pipelineId: otherPipe.id, key: "x", name: "Elsewhere", position: 0 },
    });

    const res = await moveStageAction.run(ctx({ stageId: otherStage.id }));
    expect(res.ok).toBe(false);

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stageId).toBe(stages["Installed"]);

    await db.pipelineStage.delete({ where: { id: otherStage.id } });
    await db.pipeline.delete({ where: { id: otherPipe.id } });
    await db.company.delete({ where: { id: other.id } });
  });

  it("rejects a config with no stage", () => {
    expect(moveStageAction.parseConfig({}).ok).toBe(false);
  });
});

describe("set_project_status", () => {
  it("sets the status on the deal's project", async () => {
    await db.project.create({
      data: { companyId, vertical: "solar", leadId, projectNumber: `P-${Date.now()}`, status: "in_production" },
    });
    const res = await setProjectStatusAction.run(ctx({ status: "qc" }));
    expect(res.ok).toBe(true);
    const project = await db.project.findFirst({ where: { leadId } });
    expect(project?.status).toBe("qc");
  });

  it("fails loudly when the deal has no project", async () => {
    const res = await setProjectStatusAction.run(ctx({ status: "qc" }));
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no project/i);
  });

  it("rejects a status outside the enum", () => {
    expect(setProjectStatusAction.parseConfig({ status: "banana" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run db:up
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/stage-actions.itest.ts
```

Expected: FAIL — `Cannot find module '../actions/move-stage'`.

- [ ] **Step 3: Write `move-stage.ts`**

```ts
// src/server/modules/automations/actions/move-stage.ts
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ stageId: z.string().min(1) });

/**
 * Move the deal to a stage.
 *
 * Goes through `recordStageEntry` like every other path that moves a deal, so
 * cycle-time history has no hole where the automation did the moving.
 *
 * It deliberately does NOT re-fire the automation engine itself — the engine
 * does that after the action returns, because only the engine knows the current
 * depth and it is the thing that has to stop a loop.
 */
export const moveStageAction: AutomationActionModule = {
  type: "move_stage",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick the stage to move the deal to." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no target stage.");

    // Scoped to the company on purpose: a stage id is chosen in a dropdown, but
    // a rule outlives the stage it names, and an id from another tenant must
    // never move a deal.
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: parsed.data.stageId, pipeline: { companyId: ctx.companyId } },
      select: { id: true, name: true, position: true },
    });
    if (!stage) return fail("That stage no longer exists.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: { id: true, stageId: true },
    });
    if (!lead) return fail("Deal not found.");
    if (lead.stageId === stage.id) return { type: "move_stage", ok: true, detail: `Already in ${stage.name}.` };

    await prisma.lead.update({ where: { id: lead.id }, data: { stageId: stage.id } });
    await recordStageEntry({ leadId: lead.id, stageId: stage.id, stage });

    await prisma.activityLog.create({
      data: {
        companyId: ctx.companyId,
        type: "stage_change",
        message: `Automation moved the deal to ${stage.name}`,
        actorId: null,
        leadId: lead.id,
      },
    });

    return { type: "move_stage", ok: true, detail: `Moved to ${stage.name}.` };
  },
};

function fail(detail: string): StepResult {
  return { type: "move_stage", ok: false, detail };
}
```

- [ ] **Step 4: Write `set-project-status.ts`**

```ts
// src/server/modules/automations/actions/set-project-status.ts
import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const STATUSES = [
  "not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled",
] as const;

const schema = z.object({ status: z.enum(STATUSES) });

/**
 * Set the project status.
 *
 * A separate action from move_stage even though both "advance the job": they
 * are different tables with different enums, and one action whose config means
 * two unrelated things is one nobody can read in the rule list.
 */
export const setProjectStatusAction: AutomationActionModule = {
  type: "set_project_status",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick a project status." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no status.");

    const project = await prisma.project.findFirst({
      where: { leadId: ctx.leadId, companyId: ctx.companyId },
      select: { id: true, status: true },
    });
    // Loud, not silent: a rule that sets a status on a deal with no project is
    // a rule somebody wrote wrong, and the run log is where they find that out.
    if (!project) return fail("This deal has no project to set a status on.");

    if (project.status === parsed.data.status) {
      return { type: "set_project_status", ok: true, detail: `Already ${parsed.data.status}.` };
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { status: parsed.data.status },
    });

    await prisma.activityLog.create({
      data: {
        companyId: ctx.companyId,
        type: "status_change",
        message: `Automation set the project status to ${parsed.data.status}`,
        actorId: null,
        leadId: ctx.leadId,
        projectId: project.id,
      },
    });

    return { type: "set_project_status", ok: true, detail: `Set to ${parsed.data.status}.` };
  },
};

function fail(detail: string): StepResult {
  return { type: "set_project_status", ok: false, detail };
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/stage-actions.itest.ts
```

Expected: PASS, 7 tests.

If `activityLog.create` fails on a missing `projectId` column or similar, check the `ActivityLog` model for the exact field names before changing anything else.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/automations/actions src/server/modules/automations/__tests__/stage-actions.itest.ts
git commit -m "An automation can move a deal, and says so in the deal's own history"
```

---

## Task 5: Extract the autofill context out of the e-sign service

`ctxForLead` is currently a private function in `service.ts`. `generate_document` needs it, and `service.ts` is already 965 lines. Moving it out is the smallest change that unblocks the action without growing that file further.

**Files:**
- Create: `src/server/modules/esign/context.ts`
- Modify: `src/server/modules/esign/service.ts`

- [ ] **Step 1: Create the new module**

Move `LeadForCtx` (`service.ts:~310-336`) and `ctxForLead` (`service.ts:338-371`) verbatim into a new file, exported:

```ts
// src/server/modules/esign/context.ts
import { buildAutofillContext, type AutofillContext } from "./autofill";

/**
 * The lead shape an autofill context is built from, and the builder itself.
 *
 * Its own module rather than a private function in service.ts because the
 * automation engine needs to fill a template for a deal with nobody logged in,
 * and importing the send-for-signature service to get at one pure mapping
 * function would drag a session-shaped dependency into a path that has no
 * session.
 */
export type LeadForCtx = {
  firstName: string;
  lastName: string;
  coOwnerName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  createdAt: Date;
  customFields: unknown;
  source: { name: string } | null;
  assignedRep: { firstName: string; lastName: string } | null;
  project: {
    projectNumber: string;
    serviceType: string;
    status: string;
    contractValue: number;
    customFields: unknown;
    manager: { firstName: string; lastName: string } | null;
  } | null;
};

export function ctxForLead(lead: LeadForCtx, companyName: string): AutofillContext {
  const custom: Record<string, string> = {};
  const merge = (obj: unknown) => {
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) custom[k] = v == null ? "" : String(v);
    }
  };
  merge(lead.customFields);
  merge(lead.project?.customFields);
  const name = (u: { firstName: string; lastName: string } | null | undefined) =>
    u ? `${u.firstName} ${u.lastName}`.trim() : null;
  return buildAutofillContext({
    firstName: lead.firstName,
    lastName: lead.lastName,
    coOwnerName: lead.coOwnerName,
    email: lead.email,
    phone: lead.phone,
    street: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    projectNumber: lead.project?.projectNumber,
    projectType: lead.project?.serviceType,
    projectStage: lead.project?.status,
    projectValueCents: lead.project?.contractValue,
    rep: name(lead.assignedRep),
    pm: name(lead.project?.manager),
    leadSource: lead.source?.name,
    leadCreatedAt: lead.createdAt,
    leadStatus: lead.status,
    companyName,
    custom,
  });
}

/** The `include` every caller needs to satisfy `LeadForCtx`. */
export const LEAD_CTX_INCLUDE = {
  source: { select: { name: true } },
  assignedRep: { select: { firstName: true, lastName: true } },
  project: {
    select: {
      projectNumber: true,
      serviceType: true,
      status: true,
      contractValue: true,
      customFields: true,
      manager: { select: { firstName: true, lastName: true } },
    },
  },
} as const;
```

- [ ] **Step 2: Delete both from `service.ts` and import instead**

Remove the `LeadForCtx` type and the `ctxForLead` function from `service.ts`. Add near its other imports:

```ts
import { ctxForLead, type LeadForCtx } from "./context";
```

Leave every call site of `ctxForLead(...)` exactly as it is.

- [ ] **Step 3: Verify nothing else referenced them**

```bash
npm run typecheck
```

Expected: no errors. A pure move — if anything fails here it is an import path, not logic.

- [ ] **Step 4: Prove the e-sign suite still passes**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/solar/__tests__/proposal-signing.itest.ts
npx vitest run
```

Expected: both pass, same counts as before your change. Note the unit-suite pass count now — it is the regression baseline for the rest of this plan.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/esign/context.ts src/server/modules/esign/service.ts
git commit -m "Filling a template for a deal should not require being logged in"
```

---

## Task 6: The engine

**Files:**
- Create: `src/server/modules/automations/registry.ts`
- Create: `src/server/modules/automations/engine.ts`
- Test: `src/server/modules/automations/__tests__/engine.itest.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/automations/__tests__/engine.itest.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runAutomations } from "../engine";

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let pipelineId: string;
const stages: Record<string, string> = {};

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Engine Co", slug: `eng-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const p = await db.pipeline.create({ data: { companyId, name: "P", vertical: "solar" } });
  pipelineId = p.id;
  for (const [i, name] of ["Installed", "Inspection", "PTO"].entries()) {
    const s = await db.pipelineStage.create({ data: { pipelineId, key: `s${i}`, name, position: i } });
    stages[name] = s.id;
  }
});

afterAll(async () => {
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

let leadId: string;
beforeEach(async () => {
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId, stageId: stages["Installed"], firstName: "A", lastName: "B" },
  });
  leadId = lead.id;
});

async function rule(over: Record<string, unknown> = {}) {
  return db.automationRule.create({
    data: {
      companyId, vertical: "solar", name: "R",
      trigger: "stage_entered",
      conditions: { stageId: stages["Installed"] },
      actions: [{ type: "move_stage", stageId: stages["Inspection"] }],
      ...over,
    },
  });
}

const fire = (over: Record<string, unknown> = {}) =>
  runAutomations({
    companyId, vertical: "solar", trigger: "stage_entered",
    leadId, payload: { stageId: stages["Installed"] }, depth: 0, ...over,
  });

describe("runAutomations", () => {
  it("runs a matching rule and records a successful run", async () => {
    const r = await rule();
    await fire();

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stageId).toBe(stages["Inspection"]);

    const run = await db.automationRun.findFirst({ where: { ruleId: r.id } });
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.steps).toEqual([{ type: "move_stage", ok: true, detail: "Moved to Inspection." }]);
  });

  it("ignores an inactive rule", async () => {
    await rule({ active: false });
    await fire();
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["Installed"]);
    expect(await db.automationRun.count({ where: { companyId } })).toBe(0);
  });

  it("ignores a rule whose conditions do not match", async () => {
    await rule({ conditions: { stageId: stages["PTO"] } });
    await fire();
    expect(await db.automationRun.count({ where: { companyId } })).toBe(0);
  });

  it("runs a once-rule only once per deal", async () => {
    const r = await rule();
    await fire();
    await db.lead.update({ where: { id: leadId }, data: { stageId: stages["Installed"] } });
    await fire();
    expect(await db.automationRun.count({ where: { ruleId: r.id, status: "succeeded" } })).toBe(1);
  });

  it("runs a repeatable rule every time", async () => {
    const r = await rule({ once: false });
    await fire();
    await db.lead.update({ where: { id: leadId }, data: { stageId: stages["Installed"] } });
    await fire();
    expect(await db.automationRun.count({ where: { ruleId: r.id, status: "succeeded" } })).toBe(2);
  });

  it("stops at the first failing action and does not run later ones", async () => {
    const r = await rule({
      actions: [
        { type: "set_project_status", status: "qc" }, // no project on this deal -> fails
        { type: "move_stage", stageId: stages["Inspection"] },
      ],
    });
    await fire();

    const run = await db.automationRun.findFirst({ where: { ruleId: r.id } });
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/no project/i);
    expect((run?.steps as unknown[]).length).toBe(1);

    // The action after the failure never ran.
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["Installed"]);
  });

  it("refuses to run past the depth limit", async () => {
    const r = await rule();
    await fire({ depth: 3 });
    const run = await db.automationRun.findFirst({ where: { ruleId: r.id } });
    expect(run?.status).toBe("skipped");
    expect(run?.error).toBe("loop guard");
  });

  it("never throws, whatever the rule says", async () => {
    await rule({ actions: [{ type: "not_a_real_action" }] });
    await expect(fire()).resolves.toBeUndefined();
  });

  it("does not fire a roofing rule on a solar deal", async () => {
    await rule({ vertical: "roofing" });
    await fire();
    expect(await db.automationRun.count({ where: { companyId } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/engine.itest.ts
```

Expected: FAIL — `Cannot find module '../engine'`.

- [ ] **Step 3: Write the registry**

```ts
// src/server/modules/automations/registry.ts
import { moveStageAction } from "./actions/move-stage";
import { setProjectStatusAction } from "./actions/set-project-status";
import type { AutomationActionModule } from "./types";

/**
 * The only file that knows about every action.
 *
 * Adding a sixth action is a new file plus one line here — never an edit to a
 * growing switch statement inside the engine.
 */
export const ACTION_REGISTRY: Record<string, AutomationActionModule> = {
  [moveStageAction.type]: moveStageAction,
  [setProjectStatusAction.type]: setProjectStatusAction,
};

export function actionFor(type: unknown): AutomationActionModule | null {
  return typeof type === "string" ? (ACTION_REGISTRY[type] ?? null) : null;
}
```

Tasks 7, 8 and 9 each add one line here.

- [ ] **Step 4: Write the engine**

```ts
// src/server/modules/automations/engine.ts
import type { AutomationTrigger, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fireEvent } from "@/server/modules/notifications/engine";
import { matchesConditions } from "./match";
import { actionFor } from "./registry";
import { MAX_DEPTH, type StepResult, type TriggerPayload } from "./types";

export type RunArgs = {
  companyId: string;
  vertical: Vertical;
  trigger: AutomationTrigger;
  leadId: string;
  payload: TriggerPayload;
  /**
   * How many rules deep this firing already is. An action that causes another
   * trigger passes depth + 1.
   *
   * An argument, NOT an AsyncLocalStorage counter: `next dev` loads a module
   * twice (it is why runInVertical no-ops there), and a depth store that
   * silently resets to zero is a loop guard that does not guard.
   */
  depth: number;
};

/**
 * Run every automation rule that wanted this event.
 *
 * Best-effort, exactly like `fireEvent`, and for the same reason: a rep
 * dragging a card across the pipeline must never see an error because an
 * automation failed. The rep's move is the business record; the automation is a
 * consequence of it. Failures are recorded in AutomationRun and reported
 * through the notification bus, never thrown at whoever triggered them.
 */
export async function runAutomations(args: RunArgs): Promise<void> {
  try {
    await run(args);
  } catch (err) {
    console.error("[automations] runAutomations failed", args.trigger, err);
  }
}

async function run(args: RunArgs): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: { companyId: args.companyId, trigger: args.trigger, active: true },
    orderBy: { createdAt: "asc" },
  });
  // The vertical filter is the isolation extension's job — AutomationRule is a
  // scoped model, so this query already answers for one workspace only.
  if (rules.length === 0) return;

  for (const rule of rules) {
    if (!matchesConditions(args.trigger, rule.conditions, args.payload)) continue;

    if (args.depth >= MAX_DEPTH) {
      await record(rule.id, args, "skipped", [], "loop guard");
      continue;
    }

    if (rule.once) {
      const already = await prisma.automationRun.findFirst({
        where: { ruleId: rule.id, leadId: args.leadId, status: "succeeded" },
        select: { id: true },
      });
      if (already) continue;
    }

    await execute(rule, args);
  }
}

async function execute(
  rule: { id: string; name: string; actions: unknown },
  args: RunArgs
): Promise<void> {
  const list = Array.isArray(rule.actions) ? rule.actions : [];
  const steps: StepResult[] = [];
  let error: string | null = null;

  for (const raw of list) {
    const config = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const mod = actionFor(config.type);

    if (!mod) {
      error = `Unknown action "${String(config.type)}".`;
      steps.push({ type: String(config.type ?? "unknown"), ok: false, detail: error });
      break;
    }

    let step: StepResult;
    try {
      step = await mod.run({
        companyId: args.companyId,
        vertical: args.vertical,
        leadId: args.leadId,
        config,
        depth: args.depth,
      });
    } catch (err) {
      // An action that throws is a failed action, not a failed engine.
      step = { type: mod.type, ok: false, detail: err instanceof Error ? err.message : "Action threw." };
    }

    steps.push(step);

    // Stop at the first failure. Half-applying a rule is the one outcome worse
    // than not applying it: a deal at Inspection whose paperwork was never made.
    if (!step.ok) {
      error = step.detail;
      break;
    }
  }

  await record(rule.id, args, error ? "failed" : "succeeded", steps, error);

  if (error) {
    await fireEvent({
      companyId: args.companyId,
      event: "automation_failed",
      leadId: args.leadId,
      status: `${rule.name}: ${error}`,
    });
  }
}

async function record(
  ruleId: string,
  args: RunArgs,
  status: "succeeded" | "failed" | "skipped",
  steps: StepResult[],
  error: string | null
): Promise<void> {
  await prisma.automationRun.create({
    data: {
      companyId: args.companyId,
      ruleId,
      leadId: args.leadId,
      status,
      steps: steps as unknown as object,
      error,
      finishedAt: new Date(),
    },
  });
}
```

- [ ] **Step 5: Add the `automation_failed` copy to the notification catalog**

In `src/server/modules/notifications/types.ts`, append to `EVENT_DEFS`:

```ts
  {
    value: "automation_failed",
    label: "An automation failed",
    condition: null,
    tokens: ["{{customer}}", "{{status}}"],
    defaultTitle: "Automation failed on {{customer}}",
    defaultBody: "{{status}}",
  },
```

Then in `src/server/modules/notifications/actions.ts`, add `"automation_failed"` to the `EVENTS` tuple (~line 19) so the notification rule editor accepts a rule for it:

```ts
  "task_assigned", "daily_report_submitted", "commission_approved", "payroll_approved",
  "automation_failed",
] as const;
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/engine.itest.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/automations src/server/modules/notifications/types.ts src/server/modules/notifications/actions.ts
git commit -m "The engine: match, guard, run in order, stop at the first failure"
```

---

## Task 7: `generate_document`

The action behind "some we just generate filled up".

**Files:**
- Create: `src/server/modules/automations/actions/generate-document.ts`
- Modify: `src/server/modules/automations/registry.ts`
- Test: `src/server/modules/automations/__tests__/generate-document.itest.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/automations/__tests__/generate-document.itest.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { generateDocumentAction } from "../actions/generate-document";

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let templateId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Docgen Co", slug: `dg-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Nancy", lastName: "Moore", address: "107 Oak St" },
  });
  leadId = lead.id;
  const t = await db.documentTemplate.create({
    data: {
      companyId, vertical: "solar", name: "Certificate of Acceptance",
      folderKey: "certificate_of_acceptance",
      pages: [{ width: 612, height: 792 }],
      body: [{ page: 1, type: "heading", text: "Certificate of Acceptance", x: 60, y: 700 }],
    },
  });
  templateId = t.id;
  await db.documentTemplateField.create({
    data: { templateId, page: 1, x: 60, y: 640, type: "text", valueToken: "{{customer.fullName}}" },
  });
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.documentTemplateField.deleteMany({ where: { templateId } });
  await db.documentTemplate.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const ctx = (config: unknown) => ({ companyId, vertical: "solar" as const, leadId, config, depth: 0 });

describe("generate_document", () => {
  it("files a real PDF into the template's folder", async () => {
    const res = await generateDocumentAction.run(ctx({ templateId }));
    expect(res.ok).toBe(true);

    const file = await db.fileAsset.findFirst({ where: { companyId, leadId } });
    expect(file?.category).toBe("certificate_of_acceptance");
    expect(file?.mimeType).toBe("application/pdf");
    expect(file?.name).toContain("Certificate of Acceptance");
    // Uploaded by nobody — an automation is not a person.
    expect(file?.uploadedById).toBeNull();
    expect(file!.size).toBeGreaterThan(500);
  });

  it("falls back to the Contract folder when the template names none", async () => {
    const t = await db.documentTemplate.create({
      data: { companyId, vertical: "solar", name: "Unfiled", pages: [{ width: 612, height: 792 }] },
    });
    const res = await generateDocumentAction.run(ctx({ templateId: t.id }));
    expect(res.ok).toBe(true);
    const file = await db.fileAsset.findFirst({ where: { companyId, name: { contains: "Unfiled" } } });
    expect(file?.category).toBe("contract");
  });

  it("fails when the template has been deleted", async () => {
    const res = await generateDocumentAction.run(ctx({ templateId: "00000000-0000-0000-0000-000000000000" }));
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/template/i);
  });

  it("rejects a config with no template", () => {
    expect(generateDocumentAction.parseConfig({}).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/generate-document.itest.ts
```

Expected: FAIL — `Cannot find module '../actions/generate-document'`.

- [ ] **Step 3: Implement it**

```ts
// src/server/modules/automations/actions/generate-document.ts
import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getObject, putObject } from "@/server/storage";
import { ctxForLead, LEAD_CTX_INCLUDE, type LeadForCtx } from "@/server/modules/esign/context";
import { generateSignedPdf, type Snapshot, type SnapshotField } from "@/server/modules/esign/pdf";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ templateId: z.string().min(1) });

/**
 * Fill a document template for this deal and file the PDF — no signature, no
 * signing link, nobody asked to click anything.
 *
 * This is `generateTemplatePreviewPdf`'s exact call into `generateSignedPdf`
 * (`signers: []`, `events: []`, `certificate: false`) with a real
 * AutofillContext instead of the sample one. No DocumentPackage row is created,
 * deliberately: a package is an envelope somebody has to sign, and one sitting
 * permanently at `draft` would show up forever in Sent for Signature.
 */
export const generateDocumentAction: AutomationActionModule = {
  type: "generate_document",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick the document template to generate." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no template.");

    const template = await prisma.documentTemplate.findFirst({
      where: { id: parsed.data.templateId, companyId: ctx.companyId },
      include: { fields: true },
    });
    if (!template) return fail("That document template no longer exists.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      include: LEAD_CTX_INCLUDE,
    });
    if (!lead) return fail("Deal not found.");

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
      select: { name: true },
    });

    const snapshot: Snapshot = {
      pages: (template.pages as unknown as Snapshot["pages"]) ?? [{ width: 612, height: 792 }],
      body: (template.body as unknown as Snapshot["body"]) ?? [],
      sourcePdfKey: template.sourcePdfKey ?? null,
      fields: template.fields.map((f) => ({
        id: f.id,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        type: f.type as SnapshotField["type"],
        signerRole: f.signerRole,
        label: f.label,
        valueToken: f.valueToken,
        defaultValue: f.defaultValue,
      })),
    };

    let sourcePdf: Buffer | null = null;
    if (template.sourcePdfKey) {
      try {
        sourcePdf = await getObject(template.sourcePdfKey);
      } catch {
        // A template whose uploaded PDF has gone missing would silently produce
        // a blank generated page. Say so instead.
        return fail("The template's source PDF could not be read.");
      }
    }

    const buffer = await generateSignedPdf({
      title: template.name,
      snapshot,
      ctx: ctxForLead(lead as unknown as LeadForCtx, company?.name ?? ""),
      values: {},
      sourcePdf,
      signers: [],
      events: [],
      certificate: false,
    });

    const name = `${template.name}.pdf`;
    const key = `companies/${ctx.companyId}/uploads/${nanoid()}-${name.replace(/[^a-z0-9.]+/gi, "-")}`;
    await putObject(key, buffer);

    await prisma.fileAsset.create({
      data: {
        companyId: ctx.companyId,
        kind: "document",
        name,
        storageKey: key,
        mimeType: "application/pdf",
        size: buffer.length,
        // NULL folderKey means Contract, matching every template that predates
        // routing. See deal-folders.ts.
        category: template.folderKey ?? "contract",
        leadId: ctx.leadId,
        uploadedById: null,
      },
    });

    return { type: "generate_document", ok: true, detail: `Generated ${name}.` };
  },
};

function fail(detail: string): StepResult {
  return { type: "generate_document", ok: false, detail };
}
```

- [ ] **Step 4: Register it**

In `src/server/modules/automations/registry.ts`:

```ts
import { generateDocumentAction } from "./actions/generate-document";
```

and inside `ACTION_REGISTRY`:

```ts
  [generateDocumentAction.type]: generateDocumentAction,
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/generate-document.itest.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/automations/actions/generate-document.ts src/server/modules/automations/registry.ts src/server/modules/automations/__tests__/generate-document.itest.ts
git commit -m "A document that fills itself in and puts itself away"
```

---

## Task 8: `compile_photos`

**Files:**
- Create: `src/server/modules/automations/actions/compile-photos.ts`
- Modify: `src/server/modules/automations/registry.ts`
- Test: `src/server/modules/automations/__tests__/compile-photos.itest.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/automations/__tests__/compile-photos.itest.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { putObject } from "@/server/storage";
import { compilePhotosAction } from "../actions/compile-photos";

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Photo Co", slug: `ph-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Nancy", lastName: "Moore", address: "107 Oak St" },
  });
  leadId = lead.id;

  const jpeg = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 40, g: 90, b: 160 } },
  }).jpeg().toBuffer();

  for (const n of [1, 2]) {
    const key = `companies/${companyId}/uploads/test-${n}.jpg`;
    await putObject(key, jpeg);
    await db.fileAsset.create({
      data: {
        companyId, leadId, kind: "photo", name: `Ridge ${n}.jpg`,
        storageKey: key, mimeType: "image/jpeg", size: jpeg.length,
        category: "install_photos",
      },
    });
  }
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const ctx = (config: unknown) => ({ companyId, vertical: "solar" as const, leadId, config, depth: 0 });

describe("compile_photos", () => {
  it("files one PDF into the same folder the photos are in", async () => {
    const res = await compilePhotosAction.run(ctx({ kind: "install" }));
    expect(res.ok).toBe(true);

    const pdf = await db.fileAsset.findFirst({
      where: { companyId, leadId, mimeType: "application/pdf" },
    });
    expect(pdf?.category).toBe("install_photos");
    expect(pdf!.size).toBeGreaterThan(1000);
  });

  it("uses roofing's folder key on a roofing deal", async () => {
    const lead = await db.lead.create({
      data: { companyId, vertical: "roofing", firstName: "R", lastName: "Deal" },
    });
    const jpeg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer();
    const key = `companies/${companyId}/uploads/roof.jpg`;
    await putObject(key, jpeg);
    await db.fileAsset.create({
      data: {
        companyId, leadId: lead.id, kind: "photo", name: "Slope.jpg",
        storageKey: key, mimeType: "image/jpeg", size: jpeg.length, category: "install",
      },
    });

    const res = await compilePhotosAction.run({
      companyId, vertical: "roofing", leadId: lead.id, config: { kind: "install" }, depth: 0,
    });
    expect(res.ok).toBe(true);
    const pdf = await db.fileAsset.findFirst({
      where: { companyId, leadId: lead.id, mimeType: "application/pdf" },
    });
    expect(pdf?.category).toBe("install");
  });

  it("fails rather than filing an empty report", async () => {
    const res = await compilePhotosAction.run(ctx({ kind: "site" }));
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no photos/i);
  });

  it("rejects a config with no checklist kind", () => {
    expect(compilePhotosAction.parseConfig({}).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/compile-photos.itest.ts
```

Expected: FAIL — `Cannot find module '../actions/compile-photos'`.

- [ ] **Step 3: Implement it**

```ts
// src/server/modules/automations/actions/compile-photos.ts
import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { renderPhotoReport, type ReportPhoto } from "@/server/modules/photos/report";
import { PHOTO_GROUPS, photoGroupFor } from "@/lib/photo-groups";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ kind: z.enum(["site", "install"]) });

/**
 * Compile a deal's photos into the branded report and FILE it.
 *
 * The renderer is the one the download route has always used. The only new
 * thing here is that the bytes are stored as a FileAsset instead of streamed to
 * whoever clicked, which is the whole difference between "somebody remembered"
 * and "it happened".
 *
 * The folder key comes from `photoGroupFor(vertical, kind)` — the same inverse
 * mapping the uploader uses — so the report lands in the folder its own photos
 * are in, under either vertical's spelling.
 */
export const compilePhotosAction: AutomationActionModule = {
  type: "compile_photos",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick which photo checklist to compile." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no checklist.");

    const group = photoGroupFor(ctx.vertical, parsed.data.kind);
    const def = PHOTO_GROUPS[group];

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: { firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
    });
    if (!lead) return fail("Deal not found.");

    const photos = await prisma.fileAsset.findMany({
      where: { companyId: ctx.companyId, leadId: ctx.leadId, kind: "photo", category: group },
      orderBy: { createdAt: "asc" },
      select: { storageKey: true, name: true },
    });
    // An empty report is a PDF of nothing filed on a customer's job. Fail so
    // somebody sees why, and so a later action in the rule does not run either.
    if (photos.length === 0) return fail(`No photos in ${def.label} to compile.`);

    const reportPhotos: ReportPhoto[] = photos.map((p) => ({
      storageKey: p.storageKey,
      label: def.reportSection,
      caption: p.name.replace(/\.[a-z0-9]+$/i, ""),
    }));

    const customer = `${lead.firstName} ${lead.lastName}`.trim();
    const address = [lead.address, [lead.city, lead.state, lead.zip].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join("  -  ");

    const bytes = await renderPhotoReport(reportPhotos, {
      reference: customer,
      customer,
      address,
      setLabel: def.label,
    });
    const buffer = Buffer.from(bytes);

    const name = `${def.label} Report.pdf`;
    const key = `companies/${ctx.companyId}/uploads/${nanoid()}-${name.replace(/[^a-z0-9.]+/gi, "-")}`;
    await putObject(key, buffer);

    await prisma.fileAsset.create({
      data: {
        companyId: ctx.companyId,
        kind: "document",
        name,
        storageKey: key,
        mimeType: "application/pdf",
        size: buffer.length,
        category: group,
        leadId: ctx.leadId,
        uploadedById: null,
      },
    });

    return {
      type: "compile_photos",
      ok: true,
      detail: `Compiled ${photos.length} ${def.label.toLowerCase()} into a PDF.`,
    };
  },
};

function fail(detail: string): StepResult {
  return { type: "compile_photos", ok: false, detail };
}
```

- [ ] **Step 4: Register it**

In `registry.ts`, import `compilePhotosAction` and add `[compilePhotosAction.type]: compilePhotosAction`.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/compile-photos.itest.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/automations/actions/compile-photos.ts src/server/modules/automations/registry.ts src/server/modules/automations/__tests__/compile-photos.itest.ts
git commit -m "The install photos compile themselves and file themselves"
```

---

## Task 9: `send_for_signature`

The one action needing a refactor: `sendForSignature` takes a `SessionUser`, and an automation has none.

**Files:**
- Modify: `src/server/modules/esign/service.ts`
- Create: `src/server/modules/automations/actions/send-for-signature.ts`
- Modify: `src/server/modules/automations/registry.ts`
- Test: `src/server/modules/automations/__tests__/send-for-signature.itest.ts`

- [ ] **Step 1: Split `sendForSignature` into a guard and a core**

In `service.ts`, change the signature of the existing function to take what it actually needs, and keep the guarded entry point as a thin wrapper. Replace lines 111-125 (the guard, template load and lead load) with:

```ts
export async function sendForSignature(user: SessionUser, input: SendInput) {
  requireCan(user, "create", "Document");

  // Scope check stays HERE, in the session-bearing wrapper: it is the only
  // place a user exists to scope against. The core below is reached by the
  // automation engine, which has no user and is instead trusted to have
  // resolved the company and workspace itself.
  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const visible = await prisma.lead.findFirst({
    where: { AND: [{ id: input.leadId }, leadScope] },
    select: { id: true },
  });
  if (!visible) throw new Error("Lead not found or access denied.");

  return createSignaturePackage({
    companyId: user.companyId,
    createdById: user.userId,
    input,
  });
}

/**
 * Create and send a signature envelope with NO session.
 *
 * The automation engine reaches this directly. It cannot go through
 * `sendForSignature` above, whose `requireCan` and `listScope` both need a
 * SessionUser — the same reason `leads/intake.ts` works straight against Prisma
 * for the public web form. Authorisation here is the caller's job: it must have
 * resolved companyId itself, and the workspace is enforced by the isolation
 * extension on every query below.
 */
export async function createSignaturePackage(args: {
  companyId: string;
  createdById: string | null;
  input: SendInput;
}) {
  const { companyId, input } = args;

  const template = await prisma.documentTemplate.findFirst({
    where: { id: input.templateId, companyId },
    include: { fields: true },
  });
  if (!template) throw new Error("Template not found.");

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId },
    include: { project: true },
  });
  if (!lead) throw new Error("Lead not found.");
```

Then in the rest of the original body, replace every `user.companyId` with `companyId` and every `user.userId` with `args.createdById`. The `fireEvent` call at line ~200 becomes:

```ts
  await fireEvent({ companyId, event: "document_sent", actorId: args.createdById, documentId: pkg.id, leadId: lead.id });
```

- [ ] **Step 2: Confirm the refactor changed no behaviour**

```bash
npm run typecheck
npx vitest run --config vitest.integration.config.ts src/server/modules/solar/__tests__/proposal-signing.itest.ts
```

Expected: typecheck clean, e-sign integration tests pass unchanged.

- [ ] **Step 3: Commit the refactor on its own**

A pure refactor commits separately from the feature that motivated it, so a bisect can tell them apart.

```bash
git add src/server/modules/esign/service.ts
git commit -m "Sending for signature needs a company, not necessarily a person"
```

- [ ] **Step 4: Write the failing test**

```ts
// src/server/modules/automations/__tests__/send-for-signature.itest.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { sendForSignatureAction } from "../actions/send-for-signature";

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let templateId: string;
let withEmail: string;
let withoutEmail: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Sign Co", slug: `sg-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const t = await db.documentTemplate.create({
    data: { companyId, vertical: "solar", name: "Lien Waiver", pages: [{ width: 612, height: 792 }] },
  });
  templateId = t.id;
  withEmail = (await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Has", lastName: "Email", email: "has@example.com" },
  })).id;
  withoutEmail = (await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "No", lastName: "Email" },
  })).id;
});

afterAll(async () => {
  await db.documentSigner.deleteMany({ where: { companyId } });
  await db.documentPackage.deleteMany({ where: { companyId } });
  await db.documentTemplate.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("send_for_signature", () => {
  it("creates a sent package addressed to the customer", async () => {
    const res = await sendForSignatureAction.run({
      companyId, vertical: "solar", leadId: withEmail,
      config: { templateId, signer: "customer" }, depth: 0,
    });
    expect(res.ok).toBe(true);

    const pkg = await db.documentPackage.findFirst({ where: { leadId: withEmail } });
    expect(pkg?.status).toBe("sent");

    const signer = await db.documentSigner.findFirst({ where: { packageId: pkg!.id } });
    expect(signer?.email).toBe("has@example.com");
  });

  it("fails rather than sending a document nowhere", async () => {
    const res = await sendForSignatureAction.run({
      companyId, vertical: "solar", leadId: withoutEmail,
      config: { templateId, signer: "customer" }, depth: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no email/i);
    expect(await db.documentPackage.count({ where: { leadId: withoutEmail } })).toBe(0);
  });

  it("rejects an unknown signer role", () => {
    expect(sendForSignatureAction.parseConfig({ templateId, signer: "the dog" }).ok).toBe(false);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/send-for-signature.itest.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6: Implement it**

```ts
// src/server/modules/automations/actions/send-for-signature.ts
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { createSignaturePackage } from "@/server/modules/esign/service";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({
  templateId: z.string().min(1),
  signer: z.enum(["customer", "co_owner", "assigned_rep"]),
});

/**
 * Send a template out for signature with nobody logged in.
 *
 * The signer is chosen by ROLE, never by name or address: a rule outlives the
 * deal it was written against, and the person who should sign is whoever holds
 * that role on whichever deal triggered it.
 */
export const sendForSignatureAction: AutomationActionModule = {
  type: "send_for_signature",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick a template and who should sign it." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no template or signer.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: {
        firstName: true, lastName: true, email: true,
        coOwnerName: true, coOwnerEmail: true,
        assignedRep: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!lead) return fail("Deal not found.");

    const target = resolveSigner(parsed.data.signer, lead);
    if (!target) return fail(`This deal has no ${label(parsed.data.signer)}.`);
    // A signature request with no address is a document sent nowhere. Fail so
    // the run log names the deal that is missing an email.
    if (!target.email) return fail(`The ${label(parsed.data.signer)} has no email on file.`);

    try {
      await createSignaturePackage({
        companyId: ctx.companyId,
        createdById: null,
        input: {
          templateId: parsed.data.templateId,
          leadId: ctx.leadId,
          signers: [{ role: target.role, name: target.name, email: target.email, order: 1 }],
        },
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Could not send the document.");
    }

    return { type: "send_for_signature", ok: true, detail: `Sent to ${target.name}.` };
  },
};

type Resolved = { name: string; email: string | null; role: "customer" | "co_customer" | "company_rep" };

function resolveSigner(
  which: "customer" | "co_owner" | "assigned_rep",
  lead: {
    firstName: string; lastName: string; email: string | null;
    coOwnerName: string | null; coOwnerEmail: string | null;
    assignedRep: { firstName: string; lastName: string; email: string } | null;
  }
): Resolved | null {
  if (which === "customer") {
    return { name: `${lead.firstName} ${lead.lastName}`.trim(), email: lead.email, role: "customer" };
  }
  if (which === "co_owner") {
    return lead.coOwnerName
      ? { name: lead.coOwnerName, email: lead.coOwnerEmail, role: "co_customer" }
      : null;
  }
  return lead.assignedRep
    ? {
        name: `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim(),
        email: lead.assignedRep.email,
        role: "company_rep",
      }
    : null;
}

function label(which: string): string {
  return which === "co_owner" ? "co-owner" : which === "assigned_rep" ? "assigned rep" : "customer";
}

function fail(detail: string): StepResult {
  return { type: "send_for_signature", ok: false, detail };
}
```

**Check before you run:** confirm `Lead.coOwnerEmail` exists in `prisma/schema.prisma`. If the column is named differently, use the real name; if there is no co-owner email column at all, drop `co_owner` from the `signer` enum in this file and from `ACTION_DEFS`, and say so in the commit message.

- [ ] **Step 7: Register it and run the tests**

Add to `registry.ts`, then:

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/send-for-signature.itest.ts
```

Expected: PASS, 3 tests. No email is actually delivered — with no `RESEND_API_KEY` the delivery helper logs to console. Never add `RESEND_API_KEY` to your local env.

- [ ] **Step 8: Commit**

```bash
git add src/server/modules/automations/actions/send-for-signature.ts src/server/modules/automations/registry.ts src/server/modules/automations/__tests__/send-for-signature.itest.ts
git commit -m "A contract that sends itself to whoever holds the role"
```

---

## Task 10: Wire the three event triggers

Five call sites. No new logic — the engine already works.

**Files:**
- Modify: `src/server/modules/leads/actions.ts`
- Modify: `src/server/modules/esign/service.ts`
- Modify: `src/server/modules/files/actions.ts`
- Create: `src/server/modules/automations/checklist.ts`
- Test: `src/server/modules/automations/__tests__/checklist.itest.ts`

- [ ] **Step 1: Fire `stage_entered` from both stage-move paths**

In `src/server/modules/leads/actions.ts`, directly after the `fireEvent({ ..., event: "stage_changed", ... })` call at ~line 165:

```ts
  await runAutomations({
    companyId: user.companyId,
    vertical: await getActiveVertical(user),
    trigger: "stage_entered",
    leadId: parsed.data.leadId,
    payload: { stageId: parsed.data.stageId },
    depth: 0,
  });
```

And after the second one at ~line 259 (the cancel path), the same with `leadId: lead.id` and `payload: { stageId: stage.id }`.

Add the imports:

```ts
import { runAutomations } from "@/server/modules/automations/engine";
import { getActiveVertical } from "@/server/auth/vertical";
```

If `getActiveVertical` is already imported in that file, reuse it.

- [ ] **Step 2: Fire `document_completed`**

In `src/server/modules/esign/service.ts`, after the `fireEvent` at ~line 736:

```ts
  if (pkg.leadId) {
    await runAutomations({
      companyId: pkg.companyId,
      vertical: pkg.vertical,
      trigger: "document_completed",
      leadId: pkg.leadId,
      payload: { templateId: pkg.templateId ?? undefined },
      depth: 0,
    });
  }
```

`DocumentPackage` carries its own `vertical`, so no session lookup is needed — which matters, because this path runs from a public signing link with no session at all.

- [ ] **Step 3: Write the failing checklist test**

```ts
// src/server/modules/automations/__tests__/checklist.itest.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { checklistJustCompleted } from "../checklist";

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let templateId: string;
let required1: string;
let required2: string;
let optional: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Checklist Co", slug: `cl-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const t = await db.photoTemplate.create({
    data: { companyId, vertical: "solar", name: "Install", kind: "install" },
  });
  templateId = t.id;
  required1 = (await db.photoTemplateItem.create({
    data: { templateId, label: "Array", required: true, position: 0 },
  })).id;
  required2 = (await db.photoTemplateItem.create({
    data: { templateId, label: "Inverter", required: true, position: 1 },
  })).id;
  optional = (await db.photoTemplateItem.create({
    data: { templateId, label: "Extra", required: false, position: 2 },
  })).id;
});

afterAll(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.photoTemplateItem.deleteMany({ where: { templateId } });
  await db.photoTemplate.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  leadId = (await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "C", lastName: "L" },
  })).id;
});

async function shoot(itemId: string) {
  await db.fileAsset.create({
    data: {
      companyId, leadId, kind: "photo", name: `${itemId}.jpg`,
      storageKey: `k/${itemId}/${Math.random()}`, mimeType: "image/jpeg",
      size: 10, photoTemplateItemId: itemId, category: "install_photos",
    },
  });
}

describe("checklistJustCompleted", () => {
  it("is false while a required slot is still empty", async () => {
    await shoot(required1);
    expect(await checklistJustCompleted(companyId, leadId, required1)).toBe(null);
  });

  it("returns the kind on the upload that completes it", async () => {
    await shoot(required1);
    await shoot(required2);
    expect(await checklistJustCompleted(companyId, leadId, required2)).toBe("install");
  });

  it("ignores optional slots", async () => {
    await shoot(required1);
    await shoot(required2);
    expect(await checklistJustCompleted(companyId, leadId, required2)).toBe("install");
    // Still complete, but this upload did not complete it.
    await shoot(optional);
    expect(await checklistJustCompleted(companyId, leadId, optional)).toBe(null);
  });

  it("does not re-fire on a second shot into an already-full slot", async () => {
    await shoot(required1);
    await shoot(required2);
    expect(await checklistJustCompleted(companyId, leadId, required2)).toBe("install");
    await shoot(required2);
    expect(await checklistJustCompleted(companyId, leadId, required2)).toBe(null);
  });
});
```

The last two cases are the whole point: the trigger fires on the **transition** to complete, not on every upload into a finished checklist.

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/checklist.itest.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement the transition check**

```ts
// src/server/modules/automations/checklist.ts
import { prisma } from "@/server/db/client";

/**
 * Did THIS upload just complete the checklist?
 *
 * Returns the checklist's kind if so, null otherwise.
 *
 * "Just" is load-bearing. A crew re-shooting one slot on a finished checklist
 * must not recompile the report and move the job a second time. So the answer
 * is yes only when every required slot is now filled AND the slot this photo
 * landed in held nothing before it — i.e. this upload is the one that closed
 * the last gap.
 *
 * The `once` guard on a rule is a backstop for this, not a substitute: a rule
 * may deliberately be set to repeat, and it should still repeat only when the
 * checklist genuinely completes again.
 */
export async function checklistJustCompleted(
  companyId: string,
  leadId: string,
  photoTemplateItemId: string
): Promise<"site" | "install" | null> {
  const item = await prisma.photoTemplateItem.findFirst({
    where: { id: photoTemplateItemId, template: { companyId } },
    select: { id: true, required: true, template: { select: { id: true, kind: true } } },
  });
  if (!item) return null;

  // A photo into an optional slot can never be the one that completes it.
  if (!item.required) return null;

  const required = await prisma.photoTemplateItem.findMany({
    where: { templateId: item.template.id, required: true },
    select: { id: true },
  });
  if (required.length === 0) return null;

  const shots = await prisma.fileAsset.groupBy({
    by: ["photoTemplateItemId"],
    where: {
      companyId,
      leadId,
      kind: "photo",
      photoTemplateItemId: { in: required.map((r) => r.id) },
    },
    _count: { _all: true },
  });

  const counts = new Map(shots.map((s) => [s.photoTemplateItemId, s._count._all]));
  const allFilled = required.every((r) => (counts.get(r.id) ?? 0) > 0);
  if (!allFilled) return null;

  // This slot held exactly one photo before? Then this upload is the one that
  // closed it. More than one, and the slot was already filled.
  if ((counts.get(item.id) ?? 0) !== 1) return null;

  return item.template.kind as "site" | "install";
}
```

- [ ] **Step 6: Run the test**

```bash
npx vitest run --config vitest.integration.config.ts src/server/modules/automations/__tests__/checklist.itest.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Call it from the uploader**

In `src/server/modules/files/actions.ts`, at the end of `uploadFileAction`, immediately before the `revalidatePath` calls:

```ts
  if (photoTemplateItemId && dealLeadId) {
    const kind = await checklistJustCompleted(user.companyId, dealLeadId, photoTemplateItemId);
    if (kind) {
      await runAutomations({
        companyId: user.companyId,
        vertical: lead?.vertical ?? project?.vertical ?? (await getActiveVertical(user)),
        trigger: "photo_checklist_completed",
        leadId: dealLeadId,
        payload: { kind },
        depth: 0,
      });
    }
  }
```

with the imports:

```ts
import { runAutomations } from "@/server/modules/automations/engine";
import { checklistJustCompleted } from "@/server/modules/automations/checklist";
```

- [ ] **Step 8: Verify nothing regressed**

```bash
npm run typecheck
npm run lint
npx vitest run --config vitest.integration.config.ts src/server/modules/automations
```

Expected: clean, and every automation integration test passes.

- [ ] **Step 9: Commit**

```bash
git add src/server/modules/automations/checklist.ts src/server/modules/automations/__tests__/checklist.itest.ts src/server/modules/leads/actions.ts src/server/modules/esign/service.ts src/server/modules/files/actions.ts
git commit -m "Three things that already happen now also set automations off"
```

---

## Task 11: The stage-age cron

**Files:**
- Create: `src/app/api/cron/automations/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Read an existing cron for the auth pattern**

```bash
cat src/app/api/cron/stage-alerts/route.ts
```

Copy its authorisation check (the `CRON_SECRET` bearer check) exactly. Do not invent a different one.

- [ ] **Step 2: Write the route**

```ts
// src/app/api/cron/automations/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { runAutomations } from "@/server/modules/automations/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily pass for `stage_age_exceeded` rules.
 *
 * The only trigger with no user action behind it, so it is also the only one
 * with no ambient workspace — every company/vertical pass is wrapped in
 * `runInVertical` so the isolation extension can scope the rule query.
 *
 * VERIFY THIS ON A PRODUCTION BUILD. `next dev` loads context.ts twice and
 * `runInVertical` silently no-ops there, which would make a solar rule fire on
 * roofing deals without a single error in the log.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // An unextended client: this route deliberately reads ACROSS workspaces to
  // find the work, then re-enters each one scoped to run it.
  const raw = new PrismaClient();
  let fired = 0;

  try {
    const rules = await raw.automationRule.findMany({
      where: { trigger: "stage_age_exceeded", active: true },
      select: { id: true, companyId: true, vertical: true, conditions: true },
    });

    for (const rule of rules) {
      const cond = rule.conditions && typeof rule.conditions === "object"
        ? (rule.conditions as { stageId?: string; days?: number })
        : {};
      if (!cond.stageId || !cond.days) continue;

      const cutoff = new Date(Date.now() - cond.days * 24 * 60 * 60 * 1000);

      // Deals sitting in that stage right now, entered before the cutoff.
      const stuck = await raw.leadStageEvent.findMany({
        where: {
          exitedAt: null,
          stageId: cond.stageId,
          enteredAt: { lte: cutoff },
          lead: { companyId: rule.companyId, vertical: rule.vertical, status: "open" },
        },
        select: { leadId: true, enteredAt: true },
      });

      for (const s of stuck) {
        const days = Math.floor((Date.now() - s.enteredAt.getTime()) / (24 * 60 * 60 * 1000));
        // No runInVertical here: the engine establishes the workspace itself
        // from the vertical passed in. See Corrections, item 1.
        await runAutomations({
          companyId: rule.companyId,
          vertical: rule.vertical,
          trigger: "stage_age_exceeded",
          leadId: s.leadId,
          payload: { stageId: cond.stageId, days },
          depth: 0,
        });
        fired++;
      }
    }
  } finally {
    await raw.$disconnect();
  }

  return NextResponse.json({ ok: true, fired });
}
```

A `once: true` rule will not re-fire day after day — the `AutomationRun` row from the first pass stops it. That is exactly why `once` defaults to on.

**Check `runInVertical`'s real signature** before running — if it takes an options object rather than a bare vertical, match it.

- [ ] **Step 3: Register the cron**

In `vercel.json`, add to the `crons` array:

```json
    { "path": "/api/cron/automations", "schedule": "0 15 * * *" }
```

15:00 UTC, after the existing stage-alerts and overdue-digest jobs so a deal is not chased twice in one minute.

- [ ] **Step 4: Verify on a production build**

```bash
npm run build && npm start
```

Then in another terminal:

```bash
curl -s localhost:3000/api/cron/automations | head
```

Expected: `{"ok":true,"fired":0}` with no stage-age rules configured. **Do not test this on `npm run dev`** — the result there is meaningless.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/automations/route.ts vercel.json
git commit -m "A deal that has waited too long can set an automation off too"
```

---

## Task 12: Settings CRUD server actions

**Files:**
- Create: `src/server/modules/automations/actions.server.ts`
- Test: `src/server/modules/automations/__tests__/rule-validation.test.ts`

- [ ] **Step 1: Write the failing validation test**

```ts
// src/server/modules/automations/__tests__/rule-validation.test.ts
import { describe, it, expect } from "vitest";
import { validateRule } from "../actions.server";

const base = {
  name: "Installed paperwork",
  trigger: "stage_entered" as const,
  conditions: { stageId: "stage-1" },
  actions: [{ type: "generate_document", templateId: "t1" }],
  once: true,
  active: true,
};

describe("validateRule", () => {
  it("accepts a well-formed rule", () => {
    expect(validateRule(base).ok).toBe(true);
  });

  it("rejects a rule with no actions", () => {
    const r = validateRule({ ...base, actions: [] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/at least one action/i);
  });

  it("rejects an unknown action type", () => {
    expect(validateRule({ ...base, actions: [{ type: "launch_rocket" }] }).ok).toBe(false);
  });

  it("rejects an action whose config is incomplete", () => {
    expect(validateRule({ ...base, actions: [{ type: "generate_document" }] }).ok).toBe(false);
  });

  it("refuses a stage rule that moves the deal back to its own trigger stage", () => {
    const r = validateRule({
      ...base,
      actions: [{ type: "move_stage", stageId: "stage-1" }],
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/same stage/i);
  });

  it("allows moving to a different stage", () => {
    expect(
      validateRule({ ...base, actions: [{ type: "move_stage", stageId: "stage-2" }] }).ok
    ).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(validateRule({ ...base, name: "  " }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/server/modules/automations/__tests__/rule-validation.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the actions**

```ts
// src/server/modules/automations/actions.server.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { actionFor } from "./registry";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum(["stage_entered", "photo_checklist_completed", "document_completed", "stage_age_exceeded"]),
  conditions: z.record(z.string(), z.unknown()).default({}),
  // Deliberately NOT `.min(1)`: zod's own "Array must contain at least 1
  // element(s)" is not a sentence to show somebody building a rule. The
  // explicit check in validateRule below owns that message.
  actions: z.array(z.record(z.string(), z.unknown())),
  once: z.boolean().default(true),
  active: z.boolean().default(true),
});

export type RuleInput = z.infer<typeof schema>;

export type Validated =
  | { ok: true; value: RuleInput }
  | { ok: false; error: string };

/**
 * Everything a rule must satisfy before it is stored.
 *
 * Exported and pure so it can be unit-tested without a session — and so the
 * editor can show the same message the server would give.
 */
export function validateRule(input: unknown): Validated {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule." };
  }
  const value = parsed.data;

  if (value.actions.length === 0) return { ok: false, error: "A rule needs at least one action." };

  for (const raw of value.actions) {
    const mod = actionFor(raw.type);
    if (!mod) return { ok: false, error: `Unknown action "${String(raw.type)}".` };
    const cfg = mod.parseConfig(raw);
    if (!cfg.ok) return { ok: false, error: cfg.error };
  }

  // A rule triggered by landing in a stage must not move the deal back to that
  // same stage. It is the shortest possible loop, and the depth guard would
  // catch it only after three needless runs.
  if (value.trigger === "stage_entered") {
    const from = value.conditions.stageId;
    if (typeof from === "string") {
      const back = value.actions.some((a) => a.type === "move_stage" && a.stageId === from);
      if (back) return { ok: false, error: "A rule cannot move a deal to the same stage that triggered it." };
    }
  }

  return { ok: true, value };
}

function fail(error: string) {
  return { ok: false as const, error };
}

export async function createAutomationRuleAction(input: RuleInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const v = validateRule(input);
  if (!v.ok) return fail(v.error);

  await prisma.automationRule.create({
    data: {
      companyId: user.companyId,
      name: v.value.name,
      trigger: v.value.trigger,
      conditions: v.value.conditions as Prisma.InputJsonValue,
      actions: v.value.actions as Prisma.InputJsonValue,
      once: v.value.once,
      active: v.value.active,
    },
  });
  // vertical is stamped by the isolation extension from the ambient workspace.
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

export async function updateAutomationRuleAction(id: string, input: RuleInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const v = validateRule(input);
  if (!v.ok) return fail(v.error);

  const existing = await prisma.automationRule.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return fail("Rule not found.");

  await prisma.automationRule.update({
    where: { id },
    data: {
      name: v.value.name,
      trigger: v.value.trigger,
      conditions: v.value.conditions as Prisma.InputJsonValue,
      actions: v.value.actions as Prisma.InputJsonValue,
      once: v.value.once,
      active: v.value.active,
    },
  });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

export async function toggleAutomationRuleAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.automationRule.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return fail("Rule not found.");
  await prisma.automationRule.update({ where: { id }, data: { active } });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

export async function deleteAutomationRuleAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.automationRule.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return fail("Rule not found.");
  await prisma.automationRule.delete({ where: { id } });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}
```

**If `"use server"` forbids exporting the non-async `validateRule`** (Next.js requires every export of a `"use server"` module to be an async function), move `validateRule` into `src/server/modules/automations/validate.ts` with no directive, import it here, and point the test at the new path. Do that rather than making it async.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/server/modules/automations/__tests__/rule-validation.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/automations
git commit -m "A rule is checked before it is stored, not when it fires"
```

---

## Task 13: The Settings page

**Files:**
- Create: `src/app/portal/settings/automations/page.tsx`
- Create: `src/components/portal/automation-rules-manager.tsx`
- Modify: `src/lib/settings-sections.ts`
- Modify: `src/server/modules/settings/inventory.ts`

- [ ] **Step 1: Read the component you are modelling this on**

```bash
sed -n '1,302p' src/components/portal/notification-rules-manager.tsx
```

Match its structure: a `RuleDialog` for create, a `RuleRow` per rule with inline edit and delete, `toast` for feedback, `useRouter().refresh()` after a mutation. Do not invent new UI vocabulary.

- [ ] **Step 2: Write the page**

```tsx
// src/app/portal/settings/automations/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { AutomationRulesManager } from "@/components/portal/automation-rules-manager";

const PROJECT_STATUSES = [
  "not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled",
];

export const metadata = { title: "Automations" };

export default async function AutomationSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");
  const vertical = await getActiveVertical(user);

  const [rules, pipeline, templates, checklists, runs] = await Promise.all([
    prisma.automationRule.findMany({ where: { companyId: user.companyId }, orderBy: { createdAt: "desc" } }),
    prisma.pipeline.findFirst({
      where: { companyId: user.companyId },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
    prisma.documentTemplate.findMany({
      where: { companyId: user.companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.photoTemplate.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    }),
    prisma.automationRun.findMany({
      where: { companyId: user.companyId },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        rule: { select: { name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Automations"
        description="When a deal hits a milestone, do the paperwork — generate a document, send it for signature, compile the photos, move the job on."
      />
      <AutomationRulesManager
        vertical={vertical}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          trigger: r.trigger,
          conditions: r.conditions as Record<string, unknown>,
          actions: (r.actions as Record<string, unknown>[]) ?? [],
          once: r.once,
          active: r.active,
        }))}
        stages={(pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }))}
        templates={templates}
        checklists={checklists.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        statuses={PROJECT_STATUSES}
        runs={runs.map((r) => ({
          id: r.id,
          ruleName: r.rule.name,
          status: r.status,
          steps: (r.steps as { type: string; ok: boolean; detail: string }[]) ?? [],
          error: r.error,
          startedAt: r.startedAt.toISOString(),
          lead: r.lead ? { id: r.lead.id, name: `${r.lead.firstName} ${r.lead.lastName}`.trim() } : null,
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the manager component**

```tsx
// src/components/portal/automation-rules-manager.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Zap, CheckCircle2, XCircle, MinusCircle, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createAutomationRuleAction, updateAutomationRuleAction,
  toggleAutomationRuleAction, deleteAutomationRuleAction,
} from "@/server/modules/automations/actions.server";
import { TRIGGER_DEFS, ACTION_DEFS, triggerLabel, actionLabel } from "@/server/modules/automations/types";

type Option = { id: string; name: string };
type Checklist = { id: string; name: string; kind: string };
type Cfg = Record<string, unknown>;

type Rule = {
  id: string;
  name: string;
  trigger: string;
  conditions: Cfg;
  actions: Cfg[];
  once: boolean;
  active: boolean;
};

type Run = {
  id: string;
  ruleName: string;
  status: string;
  steps: { type: string; ok: boolean; detail: string }[];
  error: string | null;
  startedAt: string;
  lead: { id: string; name: string } | null;
};

type Props = {
  vertical: string;
  rules: Rule[];
  stages: Option[];
  templates: Option[];
  checklists: Checklist[];
  statuses: string[];
  runs: Run[];
};

const SIGNERS = [
  { value: "customer", label: "the customer" },
  { value: "co_owner", label: "the co-owner" },
  { value: "assigned_rep", label: "the assigned rep" },
];

export function AutomationRulesManager(props: Props) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end">
        <RuleDialog {...props} />
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {props.rules.length === 0 && (
          <div className="space-y-1 px-5 py-10 text-center text-sm text-muted-foreground">
            <p>No automations yet, so nothing happens on its own in this workspace.</p>
            <p className="text-xs">Rules do not carry across workspaces.</p>
          </div>
        )}
        {props.rules.map((r) => (
          <RuleRow key={r.id} rule={r} {...props} />
        ))}
      </div>

      <RunsPanel runs={props.runs} />
    </div>
  );
}

// --- One rule --------------------------------------------------------------

function RuleRow({ rule, ...props }: Props & { rule: Rule }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggle(active: boolean) {
    setBusy(true);
    try {
      const res = await toggleAutomationRuleAction(rule.id, active);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    } finally {
      // ALWAYS in a finally: a thrown action that leaves this true is a row
      // whose controls never come back to life.
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await deleteAutomationRuleAction(rule.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Automation deleted.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3 px-5 py-4">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
        <Zap className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{rule.name}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {sentence(rule, props)}
        </p>
        {!rule.once && (
          <p className="mt-1 text-xs text-muted-foreground">Repeats every time it matches.</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Switch checked={rule.active} onCheckedChange={toggle} disabled={busy} aria-label="Active" />
        <RuleDialog {...props} existing={rule} />
        <Button variant="ghost" size="icon" onClick={remove} disabled={busy} aria-label="Delete automation">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

/** "When a deal lands in Installed → generate Certificate of Acceptance, move to Inspection" */
function sentence(rule: Rule, props: Props): string {
  const def = TRIGGER_DEFS.find((t) => t.value === rule.trigger);
  const where = conditionLabel(rule, props);
  const what = rule.actions.map((a) => actionSummary(a, props)).join(", ");
  return `When a deal ${def?.blurb ?? triggerLabel(rule.trigger)}${where} → ${what || "nothing yet"}`;
}

function conditionLabel(rule: Rule, props: Props): string {
  const c = rule.conditions;
  if (rule.trigger === "stage_entered") {
    const s = props.stages.find((x) => x.id === c.stageId);
    return s ? ` (${s.name})` : "";
  }
  if (rule.trigger === "stage_age_exceeded") {
    const s = props.stages.find((x) => x.id === c.stageId);
    return s ? ` (${s.name}, ${String(c.days ?? "?")} days)` : "";
  }
  if (rule.trigger === "photo_checklist_completed") return c.kind ? ` (${String(c.kind)})` : "";
  if (rule.trigger === "document_completed") {
    const t = props.templates.find((x) => x.id === c.templateId);
    return t ? ` (${t.name})` : "";
  }
  return "";
}

function actionSummary(a: Cfg, props: Props): string {
  switch (a.type) {
    case "generate_document":
      return `generate ${props.templates.find((t) => t.id === a.templateId)?.name ?? "a document"}`;
    case "send_for_signature":
      return `send ${props.templates.find((t) => t.id === a.templateId)?.name ?? "a document"} to ${
        SIGNERS.find((s) => s.value === a.signer)?.label ?? "a signer"
      }`;
    case "move_stage":
      return `move to ${props.stages.find((s) => s.id === a.stageId)?.name ?? "a stage"}`;
    case "set_project_status":
      return `set status to ${String(a.status ?? "?")}`;
    case "compile_photos":
      return `compile the ${String(a.kind ?? "")} photos`;
    default:
      return actionLabel(String(a.type));
  }
}

// --- Create / edit ---------------------------------------------------------

function RuleDialog({ existing, ...props }: Props & { existing?: Rule }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [name, setName] = React.useState(existing?.name ?? "");
  const [trigger, setTrigger] = React.useState(existing?.trigger ?? "stage_entered");
  const [conditions, setConditions] = React.useState<Cfg>(existing?.conditions ?? {});
  const [actions, setActions] = React.useState<Cfg[]>(existing?.actions ?? []);
  const [once, setOnce] = React.useState(existing?.once ?? true);

  const def = TRIGGER_DEFS.find((t) => t.value === trigger);

  function setTriggerAndClearCondition(v: string) {
    setTrigger(v);
    // A stage id means nothing to a document trigger. Clearing it is what stops
    // a stale condition silently matching everything after an edit.
    setConditions({});
  }

  async function save() {
    setBusy(true);
    try {
      const input = { name, trigger: trigger as never, conditions, actions, once, active: existing?.active ?? true };
      const res = existing
        ? await updateAutomationRuleAction(existing.id, input)
        : await createAutomationRuleAction(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(existing ? "Automation updated." : "Automation created.");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? (
          <Button variant="ghost" size="sm">Edit</Button>
        ) : (
          <Button size="sm"><Plus className="mr-1.5 size-4" /> New automation</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit automation" : "New automation"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Installed paperwork"
            />
          </div>

          <div className="space-y-1.5">
            <Label>When</Label>
            <Select value={trigger} onValueChange={setTriggerAndClearCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_DEFS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ConditionControl
              kind={def?.condition ?? "stage"}
              value={conditions}
              onChange={setConditions}
              {...props}
            />
          </div>

          <div className="space-y-2">
            <Label>Then, in order</Label>
            {actions.length === 0 && (
              <p className="text-sm text-muted-foreground">No actions yet — a rule needs at least one.</p>
            )}
            {actions.map((a, i) => (
              <ActionRow
                key={i}
                value={a}
                onChange={(next) => setActions(actions.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setActions(actions.filter((_, j) => j !== i))}
                onMoveUp={i === 0 ? undefined : () => {
                  const next = [...actions];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  setActions(next);
                }}
                {...props}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActions([...actions, { type: "generate_document" }])}
            >
              <Plus className="mr-1.5 size-4" /> Add action
            </Button>
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Switch checked={once} onCheckedChange={setOnce} />
            <span className="text-sm">
              Run at most once per deal
              <span className="block text-xs text-muted-foreground">
                Off means it runs every time the trigger matches.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={busy || !name.trim() || actions.length === 0}>
            {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConditionControl(
  props: Props & { kind: string; value: Cfg; onChange: (v: Cfg) => void }
) {
  const { kind, value, onChange } = props;

  if (kind === "stage" || kind === "stage_age") {
    return (
      <div className="flex flex-wrap gap-2">
        <Select
          value={(value.stageId as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, stageId: v })}
        >
          <SelectTrigger className="min-w-52 flex-1"><SelectValue placeholder="Any stage" /></SelectTrigger>
          <SelectContent>
            {props.stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === "stage_age" && (
          <Input
            type="number"
            min={1}
            className="w-28"
            placeholder="days"
            value={(value.days as number) ?? ""}
            onChange={(e) => onChange({ ...value, days: Number(e.target.value) || undefined })}
            aria-label="Days in stage"
          />
        )}
      </div>
    );
  }

  if (kind === "checklist") {
    return (
      <Select value={(value.kind as string) ?? ""} onValueChange={(v) => onChange({ kind: v })}>
        <SelectTrigger><SelectValue placeholder="Any checklist" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="site">Site / survey photos</SelectItem>
          <SelectItem value="install">Install photos</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={(value.templateId as string) ?? ""} onValueChange={(v) => onChange({ templateId: v })}>
      <SelectTrigger><SelectValue placeholder="Any document" /></SelectTrigger>
      <SelectContent>
        {props.templates.map((t) => (
          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActionRow(
  props: Props & {
    value: Cfg;
    onChange: (v: Cfg) => void;
    onRemove: () => void;
    onMoveUp?: () => void;
  }
) {
  const { value, onChange } = props;
  const def = ACTION_DEFS.find((a) => a.value === value.type);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <button
        type="button"
        onClick={props.onMoveUp}
        disabled={!props.onMoveUp}
        className="text-muted-foreground disabled:opacity-30"
        aria-label="Move action up"
      >
        <GripVertical className="size-4" />
      </button>

      <Select value={String(value.type ?? "")} onValueChange={(v) => onChange({ type: v })}>
        <SelectTrigger className="min-w-56 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ACTION_DEFS.map((a) => (
            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(def?.config === "template" || def?.config === "template_signer") && (
        <Select
          value={(value.templateId as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, templateId: v })}
        >
          <SelectTrigger className="min-w-48"><SelectValue placeholder="Which document" /></SelectTrigger>
          <SelectContent>
            {props.templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "template_signer" && (
        <Select
          value={(value.signer as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, signer: v })}
        >
          <SelectTrigger className="min-w-40"><SelectValue placeholder="Who signs" /></SelectTrigger>
          <SelectContent>
            {SIGNERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "stage" && (
        <Select
          value={(value.stageId as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, stageId: v })}
        >
          <SelectTrigger className="min-w-48"><SelectValue placeholder="Which stage" /></SelectTrigger>
          <SelectContent>
            {props.stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "project_status" && (
        <Select
          value={(value.status as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, status: v })}
        >
          <SelectTrigger className="min-w-44"><SelectValue placeholder="Which status" /></SelectTrigger>
          <SelectContent>
            {props.statuses.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "checklist" && (
        <Select value={(value.kind as string) ?? ""} onValueChange={(v) => onChange({ ...value, kind: v })}>
          <SelectTrigger className="min-w-44"><SelectValue placeholder="Which photos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="site">Site / survey photos</SelectItem>
            <SelectItem value="install">Install photos</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Button variant="ghost" size="icon" onClick={props.onRemove} aria-label="Remove action">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// --- Runs ------------------------------------------------------------------

function RunsPanel({ runs }: { runs: Run[] }) {
  const failures = runs.filter((r) => r.status === "failed").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Recent runs</h2>
        {failures > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            {failures} failed
          </span>
        )}
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {runs.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nothing has run yet. This is where an automation that fails shows up.
          </p>
        )}
        {runs.map((run) => (
          <div key={run.id} className="flex gap-3 px-5 py-3">
            <span className="mt-0.5 shrink-0">
              {run.status === "succeeded" && <CheckCircle2 className="size-4 text-emerald-600" />}
              {run.status === "failed" && <XCircle className="size-4 text-red-600" />}
              {run.status === "skipped" && <MinusCircle className="size-4 text-muted-foreground" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{run.ruleName}</span>
                {run.lead && (
                  <Link href={`/portal/leads/${run.lead.id}`} className="text-sm text-muted-foreground hover:underline">
                    {run.lead.name}
                  </Link>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {run.steps.map((s, i) => (
                  <li key={i} className={s.ok ? "text-xs text-muted-foreground" : "text-xs text-red-600 dark:text-red-400"}>
                    {actionLabel(s.type)} — {s.detail}
                  </li>
                ))}
              </ul>
              {run.error && run.steps.length === 0 && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{run.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Note the `finally { setBusy(false) }` in every handler — per `busy-flag-latch`, a busy flag left true by a thrown action is a control that never comes back to life.

- [ ] **Step 4: Add the hub card**

In `src/lib/settings-sections.ts`, add `"automations"` to the `SettingsSectionKey` union, import `Zap` from lucide-react (check first — it may already be imported), and add to `SETTINGS_SECTIONS` in the `money` group, after the document-templates card:

```ts
  {
    icon: Zap,
    key: "automations",
    title: "Automations",
    body: "Do the paperwork when a deal hits a milestone.",
    href: "/portal/settings/automations",
    group: "money",
    keywords: ["workflow", "trigger", "rules", "milestone", "auto", "generate"],
  },
```

- [ ] **Step 5: Add the hub count**

In `src/server/modules/settings/inventory.ts` there is one destructured `Promise.all`. Three edits, all inside it.

Add to the destructuring list (~line 77), after `notificationRules`:

```ts
    notificationRules,
    automationRules,
```

Add the matching query (~line 99), after the `notificationRule.count`:

```ts
    prisma.notificationRule.count({ where: { companyId } }),
    prisma.automationRule.count({ where: { companyId } }),
```

The two lists are positional — add to both or every count below shifts by one.

Then in the returned `inventory` object (~line 175), after `notification_rules`:

```ts
    notification_rules: countLabel(notificationRules, "rule"),
    automations: countLabel(automationRules, "automation"),
```

`SettingsInventory` is keyed by `SettingsSectionKey`, so this will not typecheck until Step 4 added `"automations"` to that union.

- [ ] **Step 6: Verify it renders**

```bash
npm run typecheck && npm run lint
npm run dev
```

Open `http://localhost:3000/portal/settings/automations`. Create a rule: "When a deal lands in Installed → compile the install photos, move to Inspection". Confirm it appears as a sentence in the list.

If you see "Unknown field automationRule", your dev server predates the migration — restart it.

- [ ] **Step 7: Commit**

```bash
git add src/app/portal/settings/automations src/components/portal/automation-rules-manager.tsx src/lib/settings-sections.ts src/server/modules/settings/inventory.ts
git commit -m "Automations get a page, and every run gets a receipt"
```

---

## Task 14: End-to-end proof

**Files:**
- Create: `e2e/automations.spec.ts`

- [ ] **Step 1: Write the spec**

Modelled on `e2e/deal-stage-actions.spec.ts` — same `login` helper, same `openDeal`
helper, same `deal-stage-advance` testid. `admin@anexahomes.com` is the account
the notification-settings spec uses, and it is the one with Settings write access.

```ts
// e2e/automations.spec.ts
import { test, expect, type Page } from "@playwright/test";

/**
 * The whole promise of the feature in one pass: a rule written in Settings
 * makes a real document appear on a real deal with nobody clicking anything.
 *
 * The rule is built AROUND the deal rather than the other way round — the spec
 * reads the stage the Advance button is about to land on and writes the rule
 * for that stage. Hard-coding a stage name would make this fail the first time
 * somebody reorders the seeded pipeline.
 */

const PASSWORD = "Passw0rd!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

async function openDeal(page: Page) {
  await page.goto("/portal/pipeline");
  await page.getByRole("button", { name: "List" }).click();
  await page.locator('table a[href^="/portal/leads/"]').first().click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]+$/, { timeout: 15000 });
  await expect(page.getByTestId("deal-stage-bar")).toBeVisible();
}

test("a stage move fires the rule and files the document", async ({ page }) => {
  await login(page, "admin@anexahomes.com");

  // 1. Find out where this deal is about to go.
  await openDeal(page);
  const dealUrl = page.url();
  const target = (await page.getByTestId("deal-stage-advance").innerText()).trim();
  expect(target).not.toBe("");

  // 2. Write a rule for exactly that stage.
  await page.goto("/portal/settings/automations");
  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByLabel("Name").fill("E2E paperwork");

  await page.getByRole("combobox").nth(1).click(); // the condition: which stage
  await page.getByRole("option", { name: target, exact: true }).click();

  await page.getByRole("button", { name: "Add action" }).click();
  await page.getByRole("combobox", { name: /which document/i }).click();
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("E2E paperwork")).toBeVisible();

  // 3. Move the deal. Nobody touches the document.
  await page.goto(dealUrl);
  await page.getByTestId("deal-stage-advance").click();
  await expect(page.getByTestId("deal-stage-bar").getByText(target, { exact: true }).first())
    .toBeVisible({ timeout: 10000 });

  // 4. The run is recorded, and it succeeded.
  await page.goto("/portal/settings/automations");
  const runs = page.getByRole("region").filter({ hasText: "Recent runs" });
  await expect(page.getByText("Recent runs")).toBeVisible();
  await expect(page.getByText(/Generated .*\.pdf/)).toBeVisible({ timeout: 10000 });
  await expect(runs.getByText("0 failed")).toHaveCount(0);
});

test("a rule cannot send a deal back to the stage that triggered it", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/settings/automations");

  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByLabel("Name").fill("E2E loop");

  // Same stage on both sides of the rule.
  await page.getByRole("combobox").nth(1).click();
  const stage = page.getByRole("option").first();
  const stageName = (await stage.innerText()).trim();
  await stage.click();

  await page.getByRole("button", { name: "Add action" }).click();
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "Move the deal to a stage" }).click();
  await page.getByRole("combobox", { name: /which stage/i }).click();
  await page.getByRole("option", { name: stageName, exact: true }).click();

  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/same stage that triggered it/i)).toBeVisible();
});
```

The second test is the cheap one that matters: the shortest possible loop, refused at the point somebody writes it rather than three needless runs later.

- [ ] **Step 2: Run it**

```bash
npx playwright test e2e/automations.spec.ts
```

Expected: 2 passed.

If a selector misses, open the trace — `npx playwright show-trace test-results/.../trace.zip` — rather than guessing at a new one. If `getByRole("combobox").nth(1)` picks the wrong control, count the comboboxes in the dialog: name field, trigger picker, condition, then one per action row.

**Two traps here.** Creating a lead in e2e requires the seeded **Damage Type** custom field, which is REQUIRED — a lead-create that "times out" is almost always that, not a broken form. And if port 3001 is held by another session's Playwright run, wait or use a separate port; do not kill their server.

- [ ] **Step 3: Confirm the suite has no new failures**

```bash
npm run test
npm run test:integration
npm run build
```

Expected: unit count matches the baseline from Task 5 plus the tests this plan added; integration green; build clean.

Eight Playwright specs already fail on `main` before any of this. Compare against that baseline — do not attribute a pre-existing failure to this work.

- [ ] **Step 4: Commit**

```bash
git add e2e/automations.spec.ts
git commit -m "Prove a rule written in Settings really files a document"
```

---

## Task 15: Starter rules

Ship the page with something in it, the way `notifications/defaults.ts` already does for notification rules.

**Files:**
- Create: `src/server/modules/automations/defaults.ts`
- Modify: `src/components/portal/automation-rules-manager.tsx`

- [ ] **Step 1: Read the existing pattern**

```bash
cat src/server/modules/notifications/defaults.ts
cat src/components/portal/starter-rules-button.tsx
```

Mirror both: a `planStarterAutomations(companyId, vertical)` that resolves real stage and template ids by name and returns only the rules whose pieces actually exist, plus a button that appears when the list is empty.

- [ ] **Step 2: Write the defaults**

```ts
// src/server/modules/automations/defaults.ts
import { prisma } from "@/server/db/client";
import type { Vertical } from "@prisma/client";

/**
 * A starting set, so the page is not an empty box.
 *
 * Every rule is resolved against what this workspace ACTUALLY has — a rule
 * naming a stage or a checklist that does not exist here is dropped rather than
 * created broken. Same approach as the notification starter rules.
 */
export type PlannedAutomation = {
  name: string;
  trigger: "stage_entered" | "photo_checklist_completed";
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>[];
};

export async function planStarterAutomations(
  companyId: string,
  vertical: Vertical
): Promise<PlannedAutomation[]> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  const stage = (needle: string) =>
    pipeline?.stages.find((s) => s.name.toLowerCase().includes(needle))?.id ?? null;

  const checklists = await prisma.photoTemplate.findMany({
    where: { companyId },
    select: { kind: true },
  });
  const hasInstallChecklist = checklists.some((c) => c.kind === "install");

  const planned: PlannedAutomation[] = [];

  const installed = stage("install");
  const inspection = stage("inspection");
  if (hasInstallChecklist && installed && inspection) {
    planned.push({
      name: "Install photos in → compile and move to Inspection",
      trigger: "photo_checklist_completed",
      conditions: { kind: "install" },
      actions: [
        { type: "compile_photos", kind: "install" },
        { type: "move_stage", stageId: inspection },
      ],
    });
  }

  const acceptance = await prisma.documentTemplate.findFirst({
    where: { companyId, active: true, name: { contains: "cceptance" } },
    select: { id: true },
  });
  if (installed && acceptance) {
    planned.push({
      name: "Installed → generate the Certificate of Acceptance",
      trigger: "stage_entered",
      conditions: { stageId: installed },
      actions: [{ type: "generate_document", templateId: acceptance.id }],
    });
  }

  void vertical; // rows are stamped by the isolation extension, not by us
  return planned;
}
```

- [ ] **Step 3: Add the server action**

Append to `src/server/modules/automations/actions.server.ts`:

```ts
import { planStarterAutomations } from "./defaults";
import { getActiveVertical } from "@/server/auth/vertical";

/**
 * Create the starter set, skipping any rule this workspace already has by name
 * — so a second click adds nothing rather than duplicating everything.
 */
export async function createStarterAutomationsAction() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const vertical = await getActiveVertical(user);
  const planned = await planStarterAutomations(user.companyId, vertical);
  if (planned.length === 0) {
    return fail("This workspace has no stages or templates to build a starter rule from yet.");
  }

  const existing = await prisma.automationRule.findMany({
    where: { companyId: user.companyId },
    select: { name: true },
  });
  const have = new Set(existing.map((r) => r.name));
  const fresh = planned.filter((p) => !have.has(p.name));

  for (const p of fresh) {
    await prisma.automationRule.create({
      data: {
        companyId: user.companyId,
        name: p.name,
        trigger: p.trigger,
        conditions: p.conditions as Prisma.InputJsonValue,
        actions: p.actions as Prisma.InputJsonValue,
      },
    });
  }

  revalidatePath("/portal/settings/automations");
  return { ok: true as const, created: fresh.length };
}
```

- [ ] **Step 4: Add the button to the empty state**

In `src/components/portal/automation-rules-manager.tsx`, add the component:

```tsx
function StarterAutomationsButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function seed() {
    setBusy(true);
    try {
      const res = await createStarterAutomationsAction();
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(
          res.created === 0 ? "You already have all of them." : `Added ${res.created}.`
        );
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={seed} disabled={busy}>
      {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
      Start from the standard set
    </Button>
  );
}
```

Import `createStarterAutomationsAction` alongside the other actions, and render it in the toolbar beside `RuleDialog`, only while the list is empty:

```tsx
      <div className="flex items-center justify-end gap-2">
        {props.rules.length === 0 && <StarterAutomationsButton />}
        <RuleDialog {...props} />
      </div>
```

- [ ] **Step 5: Verify in the app**

```bash
npm run dev
```

On an empty Automations page, click the starter button. Confirm the rules that appear name stages and templates that really exist in this workspace, and that clicking it a second time reports "You already have all of them" rather than duplicating them.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/automations src/components/portal/automation-rules-manager.tsx
git commit -m "A starting set, resolved against what this workspace actually has"
```

---

## Deploying

**The production migration is manual and it lies to you if the URL is wrong.**

1. Pull the session-pooler URL (port **5432**, not the transaction pooler on 6543).
2. **Strip the entire query string and append `?sslmode=require`.** A malformed URL makes `prisma migrate deploy` report success while applying nothing.
3. Run the migration.
4. **Verify by hand** — do not trust the CLI's output:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'automation_rules';
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;
```

5. Only then push to `origin/main`, which auto-deploys.

A 500 on a page right after a deploy is almost always an unapplied migration. Diff `_prisma_migrations` against `prisma/migrations/` before reading any code.

## What this plan does not do

Straight from the spec, so nobody adds them mid-flight: no retry queue, no branching inside a rule, no new customer-facing email beyond the existing signature request, no cross-vertical rules, and no backfill — rules apply only to events after they are switched on.
