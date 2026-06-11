import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getCanvassingMeta } from "@/server/modules/canvassing/queries";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = await getCanvassingMeta(user.companyId, user.userId, user.role);
  return NextResponse.json(data);
}
