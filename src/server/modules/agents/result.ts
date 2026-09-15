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
