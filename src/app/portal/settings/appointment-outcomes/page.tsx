import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { PageHeader } from "@/components/portal/ui";
import { AppointmentDispositionsManager } from "@/components/portal/appointment-dispositions-manager";

export const metadata = { title: "Appointment Outcomes" };

export default async function AppointmentOutcomesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getAppointmentDispositions(user.companyId, await getActiveVertical(user));

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Appointment Outcomes"
        description="Customize the outcomes a rep can record when running an appointment, their wording, and order."
      />
      <AppointmentDispositionsManager items={items} />
    </div>
  );
}
