# Automations: make a milestone do the work

Date: 2026-08-27
Status: approved

## Problem

A solar deal passes through 27 pipeline stages. At several of them a document
has to be produced — the Certificate of Acceptance when the system is
installed, the Attestation of Customer Payment, the two lien waivers. Some go
to the homeowner for signature; some are only ever filled in and filed.

Every one of them is manual today. A coordinator has to notice the deal moved,
open Documents, pick the template, choose the signers, and send it. Same for
the install photos: the crew uploads them, and then somebody has to remember to
open the deal, hit the photo-report download, and move the job to Inspection.
Nothing that could happen automatically does.

There is already an event bus that knows all of this is happening.
`fireEvent()` in `src/server/modules/notifications/engine.ts` fires 13 events
from ~18 call sites, and `NotificationRule` rows match on `event` plus a
`conditions` JSON. But every rule that bus can carry ends in a message. It can
tell a human that the deal reached Installed. It cannot do anything about it.

The pieces the *doing* would need already exist and are already used:

- `generateSignedPdf({ signers: [], events: [], certificate: false })` in
  `esign/pdf.ts` renders a template's fields onto a PDF with no signature and no
  audit page. `generateTemplatePreviewPdf` calls it that way today with
  `sampleCtx()`; swapping in a real `AutofillContext` for a lead is the whole of
  "generate it filled up".
- `DocumentTemplate.folderKey` already routes a finished document into the right
  deal folder.
- `renderPhotoReport()` in `photos/report.ts` already compiles a checklist into
  a branded PDF. It is only ever streamed to a browser
  (`leads/[id]/photo-report/route.ts`), never stored.
- `PhotoTemplateItem.required` makes "all install photos are in" a computable
  fact.
- `recordStageEntry` is the single funnel every stage move already goes through.

So this is an **actions layer on an event bus that already exists**, not a new
engine from scratch.

## Decisions

| Question | Decision |
|---|---|
| Rule shape | Generic engine: trigger × conditions × **ordered** actions |
| Triggers | Stage entered, photo checklist complete, document completed, time in stage |
| Actions | Generate & file a document, send for signature, move stage, set project status, compile photos |
| On action failure | Stop the run, record it, notify — never half-apply a rule |
| Scope | Per-vertical rows, like every other config. Zero rules = zero behaviour change |
| `once` per deal | Defaults **on** |
| Retries | None |
| Branching inside a rule | None — an ordered list, not a flowchart |

Rejected:

