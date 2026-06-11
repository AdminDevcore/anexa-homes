import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Role } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { ROLES, RESOURCES, grantsForRole } from "@/server/rbac/matrix";
import { PageHeader } from "@/components/portal/ui";
import { roleLabel } from "@/lib/roles";

export const metadata = { title: "Roles & Permissions" };

export default async function RolesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Roles & Permissions"
        description="What each role can see and do. Row-level rules (e.g. reps see only their own appointments) are enforced in addition to these grants."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {ROLES.map((role) => {
          const grant = grantsForRole(role as Role);
          const entries = RESOURCES.filter((r) => grant[r] && grant[r]!.length > 0).map((r) => ({
            resource: r,
            actions: grant[r]!.includes("manage") ? ["full access"] : grant[r]!,
          }));
          return (
            <div key={role} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-gold" />
                <h3 className="font-semibold">{roleLabel(role as Role)}</h3>
              </div>
              {entries.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No portal access.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {entries.map((e) => (
                    <li key={e.resource} className="flex items-start justify-between gap-3 text-sm">
                      <span className="font-medium">{e.resource}</span>
                      <span className="text-right text-xs text-muted-foreground capitalize">
                        {e.actions.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
