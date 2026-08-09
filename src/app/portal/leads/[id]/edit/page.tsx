import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getLeadDetail, getLeadFormOptions } from "@/server/modules/leads/queries";
import { PageHeader } from "@/components/portal/ui";
import { LeadForm } from "@/components/portal/lead-form";

export const metadata = { title: "Edit Appointment" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "update", "Lead")) redirect(`/portal/leads/${id}`);

  const lead = await getLeadDetail(user, id);
  if (!lead) notFound();
  // Stages from the deal's own vertical pipeline.
  const options = await getLeadFormOptions(user.companyId, lead.vertical);

  return (
    <div className="space-y-6">
      <Link href={`/portal/leads/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to appointment
      </Link>
      <PageHeader title={`Edit: ${lead.firstName} ${lead.lastName}`} />
      <LeadForm
        mode="edit"
        leadId={lead.id}
        initial={{
          firstName: lead.firstName,
          lastName: lead.lastName,
          coOwnerName: lead.coOwnerName ?? "",
          preferredLanguage: lead.preferredLanguage ?? "",
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          address: lead.address ?? "",
          city: lead.city ?? "",
          state: lead.state ?? "",
          zip: lead.zip ?? "",
          sourceId: lead.sourceId ?? "",
          stageId: lead.stageId ?? "",
          assignedRepId: lead.assignedRepId ?? "",
          serviceType: lead.serviceType,
          dealType: lead.dealType,
          priority: lead.priority,
          valueDollars: lead.value ? String(lead.value / 100) : "",
          appointmentDate: lead.appointmentAt ? lead.appointmentAt.toISOString().slice(0, 16) : "",
          notes: lead.notes ?? "",
          customFields: (lead.customFields as Record<string, string>) ?? {},
        }}
        sources={options.sources}
        stages={options.stages}
        reps={options.reps}
        canAssign={can(user, "assign", "Lead")}
        fieldDefs={options.fieldDefs}
        vertical={lead.vertical}
      />
    </div>
  );
}
