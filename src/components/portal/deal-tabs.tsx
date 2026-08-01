"use client";

import * as React from "react";
import { User, ShieldCheck, Hammer, DollarSign, FileSignature, Calculator, Sun, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** `icon` overrides the id-based lookup — solar Operations is not a hammer. */
export type DealTabDef = { id: string; label: string; icon?: string };

// Icons live here (client side) — components can't be passed from a server
// component across the RSC boundary as props.
const TAB_ICONS: Record<string, LucideIcon> = {
  overview: User,
  claim: ShieldCheck,
  scope: Calculator,
  production: Hammer,
  financials: DollarSign,
  documents: FileSignature,
  // Solar: the whole present-and-close flow lives under one tab.
  proposal: Sun,
  // Solar operations is electrical work, not carpentry.
  operations: Zap,
};

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Segmented tabs for the deal page. Wraps the (server-rendered) content groups;
 * each direct child marked with `data-deal-tab="<id>"` is shown only when its tab
 * is active. Content stays mounted — switching is instant with no refetch.
 */
export function DealTabs({ tabs, children }: { tabs: DealTabDef[]; children: React.ReactNode }) {
  const [active, setActive] = React.useState(tabs[0]?.id ?? "");
  const ref = React.useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-deal-tab]").forEach((el) => {
      el.style.display = el.getAttribute("data-deal-tab") === active ? "" : "none";
    });
  }, [active]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map((t) => {
          const Icon = TAB_ICONS[t.icon ?? t.id];
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                active === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {Icon && <Icon className="size-4" />}
              {t.label}
            </button>
          );
        })}
      </div>
      <div ref={ref} className="space-y-6">
        {children}
      </div>
    </div>
  );
}
