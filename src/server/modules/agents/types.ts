import type { AgentRunTrigger, BlockerParty, StageType } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";
import type { HandlerKey } from "./handler-keys";

/**
 * The contract every agent handler implements, and the shapes the runner
 * records about what one did. Types only — safe to import from a handler, a
 * client component, or a test.
 */

export type ParseResult<C> = { ok: true; config: C } | { ok: false; error: string };

export type DealSnapshot = {
  id: string;
  /** Customer name and address. */
  label: string;
  stageKey: string | null;
  stageName: string | null;
  stageChangedAt: Date | null;
};

/** Every door to the outside world. Tests pass fakes; portal clients join here later. */
export type AgentDeps = {
  now(): Date;
  secrets: { get(ref: string): Promise<string | null> };
  deals: {
    get(leadId: string): Promise<DealSnapshot | null>;
    inStages(stageKeys: string[], opts?: { limit?: number }): Promise<DealSnapshot[]>;
  };
};

export type AgentContext<C> = {
  companyId: string;
  vertical: ActiveVertical;
  runId: string;
  trigger: AgentRunTrigger;
  /** Set when the run is about one deal; null for a sweep. */
  leadId: string | null;
  config: C;
  /** Aborted when the run times out. Long I/O must honour it. */
  signal: AbortSignal;
  /** Appends a line to detail.log. */
  log(line: string): void;
  deps: AgentDeps;
};

export type RequestedChange = {
  type: "move_stage";
  leadId: string;
  /** A key in the deal's OWN pipeline, so a roofing key can never move a solar deal. */
  toStageKey: string;
  reason: string;
};

export type AgentResult = {
  status: "success" | "failed" | "needs_human";
  /** One line, e.g. "Submitted NTP for deal 4821". Truncated to 280 characters. */
  summary: string;
  detail?: Record<string, unknown>;
  changes?: RequestedChange[];
  error?: string;
};

/**
 * Declared with METHOD syntax on purpose. Method parameters are checked
 * bivariantly, which is what lets a registry typed `AgentHandler` (config
 * `unknown`) hold handlers with specific config types.
 */
export type AgentHandler<C = unknown> = {
  key: HandlerKey;
  /** Shown in the handler picker. */
  label: string;
  /** Validates Agent.config. Runs on save, and again before every run. */
  parseConfig(raw: unknown): ParseResult<C>;
  run(ctx: AgentContext<C>): Promise<AgentResult>;
};

export type StageRef = { id: string; key: string; name: string };

export type TargetStage = StageRef & {
  position: number;
  isActionRequired: boolean;
  defaultBlocker: BlockerParty | null;
  stageType: StageType;
};

export type ResolvedChange = {
  change: RequestedChange;
  lead: { id: string; label: string } | null;
  fromStage: StageRef | null;
  toStage: TargetStage | null;
  /** Set when Contract Signed blocks this move: the refusal to show as the note. */
  contractRefusal: string | null;
  /** Set when M1 Funding blocks this move: the refusal to show as the note. */
  fundingRefusal: string | null;
};

export type ChangeOutcome = "applied" | "noop" | "held" | "discarded" | "invalid";

export type ChangeRecord = RequestedChange & {
  dealLabel: string | null;
  fromStage: StageRef | null;
  toStage: TargetStage | null;
  outcome: ChangeOutcome;
  note: string | null;
};

/** What `AgentRun.detail` holds. */
export type RunDetail = {
  handlerKey: string;
  configSnapshot: unknown;
  gated: boolean;
  durationMs: number | null;
  log: string[];
  handler: Record<string, unknown> | null;
  changes: ChangeRecord[];
  resolution: { byUserId: string; at: string; changes: ChangeRecord[] } | null;
  lateResult: unknown;
};
