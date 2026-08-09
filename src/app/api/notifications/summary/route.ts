import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { permittedVerticalFilter, worksAcrossVerticals } from "@/server/vertical/visibility";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0, items: [], showWorkspace: false }, { status: 401 });

  // Notifications are filtered by PERMISSION, not by the workspace currently
  // open: a dual-workspace user must see Solar alerts while standing in Roofing,
  // otherwise the alert is only visible to someone who already knew to look.
  const workspace = permittedVerticalFilter(user);

  const [count, items] = await Promise.all([
    prisma.notification.count({ where: { userId: user.userId, read: false, ...workspace } }),
    prisma.notification.findMany({
      where: { userId: user.userId, ...workspace },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, body: true, link: true, read: true, createdAt: true, vertical: true },
    }),
  ]);

  return NextResponse.json({
    count,
    items,
    // Nobody with a single workspace should see workspace labelling anywhere.
    showWorkspace: worksAcrossVerticals(user),
  });
}
