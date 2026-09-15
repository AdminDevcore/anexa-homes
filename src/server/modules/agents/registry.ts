import type { HandlerKey } from "./handler-keys";
import type { AgentHandler } from "./types";
import { systemHelloHandler } from "./handlers/system-hello";

/**
 * The only file that knows about every handler. Adding an agent is a handler
 * module, its key in handler-keys.ts, and one line here — then a row in
 * `agents` from the Agents page.
 */
export const HANDLERS = {
  "system.hello": systemHelloHandler,
} satisfies Record<HandlerKey, AgentHandler>;

export function handlerFor(key: string): AgentHandler | null {
  return (HANDLERS as Record<string, AgentHandler>)[key] ?? null;
}

export function handlerOptions(): { value: string; label: string }[] {
  return (Object.values(HANDLERS) as AgentHandler[]).map((h) => ({ value: h.key, label: h.label }));
}
