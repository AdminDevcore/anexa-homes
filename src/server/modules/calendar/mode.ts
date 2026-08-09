import type { ActiveVertical } from "@/lib/vertical";
import { isActiveVertical } from "@/lib/vertical";
import { visibleVerticals, worksAcrossVerticals } from "@/server/vertical/visibility";
import { getActiveVertical } from "@/server/auth/vertical";

type HasVerticals = Parameters<typeof visibleVerticals>[0];

/** "combined", or a single workspace key. */
export type CalendarMode = "combined" | ActiveVertical;

export type ResolvedCalendarMode = {
  mode: CalendarMode;
  /** The workspaces to actually read. Always non-empty, always authorized. */
  verticals: ActiveVertical[];
  /** Whether to offer the mode switcher at all. */
  canCombine: boolean;
};

/**
 * Turn a requested calendar mode into the list of workspaces we will read.
 *
 * This is the ONLY place that decides it, and it exists because the request
 * carries the mode in a query string — which means it is user input and has to
 * be re-checked, not trusted. Three ways a request can be wrong, all handled by
 * falling back rather than erroring, because a calendar that 400s is worse than
 * a calendar showing one workspace:
 *
 *   • "combined" from someone with a single workspace → their one workspace
 *   • a workspace they are not granted                → their active workspace
 *   • garbage / absent                                → their active workspace
 *
 * The fallback is never "show everything".
 */
export async function resolveCalendarMode(
  user: HasVerticals,
  requested: string | null | undefined
): Promise<ResolvedCalendarMode> {
  const allowed = visibleVerticals(user);
  const canCombine = worksAcrossVerticals(user);
  const active = await getActiveVertical(user);

  if (requested === "combined" && canCombine) {
    return { mode: "combined", verticals: allowed, canCombine };
  }
  if (requested && isActiveVertical(requested) && allowed.includes(requested)) {
    return { mode: requested, verticals: [requested], canCombine };
  }
  return { mode: active, verticals: [active], canCombine };
}
