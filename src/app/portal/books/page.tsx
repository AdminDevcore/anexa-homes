import { redirect } from "next/navigation";
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { getBooksOverview } from "@/server/modules/books/queries";
import { BooksClient } from "@/components/portal/books-client";
import { STATEMENT_META } from "@/server/modules/books/statements";
import { STATEMENT_SLUGS } from "@/server/modules/books/statement-request";

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

      {/*
        The statements are their own routes rather than a fifth tab, because a
        statement is defined by its period, basis, department and comparison —
        and those belong in the URL, so a link to "last year, cash basis" is a
        link someone can send. Tab state in a client component cannot be sent to
        anybody.
      */}
      <nav className="flex flex-wrap gap-2">
        {STATEMENT_SLUGS.map((slug) => (
          <Link
            key={slug}
            href={`/portal/books/statements/${slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-gold/40 hover:bg-muted/40"
          >
            <FileBarChart className="size-4 text-gold" />
            {STATEMENT_META[slug].title}
          </Link>
        ))}
      </nav>

      <BooksClient data={data} canEdit={canEdit} isOwner={isOwner} />
    </div>
  );
}
