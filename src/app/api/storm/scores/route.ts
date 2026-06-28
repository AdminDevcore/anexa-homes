import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormScores } from "@/server/modules/storm/queries";

// Storm score per knock + lead id — used to color/glow canvassing pins.
export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ knock: {}, lead: {} }, { status: 401 });
  }
  return NextResponse.json(await getStormScores(user.companyId));
}
