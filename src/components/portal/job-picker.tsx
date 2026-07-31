"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, X, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { LeadLookupItem } from "@/app/api/leads/lookup/route";

export type JobOption = LeadLookupItem;

/**
 * Typeahead for tagging a task to a specific job (deal). Searches by customer
 * name, address, phone or email via /api/leads/lookup, which is scoped to the
 * deals this user may see — so a rep can only ever tag their own jobs.
 *
 * A picked job collapses to a chip; the caller gets the whole option (not just
 * an id) so it can pre-select the deal's assigned rep as the task's assignee.
 */
export function JobPicker({
  value,
  onChange,
  placeholder = "Search a job by name or address…",
}: {
  value: JobOption | null;
  onChange: (job: JobOption | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery<{ leads: JobOption[] }>({
    queryKey: ["job-picker", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/leads/lookup?q=${encodeURIComponent(debounced)}`);
      if (!res.ok) return { leads: [] };
      return res.json();
    },
    enabled: open && debounced.length >= 2,
    staleTime: 60 * 1000,
  });
  const results = data?.leads ?? [];

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(job: JobOption) {
    onChange(job);
    setQ("");
    setDebounced("");
    setOpen(false);
  }

  // A tagged job collapses to a chip — the search field is only for finding one.
  if (value) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 px-2.5 py-2">
        <Briefcase className="mt-0.5 size-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{value.name}</div>
          {value.subtitle ? (
            <div className="truncate text-xs text-muted-foreground">{value.subtitle}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remove job"
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Never let the dropdown's Enter submit the surrounding form.
              e.preventDefault();
              if (open && results[0]) pick(results[0]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className="pl-8"
          autoComplete="off"
          aria-label="Search for a job"
        />
        {isFetching && open ? (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {open && debounced.length >= 2 ? (
        <div className="absolute z-[60] mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {isFetching ? "Searching…" : "No matching job."}
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <Briefcase className="mt-0.5 size-3.5 shrink-0 text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{r.name}</span>
                  {r.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                  ) : null}
                </span>
                {r.assignedRepName ? (
                  <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">
                    {r.assignedRepName}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
