import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { currentFormatters } from "@/lib/format-server";
import { buildAppointmentRows } from "@/server/modules/leads/appointment-rows";
import { AppointmentsList } from "@/components/portal/appointments-list";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { dispositionLabels } from "@/lib/dispositions";

export const metadata = { title: "Appointments" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const fmt = await currentFormatters();
  const user = await requireUser();
  if (!can(user, "read", "Lead")) redirect("/portal/dashboard");

  const { q } = await searchParams;
  // Isolate by the active vertical workspace (Roofing / Solar).
  const vertical = await getActiveVertical(user);
  const scope: Prisma.LeadWhereInput = { ...(listScope(user, "Lead") as Prisma.LeadWhereInput), vertical };

  // The outcome chips mirror Settings → Appointment Outcomes so every possible
  // result is visible, including the ones nobody has recorded yet.
  //
  // Scoped to the active vertical: outcomes are configured per vertical, so a
  // roofing user must never see "Signed — proposal accepted" and a solar user
  // must never see "Hail Damage". Passing the vertical is what keeps the chips
  // on the correct side of the boundary.
  const dispositions = await getAppointmentDispositions(user.companyId, vertical);

  const leads = await prisma.lead.findMany({
    where: scope,
    // Scheduled appointments first (soonest-known first), unscheduled last.
    orderBy: [{ appointmentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      // isLost is what marks the deal dead — see NOT_CANCELLED. Cancelled deals
      // are still FETCHED here: they are hidden by the list's default chip, not
      // by the query, so the Cancelled chip and a name search can still reach
      // them without a second round trip.
      stage: { select: { name: true, color: true, isLost: true } },
      source: { select: { name: true } },
      assignedRep: { select: { firstName: true, lastName: true } },
    },
  });

  const rows = buildAppointmentRows(leads, fmt);
  // The header counts what the list opens on — the live deals — so it agrees
  // with the All chip rather than with the raw query.
  const cancelled = rows.filter((r) => r.isCancelled).length;
  const live = rows.length - cancelled;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description={
          `${live} ${live === 1 ? "appointment" : "appointments"} in your view` +
          (cancelled > 0 ? ` · ${cancelled} cancelled` : "")
        }
        action={
          can(user, "create", "Lead") && (
            <Button asChild className="bg-gold text-gold-foreground hover:bg-gold/90">
              <Link href="/portal/leads/new">
                <Plus className="size-4" /> New Appointment
              </Link>
            </Button>
          )
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No appointments found"
          description="Appointments from canvassing conversions, lead providers, and website inquiries will appear here."
        />
      ) : (
        <AppointmentsList
          rows={rows}
          initialQuery={q ?? ""}
          configuredOutcomes={dispositionLabels(dispositions)}
        />

      )}
    </div>
  );
}
