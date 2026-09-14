"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* The fold is remembered per card, per browser: whoever folds the version list
   away to get at the documents wants it still folded on the next deal.
   localStorage is an external store, so it is read through
   useSyncExternalStore — the server renders the card open and the client picks
   up the stored fold without a hydration mismatch. localStorage fires no event
   for same-tab writes, hence the manual listener set. */
const FOLD_KEY = "deal-card-folded:";
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
 * The client half of a foldable deal `Card`.
 *
 * `Card` is a server component — it takes an icon component, which cannot cross
 * into a client module — so it renders its own title and hands the finished
 * nodes here. This shell holds the only state: the fold, and the arrow at the
 * top right that flips it. The body is `hidden`, never unmounted, the same rule
 * `DealSlides` keeps, so a half-finished upload survives a fold.
 */
export function FoldableCard({
  foldKey,
  label,
  className,
  headerClassName,
  header,
  action,
  bodyClassName,
  children,
}: {
  foldKey: string;
  /** The card's title, for the arrow's accessible name. */
  label: string;
  className?: string;
  headerClassName?: string;
  header: React.ReactNode;
  action?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const key = FOLD_KEY + foldKey;
  const folded = React.useSyncExternalStore(
    subscribeFold,
    () => window.localStorage.getItem(key) === "1",
    () => false
  );
  const bodyId = React.useId();
  return (
    <section className={className}>
      <header
        className={cn(
          headerClassName,
          // Folded, the header is the whole card; its rule would sit on the
          // card's own bottom border as a double line.
          folded && "border-b-0"
        )}
      >
        {header}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {action}
          <button
            type="button"
            aria-expanded={!folded}
            aria-controls={bodyId}
            aria-label={`${folded ? "Expand" : "Collapse"} ${label}`}
            title={folded ? "Expand" : "Collapse"}
            onClick={() => setFolded(key, !folded)}
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
        </div>
      </header>
      <div id={bodyId} hidden={folded} className={bodyClassName}>
        {children}
      </div>
    </section>
  );
}
