import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { getBookkeepingData } from "@/server/modules/bookkeeping/queries";
import { BookkeepingClient } from "@/components/portal/bookkeeping-client";

export const metadata = { title: "Bookkeeping" };

export default async function BookkeepingPage() {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");
  const data = await getBookkeepingData(user.companyId);
  const canEdit = can(user, "update", "Bookkeeping");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookkeeping"
        description="Transactions, categories, and your profit & loss — all in one ledger."
      />
      <BookkeepingClient data={data} canEdit={canEdit} />
    </div>
  );
}
