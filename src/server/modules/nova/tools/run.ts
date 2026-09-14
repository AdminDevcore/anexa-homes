import type { NovaAuditPhase } from "@prisma/client";
import { recordNovaAudit } from "../audit";
import { proposeWrite } from "../pending";
import type { NovaCtx, ToolResult } from "../types";
import type { NovaTool } from "./define";
import { NOVA_TOOLS_BY_NAME } from "./registry";

function phaseFor(tool: NovaTool, result: ToolResult): NovaAuditPhase {
  if (result.ok) return tool.kind === "decline" ? "declined" : "executed";
  return result.reason === "refused" || result.reason === "not_found" ? "refused" : "failed";
}

/**
 * Run one tool call from the conversation, as the user, and audit it — every
 * call, refused and failed ones included. Reads run now. Writes are only
 * proposed here; they run from confirmPendingAction once the user says yes, so
 * nothing that changes data can happen inside the loop.
 */
export async function runNovaTool(ctx: NovaCtx, name: string, rawInput: unknown): Promise<ToolResult> {
  const tool = NOVA_TOOLS_BY_NAME.get(name);
  if (!tool) {
    const result: ToolResult = { ok: false, reason: "invalid", message: `There is no tool called ${name}.` };
    await recordNovaAudit(ctx, { tool: name, kind: "read", phase: "failed", args: rawInput, error: result.message });
    return result;
  }
  // A write tool called from the conversation only ever PROPOSES.
  if (tool.kind === "write") return proposeWrite(ctx, tool, rawInput);

  const parsed = tool.input.safeParse(rawInput ?? {});
  let result: ToolResult;
  if (!parsed.success) {
    result = {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
    };
  } else {
    try {
      result = await tool.run(ctx, parsed.data);
    } catch (e) {
      console.error(`[nova] ${name} failed`, e);
      result = { ok: false, reason: "error", message: "That lookup failed because of a server error." };
    }
  }

  await recordNovaAudit(ctx, {
    tool: name,
    kind: tool.kind,
    phase: phaseFor(tool, result),
    args: rawInput,
    result: result.ok ? result.data : null,
    error: result.ok ? null : result.message,
    leadId: result.leadId ?? null,
    entityType: result.ok ? result.entityType : null,
    entityId: result.ok ? result.entityId : null,
  });
  return result;
}
