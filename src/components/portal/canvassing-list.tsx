"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, ArrowUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { KNOCKED_DISPOSITIONS, dispositionMeta } from "@/lib/canvassing";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DateRangeFilter, resolveRange, type RangePreset } from "./canvassing-filters";
import type { CanvassingMeta, KnockListRow } from "@/server/modules/canvassing/queries";

type SortCol = "address" | "status" | "repName" | "territoryName" | "knockedAt";

export function CanvassingList() {
  const { data: meta } = useQuery<CanvassingMeta>({
    queryKey: ["canvassing-meta"],
    queryFn: async () => (await fetch("/api/canvassing/data")).json(),
  });
  const canManage = meta?.me.canManageAll ?? false;
  const reps = meta?.reps ?? [];

  const [repFilter, setRepFilter] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [preset, setPreset] = React.useState<RangePreset>("week");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<{ col: SortCol; dir: 1 | -1 }>({ col: "knockedAt", dir: -1 });

  const range = resolveRange(preset, customFrom, customTo);
  const params = new URLSearchParams();
  if (repFilter !== "all") params.set("rep", repFilter);
  if (status !== "all") params.set("status", status);
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (q.trim()) params.set("q", q.trim());

  const { data, isFetching } = useQuery<{ rows: KnockListRow[] }>({
    queryKey: ["canvassing-list", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/canvassing/list?${params.toString()}`);
      if (!res.ok) return { rows: [] };
      return res.json();
    },
    placeholderData: (p) => p,
  });
  const rows = data?.rows ?? [];

  const sorted = React.useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = (a[sort.col] ?? "") as string;
      const bv = (b[sort.col] ?? "") as string;
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
    return arr;
  }, [rows, sort]);

  function toggleSort(col: SortCol) {
    setSort((s) => (s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: 1 }));
  }

  function exportCsv() {
    const header = ["Address", "Status", "Rep", "Territory", "Date/Time", "Notes"];
    const lines = sorted.map((r) => [
      r.address ?? "",
      dispositionMeta(r.status).label,
      r.repName ?? "",
      r.territoryName ?? "",
      new Date(r.knockedAt).toLocaleString(),
      r.notesPreview ?? "",
    ]);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...lines].map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canvassing-knocks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const Th = ({ col, children, className }: { col: SortCol; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-3 py-2 text-left font-semibold", className)}>
      <button onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        <ArrowUpDown className={cn("size-3", sort.col === col ? "text-foreground" : "text-muted-foreground/40")} />
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          preset={preset} setPreset={setPreset}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo} setCustomTo={setCustomTo}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
          <option value="all">All statuses</option>
          {KNOCKED_DISPOSITIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        {canManage && (
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="all">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address / notes" className="h-8 w-56 pl-7" />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!sorted.length} className="ml-auto gap-1.5">
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <Th col="address">Address</Th>
              <Th col="status">Status</Th>
              <Th col="repName">Rep</Th>
              <Th col="territoryName" className="hidden md:table-cell">Territory</Th>
              <Th col="knockedAt">Date / time</Th>
              <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  {isFetching ? <Loader2 className="mx-auto size-5 animate-spin" /> : "No knocks match these filters."}
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                const m = dispositionMeta(r.status);
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2 font-medium">{r.address ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: m.color }} />
                        {m.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.repName ?? "—"}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{r.territoryName ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{new Date(r.knockedAt).toLocaleString()}</td>
                    <td className="hidden max-w-xs truncate px-3 py-2 text-muted-foreground lg:table-cell">{r.notesPreview ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{sorted.length} knock{sorted.length === 1 ? "" : "s"} shown.</p>
    </div>
  );
}
