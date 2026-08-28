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
