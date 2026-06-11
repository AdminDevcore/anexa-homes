import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0, items: [] }, { status: 401 });

  const [count, items] = await Promise.all([
    prisma.notification.count({ where: { userId: user.userId, read: false } }),
    prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, body: true, link: true, read: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({ count, items });
}
