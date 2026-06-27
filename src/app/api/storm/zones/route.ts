import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormZones } from "@/server/modules/storm/queries";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ zones: [] }, { status: 401 });
  }
  const zones = await getStormZones(user.companyId);
  return NextResponse.json({ zones });
}
