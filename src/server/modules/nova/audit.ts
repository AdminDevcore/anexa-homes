import { Prisma, type NovaAuditPhase, type NovaToolKind } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { NovaCtx } from "./types";

export type AuditEntry = {
  tool: string;
  kind: NovaToolKind;
  phase: NovaAuditPhase;
  args?: unknown;
  result?: unknown;
  error?: string | null;
  leadId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  pendingActionId?: string | null;
};

/** Plain JSON: drops undefined, turns Dates into strings, survives a round trip. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

/**
 * Append one row to Nova's audit trail and return its id.
 *
 * APPEND-ONLY by construction: this module creates rows and nothing in it (or
 * anywhere in the nova module — see boundaries.test.ts) updates or deletes one.
 * Awaited by every caller, so a write whose audit row cannot be saved is
 * reported as a failure rather than succeeding unrecorded.
 */
export async function recordNovaAudit(ctx: NovaCtx, e: AuditEntry): Promise<string> {
  const row = await prisma.novaAuditEvent.create({
    data: {
      companyId: ctx.user.companyId,
      vertical: "solar",
      actorId: ctx.user.userId,
      conversationId: ctx.conversationId,
      tool: e.tool,
      kind: e.kind,
      phase: e.phase,
      args: toJson(e.args),
      result: e.result == null ? Prisma.JsonNull : toJson(e.result),
      error: e.error ?? null,
      leadId: e.leadId ?? null,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      pendingActionId: e.pendingActionId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}
