import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { getCalendarEventsForWorkspaces } from "@/server/modules/calendar/queries";
import { resolveCalendarMode } from "@/server/modules/calendar/mode";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ events: [] }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const from = new Date(sp.get("from") ?? "");
  const to = new Date(sp.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ events: [] }, { status: 400 });
  }

  // `mode` is user input; resolveCalendarMode re-derives it from the grant list
  // rather than trusting it. Both the single-workspace and combined cases go
  // through the same call — see getCalendarEventsForWorkspaces for why asking
  // for a workspace other than the active one silently returned nothing when
  // they were separate paths.
  const { mode, verticals } = await resolveCalendarMode(user, sp.get("mode"));
  const events = await getCalendarEventsForWorkspaces(user, verticals, from, to);

  return NextResponse.json({ events, mode });
}
