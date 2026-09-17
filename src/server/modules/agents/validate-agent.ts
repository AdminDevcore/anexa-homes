import type { AgentDepartment, Vertical } from "@prisma/client";
import { z } from "zod";
import { isDepartment, isProduct } from "@/lib/agent-labels";
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
 * A config this large has no business being handler settings — real ones are
 * a handful of fields and secret references. The cap also keeps `findSecretValues`'s
 * recursive walk, below, off huge flat inputs it would otherwise spend real
 * time walking for no reason.
 */
const MAX_CONFIG_CHARS = 30_000;

/**
 * The form's runtime shape — TYPES only, never which values are allowed: every
 * refusal below stays written in words, where a person reads it. `enabled` and
 * `requiresHumanGate` are optional because the checks below already read a
 * missing one as false and true respectively; what this refuses is a string
 * where the form puts a boolean, or nothing at all where it puts a string.
 */
const formSchema = z.object({
  name: z.string(),
  description: z.string(),
  handlerKey: z.string(),
  product: z.string(),
  department: z.string(),
  enabled: z.boolean().optional(),
  schedule: z.string(),
  timeoutSeconds: z.union([z.string(), z.number()]),
  requiresHumanGate: z.boolean().optional(),
  config: z.string(),
});

/**
 * Everything saving an agent must refuse, before any write: a handler this
 * build does not contain, a schedule the tick cannot keep, a timeout outside
 * the tick budget, config that is not an object, config holding a secret, and
 * config the handler itself rejects.
 *
 * `keepHandlerKey`: an agent whose handler has since been removed can still
 * have its other fields saved. Its config cannot be checked by a handler that
 * is not there, and enabling it stays refused (setAgentEnabledAction).
 *
 * `input` is `unknown` on purpose: both callers are public server actions, and
 * `AgentFormValues` is a type, gone by the time a payload arrives. The shape is
 * checked first, so a payload missing a field — or holding a number where the
 * form puts a string — is refused in a sentence rather than throwing a
 * TypeError out of `.trim()` and landing a stack in the logs.
 */
export function validateAgentInput(
  input: unknown,
  opts: { keepHandlerKey?: string } = {}
): { ok: true; value: ValidAgent } | { ok: false; error: string } {
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return fail("That form could not be read. Reload and try again.");
  const form = parsed.data;

  const name = form.name.trim();
  if (!name) return fail("Give the agent a name.");
  if (name.length > 120) return fail("Keep the name under 120 characters.");

  const description = form.description.trim();
  if (description.length > 1000) return fail("Keep the description under 1,000 characters.");

  const handler = handlerFor(form.handlerKey);
  const keepingMissing = !handler && form.handlerKey === opts.keepHandlerKey;
  if (!handler && !keepingMissing) {
    return fail(`No handler is registered for "${form.handlerKey}". Pick one from the list.`);
  }

  if (!isProduct(form.product)) return fail("Pick Roofing, Solar or Both.");
  if (!isDepartment(form.department)) return fail("Pick a department.");

  let schedule: string | null = null;
  if (form.schedule.trim()) {
    const checked = validateSchedule(form.schedule);
    if (!checked.ok) return fail(checked.error);
    schedule = checked.schedule;
  }

  const timeoutSeconds = Number(form.timeoutSeconds);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < MIN_TIMEOUT_SECONDS || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    return fail(`Timeout must be a whole number of seconds from ${MIN_TIMEOUT_SECONDS} to ${MAX_TIMEOUT_SECONDS}.`);
  }

  const rawConfig = form.config.trim();
  if (rawConfig.length > MAX_CONFIG_CHARS) {
    return fail("Keep config under 30,000 characters.");
  }

  let config: unknown;
  try {
    config = JSON.parse(rawConfig || "{}");
  } catch {
    return fail("Config is not valid JSON.");
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return fail("Config must be a JSON object, like {}.");
  }

  let secret: string | null;
  try {
    secret = findSecretValues(config);
  } catch {
    // findSecretValues walks config recursively. The size cap above stops
    // most runaway inputs before they get here; this catches the rest — a
    // config that is deep rather than long, which overflows the call stack
    // with a raw RangeError instead of ever returning a string or null.
    return fail("Config is nested too deeply to check. Simplify its structure.");
  }
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
      handlerKey: form.handlerKey,
      vertical: form.product === "both" ? null : form.product,
      department: form.department,
      enabled: form.enabled === true,
      schedule,
      timeoutSeconds,
      requiresHumanGate: form.requiresHumanGate !== false,
      config: config as Record<string, unknown>,
    },
  };
}
