import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { NotificationsList } from "@/components/portal/notifications-list";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();

  const items = await prisma.notification.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Your activity alerts." />
      <NotificationsList
        items={items.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
          event: n.event,
        }))}
      />
    </div>
  );
}
