import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { roleLabel } from "@/lib/roles";
import { getTeamMembers, ROLE_ORDER } from "@/server/modules/team/queries";
import { TeamClient } from "@/components/portal/team-client";
import { TeamInvite } from "@/components/portal/team-invite";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requireUser();
  if (!can(user, "read", "User")) redirect("/portal/dashboard");

  const members = await getTeamMembers({ companyId: user.companyId, userId: user.userId, role: user.role });
  const roles = ROLE_ORDER.map((r) => ({ value: r, label: roleLabel(r) }));
  const canInvite = can(user, "create", "User");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={`${members.length} team members`}
        action={canInvite ? <TeamInvite roles={roles} isSuperAdmin={user.role === "super_admin"} /> : undefined}
      />
      <TeamClient members={members} roles={roles} />
    </div>
  );
}
