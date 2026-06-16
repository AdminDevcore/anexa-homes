import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getWelcomeCallTemplates } from "@/server/modules/welcome-call/queries";
import { PageHeader } from "@/components/portal/ui";
import { WelcomeCallTemplatesManager } from "@/components/portal/welcome-call-templates-manager";

export const metadata = { title: "Call Templates" };

export default async function CallTemplatesPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getWelcomeCallTemplates(user.companyId);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Call Templates"
        description="Author reusable call scripts — Welcome Calls (after the sale) and Completion Calls (after the install) — confirmation items that pull in live deal data for reps to send customers."
      />
      <WelcomeCallTemplatesManager items={items} />
    </div>
  );
}
