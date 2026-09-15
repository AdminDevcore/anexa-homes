import type { Vertical } from "@prisma/client";
import { isActiveVertical, type ActiveVertical } from "@/lib/vertical";

/**
 * Where an agent runs. A "both" agent (vertical NULL) runs once per live
 * workspace; a scoped agent runs only in its own, and not at all when that
 * workspace is switched off or retired (including the legacy `others` value,
 * which `isActiveVertical` never accepts).
 */
export function agentRunVerticals(
  agentVertical: Vertical | null,
  live: readonly ActiveVertical[]
): ActiveVertical[] {
  if (agentVertical === null) return [...live];
  if (!isActiveVertical(agentVertical)) return [];
  return live.includes(agentVertical) ? [agentVertical] : [];
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
  if (agentVertical === null) return true;
  return isActiveVertical(agentVertical) && held.includes(agentVertical);
}
