import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listConversations } from "@/server/modules/chat/queries";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Chat")) {
    return NextResponse.json({ conversations: [] }, { status: 401 });
  }
  const conversations = await listConversations(user.companyId, user.userId);
  return NextResponse.json({ conversations });
}
