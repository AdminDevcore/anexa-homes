"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { STAFF_ROLES } from "@/server/rbac/matrix";
import { canDmPair, dmKeyFor } from "./policies";
import { getMembership } from "./queries";

function fail(error: string) {
  return { ok: false as const, error };
}

/** Open (or reuse) a 1:1 DM with another staff member. */
export async function openDmAction(
  targetUserId: string
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "create", "Chat")) return fail("You don't have access to chat.");
  if (targetUserId === me.userId) return fail("You can't message yourself.");

  const target = await prisma.user.findFirst({
    where: { id: targetUserId, companyId: me.companyId, status: "active" },
    select: { id: true, role: true },
  });
  if (!target || !STAFF_ROLES.includes(target.role)) return fail("That person isn't available to message.");
  if (!canDmPair(me.role, target.role)) return fail("Sales reps can't direct-message other sales reps.");

  const key = dmKeyFor(me.userId, target.id);
  const existing = await prisma.conversation.findUnique({
    where: { companyId_dmKey: { companyId: me.companyId, dmKey: key } },
    select: { id: true },
  });
  if (existing) return { ok: true, conversationId: existing.id };

  const convo = await prisma.conversation.create({
    data: {
      companyId: me.companyId,
      type: "dm",
      dmKey: key,
      createdById: me.userId,
      members: { create: [{ userId: me.userId }, { userId: target.id }] },
    },
    select: { id: true },
  });
  return { ok: true, conversationId: convo.id };
}

const channelSchema = z.object({
  name: z.string().min(1, "Channel name is required").max(80),
  memberIds: z.array(z.string()).default([]),
});

/** Create a group channel with the creator plus selected staff members. */
export async function createChannelAction(
  input: z.infer<typeof channelSchema>
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "create", "Chat")) return fail("You don't have access to chat.");

  const parsed = channelSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid channel.");

  // Validate members are active staff in this company.
  const ids = [...new Set(parsed.data.memberIds.filter((id) => id !== me.userId))];
  const members = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids }, companyId: me.companyId, status: "active", role: { in: STAFF_ROLES } },
        select: { id: true },
      })
    : [];

  const convo = await prisma.conversation.create({
    data: {
      companyId: me.companyId,
      type: "channel",
      name: parsed.data.name.trim(),
      createdById: me.userId,
      members: { create: [{ userId: me.userId }, ...members.map((u) => ({ userId: u.id }))] },
    },
    select: { id: true },
  });
  return { ok: true, conversationId: convo.id };
}

const messageSchema = z
  .object({
    conversationId: z.string().min(1),
    body: z.string().max(4000).optional().default(""),
    attachmentIds: z.array(z.string()).optional().default([]),
  })
  // A message needs either text or at least one attachment.
  .refine((d) => d.body.trim().length > 0 || d.attachmentIds.length > 0, {
    message: "Message can't be empty.",
  });

export async function sendMessageAction(
  input: z.infer<typeof messageSchema>
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "create", "Chat")) return fail("You don't have access to chat.");

  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid message.");
  const { conversationId, body, attachmentIds } = parsed.data;

  const membership = await getMembership(me.userId, conversationId);
  if (!membership) return fail("You're not a member of this conversation.");

  const now = new Date();
  const [msg] = await prisma.$transaction([
    prisma.message.create({
      data: { companyId: me.companyId, conversationId, senderId: me.userId, body: body.trim() },
      select: { id: true },
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: me.userId } },
      data: { lastReadAt: now },
    }),
  ]);

  // Link the pre-uploaded attachments to this message — only ones the sender
  // uploaded to this conversation that aren't already attached to a message.
  if (attachmentIds.length) {
    await prisma.fileAsset.updateMany({
      where: { id: { in: attachmentIds }, conversationId, uploadedById: me.userId, messageId: null },
      data: { messageId: msg.id },
    });
  }
  return { ok: true, messageId: msg.id };
}

export async function markReadAction(conversationId: string): Promise<{ ok: boolean }> {
  const me = await requireUser();
  const membership = await getMembership(me.userId, conversationId);
  if (!membership) return { ok: false };
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: me.userId } },
    data: { lastReadAt: new Date() },
  });
  return { ok: true };
}

/** Add a staff member to a channel (must be a current member to invite). */
export async function addChannelMemberAction(
  conversationId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "create", "Chat")) return { ok: false, error: "No access." };

  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, companyId: me.companyId, type: "channel" },
    select: { id: true },
  });
  if (!convo) return { ok: false, error: "Channel not found." };
  if (!(await getMembership(me.userId, conversationId))) return { ok: false, error: "You're not in this channel." };

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId, status: "active", role: { in: STAFF_ROLES } },
    select: { id: true },
  });
  if (!target) return { ok: false, error: "That person can't be added." };

  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    update: {},
    create: { conversationId, userId },
  });
  return { ok: true };
}

/** Leave a channel (DMs can't be left). */
export async function leaveChannelAction(conversationId: string): Promise<{ ok: boolean }> {
  const me = await requireUser();
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, companyId: me.companyId, type: "channel" },
    select: { id: true },
  });
  if (!convo) return { ok: false };
  await prisma.conversationMember.deleteMany({ where: { conversationId, userId: me.userId } });
  return { ok: true };
}
