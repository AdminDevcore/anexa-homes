import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormMatches } from "@/server/modules/storm/queries";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ matches: [] }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const minScoreRaw = sp.get("minScore");
  const minScore = minScoreRaw != null && minScoreRaw !== "" ? Number(minScoreRaw) : undefined;
  const subject = sp.get("subject");
  const subjectType = subject === "lead" || subject === "knock" ? subject : undefined;

  const matches = await getStormMatches(user, {
    minScore: Number.isFinite(minScore) ? minScore : undefined,
    subjectType,
  });
  return NextResponse.json({ matches });
}
