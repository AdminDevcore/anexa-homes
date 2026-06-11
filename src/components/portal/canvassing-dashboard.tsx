"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISPOSITIONS } from "@/lib/canvassing";
import { BarChartCard } from "./charts";
import { DateRangeFilter, resolveRange, type RangePreset } from "./canvassing-filters";
import type { CanvassingMeta, RepDashboard } from "@/server/modules/canvassing/queries";

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", accent && "bg-gold/10 border-gold/30")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function CanvassingDashboard() {
  const { data: meta } = useQuery<CanvassingMeta>({
    queryKey: ["canvassing-meta"],
    queryFn: async () => (await fetch("/api/canvassing/data")).json(),
  });
  const canManage = meta?.me.canManageAll ?? false;
  const reps = meta?.reps ?? [];

  const [repFilter, setRepFilter] = React.useState("all");
  const [preset, setPreset] = React.useState<RangePreset>("week");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");

  const range = resolveRange(preset, customFrom, customTo);
  const params = new URLSearchParams();
  if (repFilter !== "all") params.set("rep", repFilter);
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);

  const { data, isFetching } = useQuery<RepDashboard>({
    queryKey: ["canvassing-dashboard", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/canvassing/dashboard?${params.toString()}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    placeholderData: (p) => p,
  });

  function todaySummary() {
    setPreset("today");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          preset={preset} setPreset={setPreset}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo} setCustomTo={setCustomTo}
        />
        {canManage && (
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="all">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
        <button onClick={todaySummary} className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
          Today’s summary
        </button>
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Doors knocked" value={data?.knocked ?? 0} accent />
        <Metric label="Appointments" value={data?.appointments ?? 0} />
        <Metric label="Sold" value={data?.sold ?? 0} />
        <Metric label="Conversion" value={`${data?.convRate ?? 0}%`} />
        <Metric label="Houses remaining" value={data?.remaining ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChartCard
          title="Knocks over time"
          data={(data?.overTime ?? []).map((d) => ({ date: d.date.slice(5), count: d.count }))}
          dataKey="count"
          nameKey="date"
        />
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 font-semibold">Status breakdown</h3>
          <div className="space-y-2">
            {DISPOSITIONS.filter((d) => d.value !== "not_knocked").map((d) => {
              const count = data?.byStatus[d.value] ?? 0;
              const max = Math.max(1, ...Object.values(data?.byStatus ?? { x: 1 }));
              return (
                <div key={d.value} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-muted-foreground">{d.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, background: d.color }} />
                  </div>
                  <span className="w-6 text-right tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Trophy className="size-4 text-gold" />
          <h3 className="font-semibold">Ranking</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">#</th>
              <th className="px-4 py-2 text-left font-semibold">Rep</th>
              <th className="px-4 py-2 text-right font-semibold">Knocks</th>
              <th className="px-4 py-2 text-right font-semibold">Appts</th>
              <th className="px-4 py-2 text-right font-semibold">Sold</th>
              <th className="px-4 py-2 text-right font-semibold">Conv</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(data?.ranking ?? []).length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No activity in this period.</td></tr>
            ) : (
              data!.ranking.map((r, i) => (
                <tr key={r.repId} className="hover:bg-muted/40">
                  <td className="px-4 py-2 tabular-nums">{["🥇", "🥈", "🥉"][i] ?? i + 1}</td>
                  <td className="px-4 py-2 font-medium">{r.repName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.knocks}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.appointments}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.sold}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.convRate}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
