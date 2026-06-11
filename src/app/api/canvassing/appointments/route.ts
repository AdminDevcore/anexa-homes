import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getAppointments } from "@/server/modules/canvassing/queries";

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ appointments: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const appointments = await getAppointments(user.companyId, user.userId, user.role, {
    from: parseDate(searchParams.get("from")),
    to: parseDate(searchParams.get("to")),
    repId: searchParams.get("rep") || undefined,
  });
  return NextResponse.json({ appointments });
}
