"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Per-page search that filters the list it wraps. Any descendant marked with
 * `data-search-item` is shown/hidden by whether its text (or an explicit
 * `data-search-text`) matches the query. Works for server- AND client-rendered
 * lists (it filters the live DOM and re-applies when the list re-renders).
 * Add a `data-search-empty` element to show a "no matches" message.
 */
export function ListFilter({
  placeholder = "Search this page…",
  className,
  children,
}: {
  placeholder?: string;
  className?: string;
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
      const text = (el.getAttribute("data-search-text") || el.textContent || "").toLowerCase();
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

  return (
    <div className={className}>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 pl-8" aria-label="Search this page" />
      </div>
      <div ref={ref}>{children}</div>
    </div>
  );
}
