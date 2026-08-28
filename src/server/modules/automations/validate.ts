import { z } from "zod";
import { actionFor } from "./registry";

/**
 * Everything a rule must satisfy before it is stored.
 *
 * Its own module rather than a function in actions.server.ts because every
 * export of a "use server" file has to be an async function, and a validator
 * that can only be reached through an await is a validator the editor cannot
 * use to show the same message the server would give.
 */
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum([
    "stage_entered",
    "photo_checklist_completed",
    "document_completed",
    "stage_age_exceeded",
  ]),
  conditions: z.record(z.string(), z.unknown()).default({}),
  // Deliberately NOT `.min(1)`: zod's own "Array must contain at least 1
  // element(s)" is not a sentence to show somebody building a rule. The
  // explicit check below owns that message.
  actions: z.array(z.record(z.string(), z.unknown())),
  once: z.boolean().default(true),
  active: z.boolean().default(true),
});

export type RuleInput = z.infer<typeof schema>;

export type Validated = { ok: true; value: RuleInput } | { ok: false; error: string };

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
  // same stage. It is the shortest possible loop, and the engine's depth guard
  // would catch it only after three needless runs — each one writing a row and
  // a line on the deal's timeline.
  if (value.trigger === "stage_entered") {
    const from = value.conditions.stageId;
    if (typeof from === "string") {
      const back = value.actions.some((a) => a.type === "move_stage" && a.stageId === from);
      if (back) {
        return { ok: false, error: "A rule cannot move a deal to the same stage that triggered it." };
      }
    }
  }

  return { ok: true, value };
}
