import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { placeDetails } from "@/server/modules/geo/places";

/**
 * Resolve a Places prediction into the four fields a form has, plus a rooftop
 * coordinate.
 *
 * This exists because Places autocomplete deliberately returns no coordinates
 * and no postcode — a prediction is cheap, the details are the billable part —
 * so the ZIP the rep sees filled in only arrives once they pick something.
 *
 * `session` must be the same token used for the autocomplete keystrokes. That
 * is what closes the billing session; a details call with a fresh token opens
 * and bills a second one for the same address.
 */

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ place: null }, { status: 401 });

  const url = new URL(req.url);
  const placeId = (url.searchParams.get("placeId") ?? "").trim();
  const session = url.searchParams.get("session") ?? crypto.randomUUID();
  if (!placeId) return NextResponse.json({ place: null }, { status: 400 });

  return NextResponse.json({ place: await placeDetails(placeId, session) });
}
