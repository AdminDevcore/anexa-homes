/**
 * Every handler key the code knows about.
 *
 * No imports, on purpose: the production build's check
 * (scripts/check-agent-handlers.ts) reads this file alone, before any server
 * module can load. registry.ts is typed against this list with `satisfies`, so
 * adding a key without a handler — or a handler without a key — fails the type
 * check inside `next build`.
 */
export const HANDLER_KEYS = ["system.hello"] as const;

export type HandlerKey = (typeof HANDLER_KEYS)[number];

export function isHandlerKey(value: unknown): value is HandlerKey {
  return typeof value === "string" && (HANDLER_KEYS as readonly string[]).includes(value);
}
