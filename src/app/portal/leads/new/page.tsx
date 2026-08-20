import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getLeadFormOptions } from "@/server/modules/leads/queries";
import { listSolarProviders } from "@/server/modules/solar/providers";
import { getActiveVertical } from "@/server/auth/vertical";
import { PageHeader } from "@/components/portal/ui";
import { LeadForm } from "@/components/portal/lead-form";

export const metadata = { title: "New Appointment" };

export default async function NewLeadPage() {
  const user = await requireUser();
  if (!can(user, "create", "Lead")) redirect("/portal/leads");

  const vertical = await getActiveVertical(user);
  const options = await getLeadFormOptions(user.companyId, vertical);
  // Only solar asks for a utility at the door, and only solar pays the query.
  const utilities =
    vertical === "solar" ? await listSolarProviders(user.companyId, "utility") : [];

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
        setters={options.setters}
        utilities={utilities}
        canAssign={can(user, "assign", "Lead")}
        fieldDefs={options.fieldDefs}
        vertical={vertical}
      />
    </div>
  );
}
