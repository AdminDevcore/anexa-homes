import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { unreadTotal } from "@/server/modules/chat/queries";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Chat")) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }
  const count = await unreadTotal(user.companyId, user.userId);
  return NextResponse.json({ count });
}
