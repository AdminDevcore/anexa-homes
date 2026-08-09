import type { Vertical } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";
import { userVerticals } from "@/server/auth/vertical";
import { solarVerticalEnabled } from "./flag";
import { resolveVertical } from "./context";

/**
 * Workspace visibility for the PERMISSION-scoped surfaces.
 *
 * There are two different questions in this codebase and conflating them is the
 * easiest way to get workspace behaviour wrong:
 *
 *   "Which workspace am I standing in?"  → the isolation extension. Operational
 *      data (deals, pipeline, documents) answers this one. Switching workspaces
 *      changes what you see, and that is the point.
 *
 *   "Which workspaces am I allowed to see?" → this file. Notifications, the
 *      activity log, global search and the combined calendar answer this one.
 *      Someone granted Roofing AND Solar must get both **without switching**,
 *      because an alert you only receive while looking at the right workspace is
 *      an alert you miss.
 *
 * A NULL vertical always means company-level and is visible to everyone: payroll
 * ran, branding changed, the all-hands task. It is never hidden by these filters.
 */

type HasVerticals = Parameters<typeof userVerticals>[0];

/** The workspaces this user may see data from, at all, in any surface. */
export function visibleVerticals(user: HasVerticals): ActiveVertical[] {
  return userVerticals(user);
}

/**
 * A Prisma `where` fragment matching rows from any workspace the user is granted,
 * plus company-level rows.
 *
 * Returns `{}` when the multi-workspace build is switched off, so the generated
 * SQL is byte-for-byte what shipped before this existed — the same guarantee the
 * isolation extension makes, for the same reason.
 *
 * Spread it into a where clause. It only ever adds an `OR` on `vertical`, so a
 * caller that has its own `OR` must nest this under `AND` instead:
 *   `{ AND: [{ OR: [...mine] }, permittedVerticalFilter(user)] }`
 */
export function permittedVerticalFilter(
  user: HasVerticals
): Record<string, never> | { OR: [{ vertical: { in: Vertical[] } }, { vertical: null }] } {
  if (!solarVerticalEnabled()) return {};
  const allowed = visibleVerticals(user);
  return { OR: [{ vertical: { in: allowed as Vertical[] } }, { vertical: null }] };
}

/**
 * The same permission boundary for models whose `vertical` column is NOT NULL —
 * Lead, Project, and the rest of the operational tables. A deal always belongs to
 * a workspace; there is no such thing as a company-level lead, so offering a
 * `{ vertical: null }` branch there is not just useless, it does not typecheck.
 *
 * Kept as a separate function rather than a flag so the caller has to decide
 * which shape it wants, and the compiler rejects the wrong one at the call site.
 */
export function permittedVerticalOnly(
  user: HasVerticals
): Record<string, never> | { vertical: { in: Vertical[] } } {
  if (!solarVerticalEnabled()) return {};
  return { vertical: { in: visibleVerticals(user) as Vertical[] } };
}

/**
 * The workspace to stamp onto a row of a model the extension does NOT scope.
 *
 * FileAsset is the case this exists for: it is a shared table holding a mix of
 * company-level assets and workspace-owned ones, so it cannot be SCOPED, but a
 * parentless workspace file (a Solar training PDF) still has to record where it
 * belongs. Returns null when there is no active workspace — a cron or a public
 * token page — which correctly reads as company-level.
 */
export async function stampVertical(): Promise<ActiveVertical | null> {
  if (!solarVerticalEnabled()) return null;
  const res = await resolveVertical();
  return res.mode === "vertical" ? res.vertical : null;
}

/**
 * True when this user works in more than one workspace — the single check behind
 * every "show the workspace badge / offer Combined mode" decision.
 *
 * Somebody with one workspace should never see workspace chrome at all: labelling
 * every notification "Roofing" in a company that only does roofing is noise, and
 * it is exactly the kind of thing that makes a single-vertical build feel like a
 * multi-vertical one that has been switched off.
 */
export function worksAcrossVerticals(user: HasVerticals): boolean {
  return solarVerticalEnabled() && visibleVerticals(user).length > 1;
}
