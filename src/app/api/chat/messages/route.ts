import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getMembership, getMessages } from "@/server/modules/chat/queries";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Chat")) {
    return NextResponse.json({ messages: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversationId");
  const after = searchParams.get("after") ?? undefined;
  if (!conversationId) return NextResponse.json({ messages: [] }, { status: 400 });

  const membership = await getMembership(user.userId, conversationId);
  if (!membership) return NextResponse.json({ messages: [] }, { status: 403 });

  const messages = await getMessages(conversationId, user.userId, after);
  return NextResponse.json({ messages });
}
