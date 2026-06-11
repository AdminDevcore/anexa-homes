"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Row = {
  repId: string;
  repName: string;
  knocks: number;
  appointments: number;
  sold: number;
  conversions: number;
  convRate: number;
};

const PERIODS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

const MEDALS = ["🥇", "🥈", "🥉"];

export function CanvassingLeaderboard() {
  const [period, setPeriod] = React.useState("week");

  const { data, isLoading } = useQuery<{ rows: Row[]; meId: string | null }>({
    queryKey: ["canvassing-leaderboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/canvassing/leaderboard?period=${period}`);
      if (!res.ok) return { rows: [], meId: null };
      return res.json();
    },
    refetchInterval: 30000,
  });

  const rows = data?.rows ?? [];
  const meId = data?.meId ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Ranked by doors knocked, then sales.</p>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition-colors",
                period === p.value ? "bg-foreground text-background" : "hover:bg-muted"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[3rem_1fr_repeat(4,4.5rem)] items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Rank</span>
          <span>Rep</span>
          <span className="text-right">Knocks</span>
          <span className="text-right">Appts</span>
          <span className="text-right">Sold</span>
          <span className="text-right">Conv%</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Trophy className="size-8 opacity-40" />
            <p className="text-sm">No knocks logged in this period yet.</p>
          </div>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.repId}
              className={cn(
                "grid grid-cols-[3rem_1fr_repeat(4,4.5rem)] items-center gap-2 border-b border-border/60 px-4 py-3 text-sm last:border-0",
                r.repId === meId && "bg-gold/5"
              )}
            >
              <span className="text-lg">{i < 3 ? MEDALS[i] : <span className="font-semibold text-muted-foreground">{i + 1}</span>}</span>
              <span className="flex items-center gap-2 font-medium">
                <span className="grid size-8 place-items-center rounded-full bg-foreground/10 text-xs font-semibold">
                  {r.repName.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="truncate">
                  {r.repName}
                  {r.repId === meId && <span className="ml-1.5 text-xs text-gold">(you)</span>}
                </span>
              </span>
              <span className="text-right font-semibold tabular-nums">{r.knocks}</span>
              <span className="text-right tabular-nums">{r.appointments}</span>
              <span className="text-right tabular-nums">{r.sold}</span>
              <span className="text-right tabular-nums">{r.convRate}%</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
