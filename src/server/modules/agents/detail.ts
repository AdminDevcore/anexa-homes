/**
 * `AgentRun.detail` is what a run has to show for itself — its handler, its
 * log lines, the changes it wanted, how it was resolved. It's stored as JSON
 * in the database, so nothing guarantees it actually matches `RunDetail`: an
 * old row, a partial write mid-crash, or a manual edit can hold anything.
 * `readDetail` reads it back defensively, coercing whatever's really there
 * instead of trusting the column's declared shape.
 */
import type { RunDetail } from "./types";

export function emptyDetail(agent: {
  handlerKey: string;
  config: unknown;
  requiresHumanGate: boolean;
}): RunDetail {
  return {
    handlerKey: agent.handlerKey,
    configSnapshot: agent.config ?? {},
    gated: agent.requiresHumanGate,
    durationMs: null,
    log: [],
    handler: null,
    changes: [],
    resolution: null,
    lateResult: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whatever is in the column, as a RunDetail — old or partial rows included. */
export function readDetail(raw: unknown): RunDetail {
  const o = (isPlainObject(raw) ? raw : {}) as Partial<RunDetail>;
  return {
    handlerKey: typeof o.handlerKey === "string" ? o.handlerKey : "",
    configSnapshot: o.configSnapshot ?? {},
    gated: o.gated === true,
    durationMs: typeof o.durationMs === "number" ? o.durationMs : null,
    log: Array.isArray(o.log) ? o.log.map((l) => String(l)) : [],
    handler: isPlainObject(o.handler) ? o.handler : null,
    changes: Array.isArray(o.changes) ? (o.changes.filter(isPlainObject) as RunDetail["changes"]) : [],
    resolution: o.resolution ?? null,
    lateResult: o.lateResult ?? null,
  };
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}

export function missingHandlerMessage(handlerKey: string): string {
  return `No handler is registered for "${handlerKey}". Deploy the handler or disable this agent.`;
}
