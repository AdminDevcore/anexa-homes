"use client";

import * as React from "react";
import {
  Calculator,
  ChevronDown,
  DollarSign,
  Hammer,
  History,
  MessageSquare,
  PanelsTopLeft,
  ReceiptText,
  ShieldCheck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DealSlideDef = { id: string; label: string; icon?: string };

// Icons live here, client-side: a component cannot be passed from a server
// component across the RSC boundary as a prop.
const SLIDE_ICONS: Record<string, LucideIcon> = {
  claim: ShieldCheck,
  estimate: ReceiptText,
  scope: Calculator,
  field: Hammer,
  financials: DollarSign,
  // Solar's pair. Same icons the two cards carried before they became slides,
  // so the switcher reads as the same two things moved, not as new ones.
  system: Zap,
  activity: MessageSquare,
  timeline: History,
  ops: Wrench,
  install: Hammer,
  specs: PanelsTopLeft,
};

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/* The fold is remembered per card, per browser: whoever folds the job detail
   away to get at what sits below it wants it still folded on the next deal.
   localStorage is an external store, so it is read through
   useSyncExternalStore — the server renders the card open and the client picks
   up the stored fold without a hydration mismatch. localStorage fires no event
   for same-tab writes, hence the manual listener set. */
const FOLD_KEY = "deal-slides-folded:";
const foldListeners = new Set<() => void>();
function subscribeFold(cb: () => void) {
  foldListeners.add(cb);
  return () => {
    foldListeners.delete(cb);
  };
}
function setFolded(key: string, folded: boolean) {
  if (folded) window.localStorage.setItem(key, "1");
  else window.localStorage.removeItem(key);
  foldListeners.forEach((cb) => cb());
}

/**
 * Related views of the same job, in one card, one at a time.
 *
 * The deal page itself is deliberately ONE scrolling page — nothing important
 * is hidden behind a click. This is the exception that proves it: the claim
 * worksheet, the costed scope, the field photo checklists and the financial
 * breakdown are *alternative* readings of the same job rather than things you
 * read in sequence, and stacked they add several screens of scroll to a page
 * that already has plenty. The scope table alone runs 150 catalog lines.
 *
 * Content stays server-rendered and MOUNTED — switching only toggles
 * `display`, so a half-filled claim form or a photo mid-upload survives a trip
 * to another slide and back. Folding the card follows the same rule: the body
 * is `hidden`, never unmounted.
 */
export function DealSlides({
  slides,
  children,
  className,
  id,
  foldable,
}: {
  slides: DealSlideDef[];
  children: React.ReactNode;
  className?: string;
  /** Anchor for a deep link, on the section this already renders. */
  id?: string;
  /**
   * An arrow at the top right that folds the whole card down to its tab bar.
   * Opt-in: the solar deal asked for it; roofing's switcher renders exactly as
   * it did without it.
   */
  foldable?: boolean;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const bodyId = React.useId();
  const foldKey = FOLD_KEY + (id ?? "deal");
  const storedFold = React.useSyncExternalStore(
    subscribeFold,
    () => window.localStorage.getItem(foldKey) === "1",
    () => false
  );
  const folded = !!foldable && storedFold;

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
      id={id}
      className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}
      data-testid="deal-slides"
    >
      <header
        className={cn(
          "border-b border-border px-3 py-2.5",
          foldable && "flex items-start gap-2",
          // Folded, the tab bar is the whole card; its rule would sit on the
          // card's own bottom border as a double line.
          folded && "border-b-0"
        )}
      >
        <div
          className={cn("flex flex-wrap gap-1", foldable && "min-w-0 flex-1")}
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
                onClick={() => {
                  setPicked(s.id);
                  // Picking a slide on a folded card is asking to read it.
                  if (folded) setFolded(foldKey, false);
                }}
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
        {foldable && (
          <button
            type="button"
            aria-expanded={!folded}
            aria-controls={bodyId}
            aria-label={folded ? "Expand job detail" : "Collapse job detail"}
            title={folded ? "Expand" : "Collapse"}
            onClick={() => setFolded(foldKey, !folded)}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            )}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                folded && "-rotate-90"
              )}
            />
          </button>
        )}
      </header>
      <div ref={ref} id={foldable ? bodyId : undefined} hidden={folded} className="p-5">
        {children}
      </div>
    </section>
  );
}
