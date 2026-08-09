import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { NotificationsList } from "@/components/portal/notifications-list";
import { permittedVerticalFilter, worksAcrossVerticals } from "@/server/vertical/visibility";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();

  // Every workspace this person is granted, regardless of which one is open —
  // see permittedVerticalFilter for why notifications use permission scope.
  const items = await prisma.notification.findMany({
    where: { userId: user.userId, ...permittedVerticalFilter(user) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const showWorkspace = worksAcrossVerticals(user);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={
          showWorkspace
            ? "Your activity alerts across every workspace you have access to."
            : "Your activity alerts."
        }
      />
      <NotificationsList
        showWorkspace={showWorkspace}
        items={items.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
          event: n.event,
          vertical: n.vertical,
        }))}
      />
    </div>
  );
}
