import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getLeaderboard, type LeaderboardPeriod } from "@/server/modules/canvassing/queries";

const PERIODS: LeaderboardPeriod[] = ["today", "week", "month", "all"];

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ rows: [], meId: null }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("period");
  const period: LeaderboardPeriod = PERIODS.includes(raw as LeaderboardPeriod) ? (raw as LeaderboardPeriod) : "week";
  const rows = await getLeaderboard(user, period);
  return NextResponse.json({ rows, meId: user.userId });
}
