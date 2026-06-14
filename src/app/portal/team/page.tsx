import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { roleLabel } from "@/lib/roles";
import { getTeamMembers, getPendingInvitations, ROLE_ORDER } from "@/server/modules/team/queries";
import { TeamClient } from "@/components/portal/team-client";
import { TeamInvite } from "@/components/portal/team-invite";
import { TeamPendingInvites } from "@/components/portal/team-pending-invites";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requireUser();
  if (!can(user, "read", "User")) redirect("/portal/dashboard");

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [members, pendingInvites] = await Promise.all([getTeamMembers(ru), getPendingInvitations(ru)]);
  const roles = ROLE_ORDER.map((r) => ({ value: r, label: roleLabel(r) }));
  const canInvite = can(user, "create", "User");

  const description =
    pendingInvites.length > 0
      ? `${members.length} team member${members.length === 1 ? "" : "s"} · ${pendingInvites.length} pending invite${pendingInvites.length === 1 ? "" : "s"}`
      : `${members.length} team member${members.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={description}
        action={canInvite ? <TeamInvite roles={roles} isSuperAdmin={user.role === "super_admin"} /> : undefined}
      />
      {canInvite && <TeamPendingInvites invites={pendingInvites} />}
      <TeamClient members={members} roles={roles} />
    </div>
  );
}
