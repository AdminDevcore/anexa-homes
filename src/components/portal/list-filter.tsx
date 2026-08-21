"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type Ctx = { q: string; setQ: (v: string) => void; placeholder: string };

const ListFilterContext = React.createContext<Ctx | null>(null);

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
 * Per-page search that filters the list it wraps. Any descendant marked with
 * `data-search-item` is shown/hidden by whether its text matches the query.
 * Works for server- AND client-rendered lists (it filters the live DOM and
 * re-applies when the list re-renders).
 *
 * `data-search-text` ADDS to what is matched rather than replacing it — that is
 * how off-screen terms (a job's full address, a truncated ZIP) become
 * searchable without having to restate every visible column.
 *
 * Add a `data-search-empty` element to show a "no matches" message.
 */
export function ListFilter({
  placeholder = "Search this page…",
  className,
  hideInput = false,
  children,
}: {
  placeholder?: string;
  className?: string;
  /** Suppress the default box; render `<ListFilterInput />` in your own layout. */
  hideInput?: boolean;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [q, setQ] = React.useState("");
  const qRef = React.useRef("");
  qRef.current = q;

  const apply = React.useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const needle = qRef.current.trim().toLowerCase();
    const items = root.querySelectorAll<HTMLElement>("[data-search-item]");
    let visible = 0;
    items.forEach((el) => {
      const text = `${el.getAttribute("data-search-text") || ""} ${el.textContent || ""}`.toLowerCase();
      const show = !needle || text.includes(needle);
      el.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    const empty = root.querySelector<HTMLElement>("[data-search-empty]");
    if (empty) empty.style.display = needle && visible === 0 ? "" : "none";
  }, []);

  React.useEffect(() => { apply(); }, [q, apply]);
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Re-apply the active filter whenever the wrapped list re-renders.
    const obs = new MutationObserver(() => apply());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [apply]);

  const ctx = React.useMemo(() => ({ q, setQ, placeholder }), [q, placeholder]);

  return (
    <ListFilterContext.Provider value={ctx}>
      <div className={className}>
        {!hideInput && <ListFilterInput className="mb-4 max-w-sm" />}
        <div ref={ref}>{children}</div>
      </div>
    </ListFilterContext.Provider>
  );
}
