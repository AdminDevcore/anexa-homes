import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The two halves of Contractor Pay: what the crews have BILLED, and what they
 * are OWED.
 *
 * They used to live apart — the owed side as one more card in the Reports hub,
 * the billed side nowhere at all — which meant the question "should I pay this
 * invoice?" was answered on two screens that did not know about each other.
 *
 * Real routes rather than a `?tab=` parameter, because the payouts side carries
 * period and scope controls that rebuild the query string from scratch; a tab
 * held in that string would drop itself the first time someone changed the
 * month.
 */
export function ContractorPayTabs({
  active,
  showPayouts,
}: {
  active: "invoices" | "payouts";
  showPayouts: boolean;
}) {
  const tabs = [
    { key: "invoices" as const, label: "Invoices", href: "/portal/contractor-pay" },
    ...(showPayouts
      ? [{ key: "payouts" as const, label: "Payouts", href: "/portal/contractor-pay/payouts" }]
      : []),
  ];

  // One tab is not a choice, so it is not drawn as one.
  if (tabs.length < 2) return null;

  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Contractor Pay sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === t.key
              ? "border-gold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
