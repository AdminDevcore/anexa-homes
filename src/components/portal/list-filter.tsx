"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** One chip in the facet row: a value of `data-search-facet` plus its tally. */
export type ListFacet = { key: string; label: string; count?: number };

type Ctx = {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  facets: ListFacet[];
  facet: string;
  setFacet: (v: string) => void;
};

const ListFilterContext = React.createContext<Ctx | null>(null);

/** The key that means "don't narrow by facet at all". */
const ALL = "all";

/**
 * The search box itself. Rendered above the list by default; pass `hideInput`
 * to `ListFilter` and drop this anywhere inside it instead (e.g. next to a
 * page's view toggle) to place the box yourself.
 */
export function ListFilterInput({ className }: { className?: string }) {
  const ctx = React.useContext(ListFilterContext);
  if (!ctx) return null;
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={ctx.q}
        onChange={(e) => ctx.setQ(e.target.value)}
        placeholder={ctx.placeholder}
        className="h-9 pl-8"
        aria-label="Search this page"
      />
    </div>
  );
}

/**
 * The facet chips — "All / Pending / Approved / Paid" and their counts.
 *
 * Same mechanism as the search box, deliberately: one pass over the DOM decides
 * what is visible, so a chip and a query narrow the list TOGETHER instead of
 * fighting over `display`. Rendered by `ListFilter` when it is given `facets`,
 * or placed by hand alongside a page's own controls.
 */
export function ListFilterChips({ className }: { className?: string }) {
  const ctx = React.useContext(ListFilterContext);
  if (!ctx || ctx.facets.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Filter by status">
      {ctx.facets.map((f) => {
        const active = ctx.facet === f.key;
        return (
          <button
            key={f.key}
            type="button"
            aria-pressed={active}
            onClick={() => ctx.setFacet(active && f.key !== ALL ? ALL : f.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
              active
                ? "border-gold/45 bg-gold/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
            {typeof f.count === "number" && (
              <span className={cn("tabular-nums", active ? "text-gold-muted" : "text-muted-foreground/70")}>
                {f.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Per-page search that filters the list it wraps. Any descendant marked with
 * `data-search-item` is shown/hidden by whether its text matches the query.
 * Works for server- AND client-rendered lists (it filters the live DOM and
 * re-applies when the list re-renders).
 *
 * `data-search-text` ADDS to what is matched rather than replacing it — that is
 * how off-screen terms (a job's full address, a truncated ZIP) become
 * searchable without having to restate every visible column.
 *
 * `data-search-facet` is the item's bucket — its status, usually. Pass `facets`
 * to draw the chips that switch between them; an item with no facet attribute
 * survives every chip but "all" only when it matches nothing, so tag every row
 * in a faceted list.
 *
 * Add a `data-search-empty` element to show a "no matches" message, and
 * `data-search-hide-when-empty` to whatever should disappear along with the
 * rows — a table's header, say, which is a promise of columns that are no
 * longer there.
 */
export function ListFilter({
  placeholder = "Search this page…",
  className,
  hideInput = false,
  facets = [],
  children,
}: {
  placeholder?: string;
  className?: string;
  /** Suppress the default box; render `<ListFilterInput />` in your own layout. */
  hideInput?: boolean;
  /** Status chips. The "all" chip is prepended for you. */
  facets?: ListFacet[];
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [q, setQ] = React.useState("");
  const [facet, setFacet] = React.useState(ALL);
  // What `apply` should filter by, mirrored into a ref so `apply` itself never
  // changes identity — the MutationObserver below is created once and keeps
  // reading the current query through this.
  const filterRef = React.useRef({ q: "", facet: ALL });

  const apply = React.useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const needle = filterRef.current.q.trim().toLowerCase();
    const bucket = filterRef.current.facet;
    const items = root.querySelectorAll<HTMLElement>("[data-search-item]");
    let visible = 0;
    items.forEach((el) => {
      const text = `${el.getAttribute("data-search-text") || ""} ${el.textContent || ""}`.toLowerCase();
      const show =
        (!needle || text.includes(needle)) &&
        (bucket === ALL || el.getAttribute("data-search-facet") === bucket);
      el.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    const empty = root.querySelector<HTMLElement>("[data-search-empty]");
    if (empty) empty.style.display = (needle || bucket !== ALL) && visible === 0 ? "" : "none";
    // The furniture around a list — a table's header row, a card grid's
    // spacing — has nothing to say when every row is hidden, so it goes too.
    root.querySelectorAll<HTMLElement>("[data-search-hide-when-empty]").forEach((el) => {
      el.style.display = visible === 0 ? "none" : "";
    });
  }, []);

  React.useEffect(() => {
    filterRef.current = { q, facet };
    apply();
  }, [q, facet, apply]);
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Re-apply the active filter whenever the wrapped list re-renders.
    const obs = new MutationObserver(() => apply());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [apply]);

  const withAll = React.useMemo<ListFacet[]>(
    () => (facets.length ? [{ key: ALL, label: "All" }, ...facets] : []),
    [facets]
  );

  const ctx = React.useMemo(
    () => ({ q, setQ, placeholder, facets: withAll, facet, setFacet }),
    [q, placeholder, withAll, facet]
  );

  return (
    <ListFilterContext.Provider value={ctx}>
      <div className={className}>
        {/* Without chips the header is exactly the lone box it always was —
            every page that predates facets renders unchanged. */}
        {withAll.length === 0
          ? !hideInput && <ListFilterInput className="mb-4 max-w-sm" />
          : (
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              {!hideInput && <ListFilterInput className="max-w-sm sm:w-72" />}
              <ListFilterChips />
            </div>
          )}
        <div ref={ref}>{children}</div>
      </div>
    </ListFilterContext.Provider>
  );
}
