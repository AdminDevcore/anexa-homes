import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { recordNovaAudit } from "./audit";
import type { WriteResult, WriteTool } from "./tools/define";
import { NOVA_TOOLS_BY_NAME } from "./tools/registry";
import type { NovaCtx, NovaReply, ToolResult } from "./types";

/**
 * PROPOSE, THEN CONFIRM.
 *
 * Nova never changes anything in the same step it decides to. A write tool
 * called from the conversation is prepared (read-only), stored as a pending
 * action, and read back to the user. Only confirmPendingAction — reached from a
 * click on Confirm or a spoken plain "yes" — runs it, and only:
 *
 *   - for the person who proposed it (anyone else finds nothing),
 *   - once (the row is claimed atomically; a double click finds nothing),
 *   - within PENDING_TTL_MS,
 *   - if, checked again as of that moment, the user may still do it AND it
 *     would still do exactly what they were told. If the sentence has changed —
 *     the deal moved on in the meantime — they are asked again instead.
 *
 * Every step is audited: proposed, refused, cancelled, expired, executed, failed.
 */

/** Long enough to answer; short enough that "yes" still means this. */
export const PENDING_TTL_MS = 2 * 60_000;

const NOTHING_PENDING = "There's nothing waiting for your confirmation.";

const toJson = (value: unknown) => JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

