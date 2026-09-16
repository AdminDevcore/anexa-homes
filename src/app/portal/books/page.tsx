import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { getBooksOverview } from "@/server/modules/books/queries";
import { BooksClient } from "@/components/portal/books-client";

export const metadata = { title: "Books" };

/**
 * The double-entry books.
 *
 * Gated on `Bookkeeping`, which `rbac/matrix.ts` grants to super_admin and
 * accounting alone — so bank balances and the chart of accounts are unreachable
 * for every other role, at the page AND at each server action it calls.
 */
export default async function BooksPage() {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");

  const data = await getBooksOverview(user.companyId);
  const canEdit = can(user, "update", "Bookkeeping");
  const isOwner = user.role === "super_admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Books"
        description="The chart of accounts, the journal, bank accounts and the period close."
      />
      <BooksClient data={data} canEdit={canEdit} isOwner={isOwner} />
    </div>
  );
}
