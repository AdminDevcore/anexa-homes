import type { Role } from "@prisma/client";

/**
 * The signed-in person Nova is acting as — never anyone else, never elevated.
 * Every permission question inside the module is asked of exactly this user,
 * through the same `can()` / `listScope()` the portal uses.
 */
export type NovaActor = {
  userId: string;
  companyId: string;
  role: Role;
  permissions?: Record<string, unknown> | null;
  fullName: string;
};

/** The deal on screen, already checked against the actor's row scope. */
export type PageDeal = { leadId: string; name: string };

export type NovaCtx = {
  user: NovaActor;
  conversationId: string;
  /** The company's timezone. Every date Nova reads or says is in it. */
  timeZone: string;
  now: Date;
  page: PageDeal | null;
};

export type ToolFailure = "refused" | "invalid" | "not_found" | "error";

/** A write that has been worked out and stored, waiting on the user's yes. */
export type Proposal = { pendingActionId: string; summary: string };

export type ToolResult =
  | {
      ok: true;
      data: Record<string, unknown>;
      /** The deal this call touched, for the audit row. */
      leadId?: string | null;
      entityType?: string;
      entityId?: string;
      /** Set only by a write tool: nothing has happened yet. */
      proposal?: Proposal;
    }
  | { ok: false; reason: ToolFailure; message: string; leadId?: string | null };

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type NovaReplyKind =
  | "answer"
  | "declined"
  | "error"
  | "confirm"
  | "done"
  | "failed"
  | "refused"
  | "cancelled"
  | "expired"
  | "missing";

/** What Nova says back, from a turn or from a confirmation. */
export type NovaReply = {
  kind: NovaReplyKind;
  reply: string;
  /** Tool names involved, in order — for the transcript, not the audit. */
  tools: string[];
  /** Present when `kind` is "confirm": the write waiting on a yes. */
  pending?: { id: string; summary: string };
};
