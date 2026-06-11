import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getRepDashboard } from "@/server/modules/canvassing/queries";

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const data = await getRepDashboard(user.companyId, user.userId, user.role, {
    repId: searchParams.get("rep") || undefined,
    range: { from: parseDate(searchParams.get("from")), to: parseDate(searchParams.get("to")) },
  });
  return NextResponse.json(data);
}
