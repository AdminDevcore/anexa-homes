"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type RangePreset = "today" | "yesterday" | "week" | "month" | "all" | "custom";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** Resolve a preset (+ optional custom dates) into ISO from/to query params. */
export function resolveRange(preset: RangePreset, customFrom: string, customTo: string): { from?: string; to?: string } {
  const now = new Date();
  switch (preset) {
    case "all":
      return {};
    case "today":
      return { from: startOfDay(now).toISOString(), to: now.toISOString() };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
    }
    case "week": {
      const s = startOfDay(now);
      s.setDate(s.getDate() - s.getDay()); // Sunday start
      return { from: s.toISOString(), to: now.toISOString() };
    }
    case "month": {
      const s = startOfDay(now);
      s.setDate(1);
      return { from: s.toISOString(), to: now.toISOString() };
    }
    case "custom":
      return {
        from: customFrom ? startOfDay(new Date(customFrom)).toISOString() : undefined,
        to: customTo ? endOfDay(new Date(customTo)).toISOString() : undefined,
      };
  }
}

export function DateRangeFilter({
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
}: {
  preset: RangePreset;
  setPreset: (p: RangePreset) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={cn(
              "px-2.5 py-1.5 text-xs font-medium transition-colors",
              preset === p.value ? "bg-foreground text-background" : "hover:bg-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-[9.5rem]" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-[9.5rem]" />
        </div>
      )}
    </div>
  );
}

/** Shared meta query (reps + role) — same key as the map so the cache is reused. */
export function useCanvassingMeta() {
  return { key: ["canvassing-meta"] as const, url: "/api/canvassing/data" };
}
