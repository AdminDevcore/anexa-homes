import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getLeadFormOptions } from "@/server/modules/leads/queries";
import { getActiveIndustry } from "@/server/auth/industry";
import { PageHeader } from "@/components/portal/ui";
import { LeadForm } from "@/components/portal/lead-form";

export const metadata = { title: "New Appointment" };

export default async function NewLeadPage() {
  const user = await requireUser();
  if (!can(user, "create", "Lead")) redirect("/portal/leads");

  const options = await getLeadFormOptions(user.companyId, await getActiveIndustry(user));

  return (
    <div className="space-y-6">
      <Link href="/portal/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to appointments
      </Link>
      <PageHeader title="New Appointment" description="Book an appointment and capture the customer’s details." />
      <LeadForm
        mode="create"
        sources={options.sources}
        stages={options.stages}
        reps={options.reps}
        canAssign={can(user, "assign", "Lead")}
        fieldDefs={options.fieldDefs}
      />
    </div>
  );
}