const issuesOf = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`).join("; ");

/** One proposal per conversation at a time: a new one replaces the last. */
async function supersede(ctx: NovaCtx) {
  const open = await prisma.novaPendingAction.findMany({
    where: {
      companyId: ctx.user.companyId,
      actorId: ctx.user.userId,
      conversationId: ctx.conversationId,
      status: "pending",
    },
    select: { id: true, tool: true, args: true, summary: true, leadId: true },
  });
  for (const row of open) {
    const { count } = await prisma.novaPendingAction.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "cancelled", resolvedAt: new Date() },
    });
    if (count === 0) continue;
    await recordNovaAudit(ctx, {
      tool: row.tool,
      kind: "write",
      phase: "cancelled",
      args: row.args,
      result: { summary: row.summary },
      error: "Replaced by a newer request before it was confirmed.",
      leadId: row.leadId,
      pendingActionId: row.id,
    });
  }
}

export async function proposeWrite(ctx: NovaCtx, tool: WriteTool, rawInput: unknown): Promise<ToolResult> {
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const message = issuesOf(parsed.error.issues);
    await recordNovaAudit(ctx, { tool: tool.name, kind: "write", phase: "refused", args: rawInput, error: message });
    return { ok: false, reason: "invalid", message };
  }

  let prepared: Awaited<ReturnType<WriteTool["prepare"]>>;
  try {
    prepared = await tool.prepare(ctx, parsed.data);
  } catch (e) {
    console.error(`[nova] ${tool.name} prepare failed`, e);
    const message = "I couldn't check that because of a server error, so I haven't done anything.";
    await recordNovaAudit(ctx, { tool: tool.name, kind: "write", phase: "failed", args: rawInput, error: message });
    return { ok: false, reason: "error", message };
  }
  if (!prepared.ok) {
    await recordNovaAudit(ctx, {
      tool: tool.name,
      kind: "write",
      phase: "refused",
      args: rawInput,
      error: prepared.message,
      leadId: prepared.leadId ?? null,
    });
    return prepared;
  }

  await supersede(ctx);
  const row = await prisma.novaPendingAction.create({
    data: {
      companyId: ctx.user.companyId,
      vertical: "solar",
      actorId: ctx.user.userId,
      conversationId: ctx.conversationId,
      tool: tool.name,
      args: toJson(prepared.args),
      summary: prepared.summary,
      leadId: prepared.leadId,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
    select: { id: true },
  });
  await recordNovaAudit(ctx, {
    tool: tool.name,
    kind: "write",
    phase: "proposed",
    args: prepared.args,
    result: { summary: prepared.summary },
    leadId: prepared.leadId,
    pendingActionId: row.id,
  });

  return {
    ok: true,
    data: { status: "waiting for the user to confirm", summary: prepared.summary },
    leadId: prepared.leadId,
    proposal: { pendingActionId: row.id, summary: prepared.summary },
  };
}

async function nothingPending(ctx: NovaCtx, id: string, verb: "confirm" | "cancel"): Promise<NovaReply> {
  await recordNovaAudit(ctx, {
    tool: verb,
    kind: "write",
    phase: "refused",
    args: { pendingActionId: id },
    error: NOTHING_PENDING,
  });
  return { kind: "missing", reply: NOTHING_PENDING, tools: [] };
}

export async function confirmPendingAction(ctx: NovaCtx, id: string): Promise<NovaReply> {
  const mine = { id, companyId: ctx.user.companyId, actorId: ctx.user.userId };
  const row = await prisma.novaPendingAction.findFirst({ where: mine });
  if (!row || row.status !== "pending") return nothingPending(ctx, id, "confirm");

  const entry = {
    tool: row.tool,
    kind: "write" as const,
    args: row.args,
    leadId: row.leadId,
    pendingActionId: row.id,
  };
  const tools = [row.tool];
  const now = new Date();

  if (row.expiresAt <= now) {
    const { count } = await prisma.novaPendingAction.updateMany({
      where: { ...mine, status: "pending" },
      data: { status: "expired", resolvedAt: now },
    });
    if (count === 0) return nothingPending(ctx, id, "confirm");
    await recordNovaAudit(ctx, { ...entry, phase: "expired", result: { summary: row.summary } });
    return {
      kind: "expired",
      reply: "That waited too long for a yes, so I didn't do it. Ask me again if you still want it.",
      tools,
    };
  }

  // Claim it. Exactly one caller wins; a double click or a replay finds nothing.
  const { count } = await prisma.novaPendingAction.updateMany({
    where: { ...mine, status: "pending", expiresAt: { gt: now } },
    data: { status: "confirmed", resolvedAt: now },
  });
  if (count === 0) return nothingPending(ctx, id, "confirm");

  const tool = NOVA_TOOLS_BY_NAME.get(row.tool);
  const parsed = tool?.kind === "write" ? tool.input.safeParse(row.args) : null;
  if (!tool || tool.kind !== "write" || !parsed?.success) {
    const error = "I couldn't read back what you confirmed, so I didn't do it.";
    await recordNovaAudit(ctx, { ...entry, phase: "failed", result: { summary: row.summary }, error });
    return { kind: "failed", reply: error, tools };
  }

  // Everything is checked again as of now — permissions, the deal, the stage.
  let prepared: Awaited<ReturnType<WriteTool["prepare"]>>;
  try {
    prepared = await tool.prepare(ctx, parsed.data);
  } catch (e) {
    console.error(`[nova] ${tool.name} prepare failed at confirmation`, e);
    const error = "I couldn't check that again because of a server error, so I didn't do it.";
    await recordNovaAudit(ctx, { ...entry, phase: "failed", result: { summary: row.summary }, error });
    return { kind: "failed", reply: error, tools };
  }
  if (!prepared.ok) {
    await recordNovaAudit(ctx, { ...entry, phase: "refused", result: { summary: row.summary }, error: prepared.message });
    return { kind: "refused", reply: prepared.message, tools };
  }

  if (prepared.summary !== row.summary) {
    // What the user agreed to is no longer what would happen.
    await recordNovaAudit(ctx, {
      ...entry,
      phase: "cancelled",
      result: { summary: row.summary, now: prepared.summary },
      error: "Changed between proposal and confirmation.",
    });
    const again = await proposeWrite(ctx, tool, parsed.data);
    if (!again.ok || !again.proposal) {
      return { kind: "refused", reply: again.ok ? NOTHING_PENDING : again.message, tools };
    }
    return {
      kind: "confirm",
      reply: `Something changed since I asked. ${again.proposal.summary} Shall I go ahead?`,
      pending: { id: again.proposal.pendingActionId, summary: again.proposal.summary },
      tools,
    };
  }

  let result: WriteResult;
  try {
    result = await tool.execute(ctx, prepared.plan);
  } catch (e) {
    console.error(`[nova] ${tool.name} failed`, e);
    result = { ok: false, message: "It failed because of a server error." };
  }

  if (!result.ok) {
    await recordNovaAudit(ctx, { ...entry, phase: "failed", result: { summary: row.summary }, error: result.message });
    return { kind: "failed", reply: `I couldn't do that. ${result.message}`, tools };
  }
  await recordNovaAudit(ctx, {
    ...entry,
    phase: "executed",
    result: { summary: row.summary, done: result.done },
    leadId: result.leadId,
    entityType: result.entityType,
    entityId: result.entityId,
  });
  return { kind: "done", reply: result.done, tools };
}

export async function cancelPendingAction(ctx: NovaCtx, id: string): Promise<NovaReply> {
  const mine = { id, companyId: ctx.user.companyId, actorId: ctx.user.userId };
  const row = await prisma.novaPendingAction.findFirst({ where: mine });
  const { count } = row
    ? await prisma.novaPendingAction.updateMany({
        where: { ...mine, status: "pending" },
        data: { status: "cancelled", resolvedAt: new Date() },
      })
    : { count: 0 };
  if (!row || count === 0) return nothingPending(ctx, id, "cancel");

  await recordNovaAudit(ctx, {
    tool: row.tool,
    kind: "write",
    phase: "cancelled",
    args: row.args,
    result: { summary: row.summary },
    leadId: row.leadId,
    pendingActionId: row.id,
  });
  return { kind: "cancelled", reply: "Okay, I won't do that.", tools: [row.tool] };
}
