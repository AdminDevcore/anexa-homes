import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { ChatClient } from "@/components/portal/chat-client";

export const metadata = { title: "Team Chat" };

export default async function ChatPage() {
  const user = await requireUser("/portal/chat");
  if (!can(user, "read", "Chat")) redirect("/portal/dashboard");
  return <ChatClient />;
}
