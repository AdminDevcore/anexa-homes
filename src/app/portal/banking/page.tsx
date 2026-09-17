import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { getFeedOverview } from "@/server/modules/bank-feeds/queries";
import { configuredProviderId } from "@/server/modules/bank-feeds";
import { BankingClient } from "@/components/portal/banking-client";

export const metadata = { title: "Banking" };

/**
 * The bank feed and its review queue.
 *
 * Gated on `Bookkeeping`, which `rbac/matrix.ts` grants to super_admin and
 * accounting alone — so balances, transactions and the connect flow are
 * unreachable for every other role, at the page AND at each server action.
 */
export default async function BankingPage() {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");

  const data = await getFeedOverview(user.companyId);
  const canEdit = can(user, "update", "Bookkeeping");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banking"
        description="Transactions from the bank, waiting to be told what they are."
      />
      <BankingClient
        data={data}
        canEdit={canEdit}
        provider={configuredProviderId()}
        webhookConfigured={Boolean(process.env.PLAID_WEBHOOK_URL?.trim())}
      />
    </div>
  );
}
