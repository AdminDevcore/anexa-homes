import { z } from "zod/v4";
import type { NovaCtx, ToolResult } from "../types";

export type ToolKind = "read" | "write" | "decline";

export type NovaTool = {
  name: string;
  kind: ToolKind;
  /** What the model reads to decide when to call it. */
  description: string;
  input: z.ZodType;
  run: (ctx: NovaCtx, input: unknown) => Promise<ToolResult>;
};

/** One schema is both the model's tool definition and the server's validation. */
export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  kind: ToolKind;
  description: string;
  input: S;
  run: (ctx: NovaCtx, input: z.output<S>) => Promise<ToolResult>;
}): NovaTool {
  return { ...tool, run: (ctx, input) => tool.run(ctx, input as z.output<S>) };
}

export { z };
