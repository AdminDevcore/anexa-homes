"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, KanbanSquare, UserCog, CornerDownLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PORTAL_NAV } from "@/lib/nav";

type Item = { id: string; title: string; subtitle: string | null; href: string };
type SearchResponse = { leads: Item[]; projects: Item[]; team: Item[] };
type Row = { key: string; group: string; icon: LucideIcon; title: string; subtitle?: string | null; href: string };

export function CommandPalette({ allowedHrefs }: { allowedHrefs: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // ⌘K / Ctrl+K toggles the palette anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => { if (open) { setQ(""); setActive(0); } }, [open]);
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 170); return () => clearTimeout(t); }, [q]);

  const { data } = useQuery<SearchResponse>({
    queryKey: ["cmd-search", dq],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(dq)}`);
      if (!res.ok) return { leads: [], projects: [], team: [] };
      return res.json();
    },
    enabled: open && dq.length >= 1,
    placeholderData: (p) => p,
  });

  const pages: Row[] = PORTAL_NAV.filter((n) => allowedHrefs.includes(n.href))
    .filter((n) => !dq || n.label.toLowerCase().includes(dq.toLowerCase()))
    .map((n) => ({ key: `p:${n.href}`, group: "Pages", icon: n.icon, title: n.label, href: n.href }));

  const rows: Row[] = dq
    ? [
        ...pages,
        ...(data?.leads ?? []).map((l): Row => ({ key: `l:${l.id}`, group: "Appointments", icon: Users, title: l.title, subtitle: l.subtitle, href: l.href })),
        ...(data?.projects ?? []).map((p): Row => ({ key: `pr:${p.id}`, group: "Projects", icon: KanbanSquare, title: p.title, subtitle: p.subtitle, href: p.href })),
        ...(data?.team ?? []).map((u): Row => ({ key: `u:${u.id}`, group: "Team", icon: UserCog, title: u.title, subtitle: u.subtitle, href: u.href })),
      ]
    : pages;

  React.useEffect(() => { setActive(0); }, [dq, data]);
  React.useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = rows[active]; if (r) go(r.href); }
  }

  let lastGroup = "";

  // No visible trigger — opens via ⌘K / Ctrl+K only (per-page search boxes handle
  // in-page filtering). Kept mounted so the universal jump-search stays available.
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search appointments, projects, team — or jump to a page…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">esc</kbd>
          </div>

          <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
            {rows.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {dq ? "No results." : "Type to search."}
              </div>
            ) : (
              rows.map((row, i) => {
                const header = row.group !== lastGroup ? row.group : null;
                lastGroup = row.group;
                return (
                  <React.Fragment key={row.key}>
                    {header && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</div>}
                    <button
                      data-active={i === active}
                      onClick={() => go(row.href)}
                      onMouseMove={() => setActive(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm",
                        i === active ? "bg-foreground text-background" : "hover:bg-muted"
                      )}
                    >
                      <row.icon className={cn("size-4 shrink-0", i === active ? "text-background" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{row.title}</span>
                        {row.subtitle && <span className={cn("block truncate text-xs", i === active ? "text-background/70" : "text-muted-foreground")}>{row.subtitle}</span>}
                      </span>
                      {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-background/70" />}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
