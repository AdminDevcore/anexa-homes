import { HANDLER_KEYS } from "./handler-keys";

/**
 * The build's half of registry integrity. Imports only the key list, so the
 * build script can run it without loading any server module.
 */
export type AgentForCheck = { company: string; name: string; handlerKey: string };

export function unknownHandlers(rows: AgentForCheck[], keys: readonly string[] = HANDLER_KEYS): AgentForCheck[] {
  return rows.filter((r) => !keys.includes(r.handlerKey));
}

export function formatUnknownHandlers(rows: AgentForCheck[]): string {
  return [
    `[check-agent-handlers] ${rows.length} enabled agent(s) point at a handler this build does not contain:`,
    ...rows.map((r) => `  - ${r.company} / ${r.name} / ${r.handlerKey}`),
    "Deploy the handler, or disable the agent on the Agents page, then build again.",
  ].join("\n");
}
