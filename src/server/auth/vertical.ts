import { cookies } from "next/headers";
import type { Role, Vertical } from "@prisma/client";
import {
  DEFAULT_VERTICAL,
  VERTICALS,
  allowedVerticals,
  isActiveVertical,
  type ActiveVertical,
} from "@/lib/vertical";
import { solarVerticalEnabled } from "@/server/vertical/flag";

export const VERTICAL_COOKIE = "anexa_vertical";

/**
 * Only the grant list is needed, so cron/system callers can pass a stub. `role`
 * is optional for the same reason.
 */
type HasVerticals = { verticals: Vertical[]; role?: Role };

/**
 * The verticals this user may open and switch between.
 *
 * This is the single lever that collapses the whole multi-vertical experience:
 * with the feature flag off it returns roofing only, so the switcher does not
 * render, `others` cannot be reached, and every screen resolves to roofing —
 * exactly the single-workspace behaviour that shipped in July 2026.
 *
 * The super admin always sees every live vertical: they own the company, and
 * locking the owner out of a workspace because of a stale grant list would be a
 * support incident, not a security win. Everyone else gets exactly their grants.
 */
export function userVerticals(user: HasVerticals): ActiveVertical[] {
  if (!solarVerticalEnabled()) return [DEFAULT_VERTICAL];
  if (user.role === "super_admin") return [...VERTICALS];
  return allowedVerticals(user.verticals);
}

/**
 * The verticals this BUILD runs, independent of who is looking.
 *
 * `userVerticals` answers "which workspaces may this person open"; this answers
 * "which workspaces exist at all". Config screens need the second: a roofing-only
 * admin still edits a rep's solar commission rate, and showing them a one-item
 * list would quietly make that rate unreachable.
 */
export function companyVerticals(): ActiveVertical[] {
  return solarVerticalEnabled() ? [...VERTICALS] : [DEFAULT_VERTICAL];
}

/**
 * The active vertical for this request: the workspace cookie when the user is
 * actually granted it, otherwise their default. A cookie naming a vertical the
 * user has lost access to (or a retired one like `others`) is ignored rather
 * than honoured.
 */
export async function getActiveVertical(user: HasVerticals): Promise<ActiveVertical> {
  const allowed = userVerticals(user);
  const fromCookie = (await cookies()).get(VERTICAL_COOKIE)?.value;
  if (fromCookie && isActiveVertical(fromCookie) && allowed.includes(fromCookie)) {
    return fromCookie;
  }
  return allowed.includes(DEFAULT_VERTICAL) ? DEFAULT_VERTICAL : allowed[0];
}
