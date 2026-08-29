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
  /** Every template in a bundled envelope; `templateId` is only its first. */
  templateIds?: string[];
  days?: number;
};

/** One action's outcome. `follow` is stripped before it is stored. */
export type StepResult = {
  type: string;
  ok: boolean;
  detail: string;
  /**
   * Set by an action whose own effect is a trigger — moving a stage is the
   * reason chaining works at all ("compile the photos, move to Inspection", and
   * the rule waiting at Inspection then runs).
   *
   * The action reports it rather than calling the engine itself for two
   * reasons: the engine imports the action registry, so an action importing the
   * engine back would be a cycle; and only the engine knows the current depth,
   * which is the thing that has to stop a loop.
   */
  follow?: { trigger: AutomationTrigger; payload: TriggerPayload };
};

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
