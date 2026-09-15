import type { Vertical } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";

/**
 * Where an agent runs. A "both" agent (vertical NULL) runs once per live
 * workspace; a scoped agent runs only in its own, and not at all when that
 * workspace is switched off or retired.
 */
export function agentRunVerticals(
  agentVertical: Vertical | null,
  live: readonly ActiveVertical[]
): ActiveVertical[] {
  if (agentVertical === null) return [...live];
  return (live as readonly string[]).includes(agentVertical) ? [agentVertical as ActiveVertical] : [];
}

/** Run now: the same, narrowed to the workspaces the viewer holds. */
export function viewerRunVerticals(
  agentVertical: Vertical | null,
  live: readonly ActiveVertical[],
  held: readonly ActiveVertical[]
): ActiveVertical[] {
  return agentRunVerticals(agentVertical, live).filter((v) => held.includes(v));
}

export function agentVisibleTo(agentVertical: Vertical | null, held: readonly ActiveVertical[]): boolean {
  return agentVertical === null || (held as readonly string[]).includes(agentVertical);
}
