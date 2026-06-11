import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { STAFF_ROLES } from "@/server/rbac/matrix";
import { canDmPair } from "./policies";

export type ChatContact = {
  id: string;
  name: string;
  role: Role;
  title: string | null;
  avatarUrl: string | null;
};

export type ConversationSummary = {
  id: string;
  type: "dm" | "channel";
  title: string;
  subtitle: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  unread: number;
  memberCount: number;
};

export type ChatAttachmentDTO = { id: string; name: string; kind: string; mimeType: string | null; url: string };

export type ChatMessage = {
  id: string;
  body: string;
  senderId: string | null;
  senderName: string;
  mine: boolean;
  createdAt: string;
  attachments: ChatAttachmentDTO[];
};

function fullName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`.trim();
}

/** Membership row for the current user, or null if they're not in the conversation. */
export async function getMembership(userId: string, conversationId: string) {
  return prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

/** Staff this user is allowed to start a new DM with (rep<->rep excluded). */
export async function listDmContacts(
  companyId: string,
  selfId: string,
  selfRole: Role
): Promise<ChatContact[]> {
  const users = await prisma.user.findMany({
    where: { companyId, status: "active", role: { in: STAFF_ROLES }, id: { not: selfId } },
    select: { id: true, firstName: true, lastName: true, role: true, title: true, avatarUrl: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return users
    .filter((u) => canDmPair(selfRole, u.role))
    .map((u) => ({ id: u.id, name: fullName(u), role: u.role, title: u.title, avatarUrl: u.avatarUrl }));
}

/** All staff (for channel membership selection). */
export async function listChannelContacts(companyId: string, selfId: string): Promise<ChatContact[]> {
  const users = await prisma.user.findMany({
    where: { companyId, status: "active", role: { in: STAFF_ROLES }, id: { not: selfId } },
    select: { id: true, firstName: true, lastName: true, role: true, title: true, avatarUrl: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return users.map((u) => ({ id: u.id, name: fullName(u), role: u.role, title: u.title, avatarUrl: u.avatarUrl }));
}

/** Conversations the user belongs to, newest activity first, with unread counts. */
export async function listConversations(companyId: string, userId: string): Promise<ConversationSummary[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId, conversation: { companyId } },
    select: {
      lastReadAt: true,
      conversation: {
        select: {
          id: true,
          type: true,
          name: true,
          lastMessageAt: true,
          members: {
            select: {
              userId: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, senderId: true, attachments: { select: { kind: true, name: true } } },
          },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
  });

  const summaries = await Promise.all(
    memberships.map(async (m) => {
      const c = m.conversation;
      const others = c.members.filter((mem) => mem.userId !== userId);
      const title =
        c.type === "channel"
          ? c.name ?? "Channel"
          : others[0]
            ? fullName(others[0].user)
            : "Conversation";
      const subtitle = c.type === "channel" ? `${c.members.length} members` : null;

      const unread = await prisma.message.count({
        where: {
          conversationId: c.id,
          senderId: { not: userId },
          ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
        },
      });

      const last = c.messages[0];
      const atts = last?.attachments ?? [];
      const lastMessage = last
        ? last.body?.trim()
          ? last.body
          : atts.length > 1
            ? `📎 ${atts.length} files`
            : atts.length === 1
              ? atts[0].kind === "photo"
                ? "📷 Photo"
                : `📎 ${atts[0].name}`
              : null
        : null;

      return {
        id: c.id,
        type: c.type,
        title,
        subtitle,
        lastMessage,
        lastMessageAt: c.lastMessageAt.toISOString(),
        unread,
        memberCount: c.members.length,
      } satisfies ConversationSummary;
    })
  );

  return summaries;
}

/** Total unread across all the user's conversations (for the nav badge). */
export async function unreadTotal(companyId: string, userId: string): Promise<number> {
  const summaries = await listConversations(companyId, userId);
  return summaries.reduce((sum, s) => sum + s.unread, 0);
}

/** Messages in a conversation (membership must be checked by the caller). */
export async function getMessages(
  conversationId: string,
  userId: string,
  afterId?: string
): Promise<ChatMessage[]> {
  let afterDate: Date | undefined;
  if (afterId) {
    const anchor = await prisma.message.findUnique({ where: { id: afterId }, select: { createdAt: true } });
    afterDate = anchor?.createdAt;
  }
  const messages = await prisma.message.findMany({
    where: { conversationId, ...(afterDate ? { createdAt: { gt: afterDate } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      senderId: true,
      createdAt: true,
      sender: { select: { firstName: true, lastName: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, kind: true, mimeType: true },
      },
    },
  });
  return messages.map((msg) => ({
    id: msg.id,
    body: msg.body,
    senderId: msg.senderId,
    senderName: msg.sender ? fullName(msg.sender) : "Removed user",
    mine: msg.senderId === userId,
    createdAt: msg.createdAt.toISOString(),
    attachments: msg.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      mimeType: a.mimeType,
      url: `/portal/files/${a.id}`,
    })),
  }));
}
