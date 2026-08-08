import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { suggestAddresses } from "@/server/modules/geo/suggest";

/**
 * Address suggestions for entry forms — the New Appointment form, the Edit Job
 * dialog, the Field Map search box and every other address field in the portal.
 *
 * The routing (Places first, Nominatim fallback) lives in
 * `@/server/modules/geo/suggest` so it can be unit-tested without stubbing
 * fetch. This route is auth plus query parsing.
 *
 * Gated to any logged-in portal user rather than to a specific permission:
 * anyone who can open a form with an address on it needs this. The public
 * website form cannot use this route and has its own rate-limited server action.
 */

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ results: [], source: "none" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  // The client's autocomplete session token. Passing it through is what makes
  // Google bill one session per address instead of one per keystroke, so a
  // missing token is a cost bug, not a correctness one — hence the fallback
  // rather than a 400.
  const session = url.searchParams.get("session") ?? crypto.randomUUID();
  // "broad" for the few fields that legitimately want a city or a ZIP rather
  // than a house (the storm coverage centre). Anything else means houses only.
  const scope = url.searchParams.get("scope") === "broad" ? "broad" : "address";

  return NextResponse.json(await suggestAddresses(q, session, {}, scope));
}
