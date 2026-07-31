import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { currentFormatters } from "@/lib/format-server";
import { buildAppointmentRows } from "@/server/modules/leads/appointment-rows";
import { AppointmentsList } from "@/components/portal/appointments-list";

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
  // Isolate by the active industry workspace.
  const industry = await getActiveIndustry(user);
  const scope: Prisma.LeadWhereInput = { ...(listScope(user, "Lead") as Prisma.LeadWhereInput), industry };

  const leads = await prisma.lead.findMany({
    where: scope,
    // Scheduled appointments first (soonest-known first), unscheduled last.
    orderBy: [{ appointmentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      stage: { select: { name: true, color: true } },
      source: { select: { name: true } },
      assignedRep: { select: { firstName: true, lastName: true } },
    },
  });

  const rows = buildAppointmentRows(leads, fmt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description={`${leads.length} ${leads.length === 1 ? "appointment" : "appointments"} in your view`}
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
        <AppointmentsList rows={rows} initialQuery={q ?? ""} />
      )}
    </div>
  );
}
