import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { getActiveIndustry } from "@/server/auth/industry";
import { getCalendarEvents } from "@/server/modules/calendar/queries";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ events: [] }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const from = new Date(sp.get("from") ?? "");
  const to = new Date(sp.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ events: [] }, { status: 400 });
  }
  const industry = await getActiveIndustry(user);
  const events = await getCalendarEvents(user, industry, from, to);
  return NextResponse.json({ events });
}
