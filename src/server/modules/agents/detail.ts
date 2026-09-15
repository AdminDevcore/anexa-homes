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

/** Whatever is in the column, as a RunDetail — old or partial rows included. */
export function readDetail(raw: unknown): RunDetail {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<RunDetail>;
  return {
    handlerKey: typeof o.handlerKey === "string" ? o.handlerKey : "",
    configSnapshot: o.configSnapshot ?? {},
    gated: o.gated === true,
    durationMs: typeof o.durationMs === "number" ? o.durationMs : null,
    log: Array.isArray(o.log) ? o.log.map((l) => String(l)) : [],
    handler: o.handler && typeof o.handler === "object" ? o.handler : null,
    changes: Array.isArray(o.changes) ? o.changes : [],
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
