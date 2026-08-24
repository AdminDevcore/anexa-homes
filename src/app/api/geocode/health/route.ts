import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { checkGeoProviders } from "@/server/modules/geo/health";

/**
 * "Is the address field working?", answerable on demand.
 *
 * The counterpart to the nightly watchdog: the cron tells you when it breaks,
 * this tells you the moment you enable something whether it took. Sixteen days
 * of a disabled Places API went unnoticed partly because there was no way to
 * ask — the only test was to open a form and type, and the answer that came
 * back ("No matching address") looked like a fact about the address.
 *
 * Admin-gated, not because the result is sensitive but because the failure
 * detail names Google Cloud consoles and the fix belongs to whoever owns them.
 * `no-store`: a cached health check is not a health check.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "update", "Settings")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const health = await checkGeoProviders();
  return NextResponse.json(health, {
    // A degraded lookup is still a working endpoint — the status code reports
    // on this route, and the body reports on Google.
    headers: { "Cache-Control": "no-store" },
  });
}
