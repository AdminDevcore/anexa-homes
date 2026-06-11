import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listDmContacts, listChannelContacts } from "@/server/modules/chat/queries";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Chat")) {
    return NextResponse.json({ dm: [], channel: [] }, { status: 401 });
  }
  const [dm, channel] = await Promise.all([
    listDmContacts(user.companyId, user.userId, user.role),
    listChannelContacts(user.companyId, user.userId),
  ]);
  return NextResponse.json({ dm, channel });
}
