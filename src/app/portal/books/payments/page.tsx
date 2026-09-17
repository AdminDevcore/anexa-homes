import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { PaymentsClient } from "@/components/portal/payments-client";
import { getPaymentsOverview } from "@/server/modules/payments/queries";
import { configuredAchProviderId } from "@/server/modules/payments/providers";

export const metadata = { title: "Payments" };

/**
 * MOVING MONEY OUT.
 *
 * Gated on `Payment`, NOT on `Bookkeeping`. That split is deliberate and is
 * made in rbac/matrix.ts: reading the books and sending money are different
 * powers, and `accounting` holds `Bookkeeping: ALL` — so folding payments under
 * it would have granted "can move money" to everyone who already had `manage`
 * on the ledger, by inheritance rather than by decision.
 *
 * The verbs are separated again inside the page. `create` raises a payment,
 * `approve` releases one, and the module enforces that they cannot be the same
 * person for the same payment — a rule no permission can express, because it is
 * about WHO acted, not about what they may do.
 */
export default async function PaymentsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Payment")) redirect("/portal/dashboard");

  const data = await getPaymentsOverview(user.companyId, user.userId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Paying vendors by ACH. Two people, a second factor, and a cooling-off period on new bank details."
      />

      <Link
        href="/portal/books"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to the books
      </Link>

      <PaymentsClient
        data={data}
        canCreate={can(user, "create", "Payment")}
        canApprove={can(user, "approve", "Payment")}
        canUpdate={can(user, "update", "Payment")}
        provider={configuredAchProviderId()}
      />
    </div>
  );
}
