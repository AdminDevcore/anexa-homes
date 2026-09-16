import { z } from "zod";
import type { AgentResult } from "./types";

export const SUMMARY_MAX = 280;

/**
 * `detail` becomes JSON in the database (`AgentRun.detail`), so it has to
 * survive `JSON.stringify` — a BigInt or a circular reference would throw
 * when the runner writes the row, and the run would sit in "running" until
 * the reaper (Task 13) closes it. Its size is capped too: every run list
 * loads it, so an unbounded detail is a page nobody asked to load.
 */
export const MAX_DETAIL_CHARS = 32_000;

/**
 * `error` is shortened, never rejected: a failed handler — browser
 * automation especially — can easily return a long stack trace, and the
 * real failure is worth keeping even when it's verbose.
 */
export const MAX_ERROR_CHARS = 4000;

const detailSchema = z.record(z.unknown()).superRefine((value, ctx) => {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "detail must be JSON-serialisable — no BigInt, no circular references",
    });
    return;
  }
  if (json.length > MAX_DETAIL_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `detail must serialise to at most ${MAX_DETAIL_CHARS} characters, got ${json.length}`,
    });
  }
});

const changeSchema = z
  .object({
    type: z.literal("move_stage"),
    leadId: z.string().uuid(),
    toStageKey: z.string().min(1).max(200),
    reason: z.string().max(1000),
  })
  .strict();

const resultSchema = z
  .object({
    status: z.enum(["success", "failed", "needs_human"]),
    summary: z.string().min(1),
    detail: detailSchema.optional(),
    changes: z.array(changeSchema).max(500).optional(),
    error: z
      .string()
      .transform((s) => (s.length > MAX_ERROR_CHARS ? s.slice(0, MAX_ERROR_CHARS) : s))
      .optional(),
  })
  .strict();

export function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX) return summary;
  const cut = summary.slice(0, SUMMARY_MAX - 1);
  // An emoji is two UTF-16 units, so the cut can land between its halves and
  // leave a lone surrogate, which renders as a replacement box. Drop the orphan
  // rather than show it — one character shorter is not worth noticing.
  const lastUnit = cut.charCodeAt(cut.length - 1);
  const orphaned = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return `${orphaned ? cut.slice(0, -1) : cut}…`;
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
