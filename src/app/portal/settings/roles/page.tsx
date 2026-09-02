import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { ROLES, RESOURCES, grantsForRole } from "@/server/rbac/matrix";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { RolesMatrix } from "@/components/portal/roles-matrix";
import { roleLabel } from "@/lib/roles";

export const metadata = { title: "Roles & Permissions" };

export default async function RolesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");

  // Resolved on the server: the matrix is code, and this is the one place it is
  // read out loud. "manage" is every action, so it is said that way rather than
  // listed as four verbs a reader has to add up.
  const roles = ROLES.map((role) => {
    const grant = grantsForRole(role as Role);
    return {
      role,
      label: roleLabel(role as Role),
      entries: RESOURCES.filter((r) => grant[r] && grant[r]!.length > 0).map((r) => ({
        resource: r,
        actions: grant[r]!.includes("manage") ? ["full access"] : [...grant[r]!],
      })),
    };
  });

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="roles"
        description="What each role can see and do. Row-level rules — a rep sees only their own appointments — are enforced on top of these grants."
      />
      <RolesMatrix roles={roles} />
    </div>
  );
}
