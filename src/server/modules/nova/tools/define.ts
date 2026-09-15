import { z } from "zod/v4";
import type { NovaCtx, ToolResult } from "../types";

type Refusal = Extract<ToolResult, { ok: false }>;

export type ReadTool = {
  name: string;
  kind: "read" | "decline";
  /** What the model reads to decide when to call it. */
  description: string;
  input: z.ZodType;
  run: (ctx: NovaCtx, input: unknown) => Promise<ToolResult>;
};

/** What a write WOULD do, worked out from the records without doing any of it. */
export type Prepared<P> = {
  ok: true;
  /** The sentence the user says yes to. Built from the records, never by the model. */
  summary: string;
  leadId: string | null;
  /** The validated input — the deal on screen resolved to its id — as stored on the pending row. */
  args: Record<string, unknown>;
  /** What execute needs. Worked out again at confirmation, never read back from storage. */
  plan: P;
};

export type WriteResult =
  | { ok: true; done: string; leadId: string | null; entityType: string; entityId: string | null }
  | { ok: false; message: string };

/**
 * A change Nova can make. Split in two so nothing can write by accident:
 * `prepare` only reads, and `execute` is reachable only from a confirmed
 * pending action (see pending.ts) — never from the conversation loop.
 */
export type WriteTool = {
  name: string;
  kind: "write";
  description: string;
  input: z.ZodType;
  prepare: (ctx: NovaCtx, input: unknown) => Promise<Prepared<unknown> | Refusal>;
  execute: (ctx: NovaCtx, plan: unknown) => Promise<WriteResult>;
};

export type NovaTool = ReadTool | WriteTool;

/** One schema is both the model's tool definition and the server's validation. */
export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  kind: "read" | "decline";
  description: string;
  input: S;
  run: (ctx: NovaCtx, input: z.output<S>) => Promise<ToolResult>;
}): ReadTool {
  return { ...tool, run: (ctx, input) => tool.run(ctx, input as z.output<S>) };
}

export function defineWriteTool<S extends z.ZodType, P>(tool: {
  name: string;
  description: string;
  input: S;
  prepare: (ctx: NovaCtx, input: z.output<S>) => Promise<Prepared<P> | Refusal>;
  execute: (ctx: NovaCtx, plan: P) => Promise<WriteResult>;
}): WriteTool {
  return {
    name: tool.name,
    kind: "write",
    description: tool.description,
    input: tool.input,
    prepare: (ctx, input) => tool.prepare(ctx, input as z.output<S>),
    execute: (ctx, plan) => tool.execute(ctx, plan as P),
  };
}

export { z };
