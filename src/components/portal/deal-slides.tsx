"use client";

import * as React from "react";
import { ShieldCheck, Hammer, DollarSign, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DealSlideDef = { id: string; label: string; icon?: string };

// Icons live here, client-side: a component cannot be passed from a server
// component across the RSC boundary as a prop.
const SLIDE_ICONS: Record<string, LucideIcon> = {
  claim: ShieldCheck,
  field: Hammer,
  financials: DollarSign,
};

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Three related views of the same job, in one card, one at a time.
 *
 * The deal page itself is deliberately ONE scrolling page — nothing important
 * is hidden behind a click. This is the exception that proves it: the claim
 * worksheet, the field photo checklists and the financial breakdown are three
 * *alternative* readings of the same job rather than three things you read in
 * sequence, and stacked they add roughly two screens of scroll to a page that
 * already has plenty.
 *
 * Content stays server-rendered and MOUNTED — switching only toggles
 * `display`, so a half-filled claim form or a photo mid-upload survives a trip
 * to another slide and back.
 */
export function DealSlides({
  slides,
  children,
  className,
}: {
  slides: DealSlideDef[];
  children: React.ReactNode;
  className?: string;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  // DERIVED, not synced in an effect: if the picked slide disappears — a job
  // that has not started, or a role that cannot see financials — fall back to
  // the first one during render. Correcting it in an effect would trip
  // `react-hooks/set-state-in-effect` and render one frame of nothing first.
  const ids = slides.map((s) => s.id);
  const active = picked && ids.includes(picked) ? picked : (ids[0] ?? "");

  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-deal-slide]").forEach((el) => {
      el.style.display = el.getAttribute("data-deal-slide") === active ? "" : "none";
    });
  }, [active]);

  if (slides.length === 0) return null;

  return (
    <section
      className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}
      data-testid="deal-slides"
    >
      <header className="border-b border-border px-3 py-2.5">
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label="Job detail"
        >
          {slides.map((s) => {
            const Icon = SLIDE_ICONS[s.icon ?? s.id];
            const on = active === s.id;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                onClick={() => setPicked(s.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  on
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {Icon && <Icon className="size-4" />}
                {s.label}
              </button>
            );
          })}
        </div>
      </header>
      <div ref={ref} className="p-5">
        {children}
      </div>
    </section>
  );
}