- **A catalog of hand-written recipes.** Four triggers × five actions is 20
  combinations, and the two automations that matter most are *chains* ("compile
  the photos **and** move the job"). Hand-writing them makes every new idea a
  code change.
- **Hanging automations off the pipeline stage** (an "On entry, do…" panel
  beside the SLA settings each stage already carries). It reads beautifully and
  it cannot express three of the four triggers.
- **Reusing `NotificationRule`** with an actions column. A rule that sends an
  email and a rule that moves a deal through the pipeline have different blast
  radii, different permissions and different failure semantics. They should not
  share a table or a settings page.

## Design

### 1 · Data model

```prisma
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

model AutomationRule {
  id         String   @id @default(uuid())
  companyId  String
  /// Isolated per vertical: this row belongs to exactly one workspace.
  vertical   Vertical @default(roofing)
  name       String
  trigger    AutomationTrigger
  /// Trigger-specific match: { stageId } | { kind } | { templateId } | { stageId, days }
  conditions Json     @default("{}")
  /// ORDERED list of what to do: [{ type, ...config }]. Order is the contract.
  actions    Json     @default("[]")
  /// Run at most once per deal. Off = every time the trigger matches.
  once       Boolean  @default(true)
  active     Boolean  @default(true)

  runs AutomationRun[]

  @@index([companyId, vertical, trigger, active])
  @@map("automation_rules")
}

model AutomationRun {
  id         String              @id @default(uuid())
  companyId  String
  ruleId     String
  leadId     String?
  status     AutomationRunStatus
  /// Per-action outcome, in order: [{ type, ok, detail }]
  steps      Json                @default("[]")
  error      String?
  startedAt  DateTime            @default(now())
  finishedAt DateTime?

  @@index([companyId, ruleId, startedAt])
  @@index([ruleId, leadId, status])
  @@map("automation_runs")
}
```

`AutomationRun` is load-bearing, not just a log. It is how `once` is enforced
(has this rule already succeeded on this deal?) and it is the failure surface in
the UI. No unique constraint on `(ruleId, leadId)` — `once: false` allows many.

### 2 · The engine

`src/server/modules/automations/engine.ts`, exporting
`runAutomations({ companyId, vertical, trigger, leadId, ... })`.

Modelled on `fireEvent` and, like it, **never throws into the caller**. A rep
dragging a card across the pipeline must never see an error because an
automation failed. The rep's action is the business record; the automation is a
consequence of it.

Flow: load active rules for company + vertical + trigger → filter on
`conditions` → check the `once` guard against `AutomationRun` → execute actions
in order, **stopping at the first failure** → write the run row and an
`ActivityLog` entry on the deal → on failure, fire a new `automation_failed`
notification event so the existing notification rules do the telling.

Two hazards that have to be built in, not bolted on:

**Loop protection.** `move_stage` fires `stage_entered`, which can fire another
rule, which moves the stage again. An AsyncLocalStorage depth counter aborts
past depth 3 with `status: skipped`, `error: "loop guard"`. Separately, a rule
may never target the stage it triggered on — rejected in the editor and again
in the engine, because a rule written before a stage was renamed can still be
wrong.

**There is no session user.** Automations run with nobody logged in, so actions
must call session-free core functions scoped by `companyId` + `vertical`. They
must never call the RBAC-guarded server actions, whose `requireCan` and
`listScope` need a `SessionUser` — the same reason `leads/intake.ts` works
directly against Prisma for the public form. This costs exactly one refactor:
split `sendForSignature(user, input)` into a guarded wrapper plus a core
`createSignaturePackage({ companyId, vertical, actorId, ... })`. `ActivityLog`
rows written by the engine carry `actorId: null` and read "Automation: …".

Vertical isolation: event-driven triggers inherit the ambient vertical from the
server action that fired them. The cron trigger has none, so it wraps each
company + vertical pass in `runInVertical` (see
`docs/architecture/vertical-isolation.md`). `next dev` loads `context.ts` twice,
so `runInVertical` silently no-ops there — the cron path must be verified on a
production build, never on the dev server.

### 3 · Triggers

| Trigger | Fires from | Work |
|---|---|---|
| `stage_entered` | beside the two existing `fireEvent("stage_changed")` calls in `leads/actions.ts` (the dropdown and the cancel path) | wire only |
| `document_completed` | beside `fireEvent` at `esign/service.ts:736` | wire only |
| `photo_checklist_completed` | end of `uploadFileAction` (`files/actions.ts`), when `photoTemplateItemId` is set: re-check whether every `required` item on that template now has at least one `FileAsset` | new check |
| `stage_age_exceeded` | new daily `/api/cron/automations` over open `LeadStageEvent` rows (`exitedAt: null`), each company + vertical inside `runInVertical` | new cron |

`photo_checklist_completed` fires on the **transition** to complete, not on
every upload into a finished checklist. The `once` guard is a backstop for that,
not the mechanism — a crew re-uploading a shot must not recompile the report
every time.

### 4 · Actions

A registry under `src/server/modules/automations/actions/`, one file per action,
each exporting `{ type, configSchema: ZodSchema, run(ctx): Promise<StepResult> }`.
One file per action keeps each one small enough to test on its own and makes
adding a sixth a new file rather than an edit to a growing switch.

1. **`generate_document`** — `{ templateId }`. Builds the real `AutofillContext`
   for the lead, calls the existing `generateSignedPdf` with `signers: []`,
   `events: []`, `certificate: false`, stores the bytes as a `FileAsset` with
   `category` = the template's `folderKey`. The template-preview path with a
   real context instead of `sampleCtx()`.
2. **`send_for_signature`** — `{ templateId, signer }` where signer is
   `customer | co_owner | assigned_rep`. Calls the extracted core. Fails the run
   if the chosen signer has no email on file, rather than sending nowhere.
3. **`move_stage`** — `{ stageId }`. Sets `lead.stageId`, calls
   `recordStageEntry`, writes the activity entry, re-fires the event.
4. **`set_project_status`** — `{ status }`. A separate action from `move_stage`
   because it is a different table with a different enum; folding them together
   would mean one action whose config means two unrelated things.
5. **`compile_photos`** — `{ kind }`. Calls the existing `renderPhotoReport()`
   and **stores** the result as a `FileAsset` in that checklist's folder,
   instead of streaming it to a download.

The motivating example is one rule: trigger `photo_checklist_completed` on
`install`, actions `[compile_photos, move_stage → Inspection]`.

### 5 · Settings UI

`src/app/portal/settings/automations/page.tsx` plus
`src/components/portal/automation-rules-manager.tsx`, modelled directly on the
existing `notification-rules-manager.tsx` so the page is familiar and no new UI
vocabulary is invented.

- A card per rule, reading as a sentence: *"When a deal reaches **Installed** →
  generate **Certificate of Acceptance**, move to **M1 Funding**"*, with an
  active toggle.
- Editor: trigger picker → the one condition control that trigger needs (stage
  dropdown / checklist dropdown / template dropdown / day count) → an ordered
  action list with add, remove and reorder.
- A **Recent runs** panel: the last 50, each with its per-step outcome, and a
  red count of failures. This is the only place a silent automation becomes
  visible, so it is not optional.

A new card on the Settings hub, gated on the existing Settings `update`
permission. Seeded with a small set of starter rules the way
`notifications/defaults.ts` already seeds notification rules, so the page is not
empty on arrival.

### 6 · Testing

- **Unit** — condition matching per trigger; the `once` guard; the loop-depth
  guard; every action's `configSchema`.
- **Integration** (`.itest.ts`, real DB) — each action end to end on a seeded
  deal; a failing action stops the run and records the failure with the steps
  before it marked `ok`; a solar rule never fires on a roofing deal.
- **E2E** — create a rule in Settings, move a deal into the trigger stage,
  assert the generated PDF lands in the expected deal folder.

Per `e2e-required-custom-field-trap`, the seeded REQUIRED Damage Type field must
be filled in any e2e that creates a lead.

## Out of scope

- **Retries.** A failed action stops and reports; it is not queued.
- **Branching.** Actions are an ordered list, never a flowchart.
- **New customer email.** Nothing is sent to a homeowner except the signature
  request that already exists.
- **Cross-vertical rules.** A rule belongs to one workspace.
- **Backfill.** Rules apply to events from the moment they are switched on. No
  automation runs against deals that already passed the trigger.
