import Link from "next/link";
import { can, type AccessUser } from "@/server/rbac/guards";
import { PAY_TABS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The tab strip shared by Commissions and Contractor Pay.
 *
 * The two used to be separate sidebar items, which meant the sales floor's pay
 * and the crews' pay were two screens that did not know about each other even
 * though they end up in the same payroll run. They are one page now, and the
 * sidebar carries a single row (Commissions) that highlights on both.
 *
 * Real routes rather than a `?tab=` parameter — each half already owns URLs
 * that have been bookmarked for months, and the invoice side rebuilds its query
 * string from scratch every time someone searches.
 *
 * `counts` is what is WAITING on the other side: pending commissions, invoices
 * still needing a price or an approval. It is the whole reason to draw a badge —
 * an accountant sitting on Commissions should not have to click Contractor Pay
 * to discover three crews have been waiting a week.
 */
export function PayTabs({
  user,
  active,
  counts,
}: {
  user: AccessUser;
  /** The href of the tab being shown. */
  active: string;
  /** href → number of rows needing someone's attention. */
  counts?: Record<string, number>;
}) {
  const tabs = PAY_TABS.filter((t) => can(user, "read", t.resource));

  // One tab is not a choice, so it is not drawn as one. Almost everyone in the
  // company lands here: ContractorInvoice is accounting's alone.
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label="Pay sections"
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1"
    >
      {tabs.map((t) => {
        const isActive = t.href === active;
        const waiting = counts?.[t.href] ?? 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              isActive
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            <t.icon className="size-4 shrink-0" />
            {t.label}
            {waiting > 0 && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  isActive ? "bg-gold/15 text-gold-muted" : "bg-foreground/10 text-foreground/70"
                )}
              >
                {waiting}
                <span className="sr-only"> awaiting action</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
