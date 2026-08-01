"use client";

// Floating chrome that sits ON the map instead of stacking above it.
// z-[1000] clears Leaflet's own panes (which top out below 1000).
import * as React from "react";
import { Loader2, Crosshair, X, Move, SlidersHorizontal, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingPill({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[1000] inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow">
      <Loader2 className="size-3.5 animate-spin" /> {label}
    </div>
  );
}

export function Banner({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "absolute left-1/2 top-16 z-[1000] -translate-x-1/2 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow",
        className
      )}
    >
      {children}
    </div>
  );
}

export function TopBar({
  children,
  onLocate,
  onLayers,
  className,
}: {
  children: React.ReactNode;
  onLocate: () => void;
  onLayers: () => void;
  className?: string;
}) {
  return (
    <div className={cn("absolute inset-x-3 top-3 z-[1000] flex items-center gap-2", className)}>
      <div className="min-w-0 flex-1 sm:max-w-sm">{children}</div>
      <button
        onClick={onLocate}
        aria-label="Locate me"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-background/95 shadow ring-1 ring-border backdrop-blur hover:bg-muted"
      >
        <Crosshair className="size-4" />
      </button>
      <button
        onClick={onLayers}
        aria-label="Layers"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-background/95 shadow ring-1 ring-border backdrop-blur hover:bg-muted"
      >
        <Layers className="size-4" />
      </button>
    </div>
  );
}

export function StatusBar({
  today,
  remaining,
  activeCount,
  onOpenFilters,
}: {
  today: number;
  remaining: number;
  activeCount: number;
  onOpenFilters: () => void;
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-[1000] flex items-center gap-2 rounded-full bg-background/95 py-2 pl-4 pr-2 shadow ring-1 ring-border backdrop-blur">
      <span className="text-sm font-medium tabular-nums">
        {today} today · {remaining} left
      </span>
      <button
        onClick={onOpenFilters}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <SlidersHorizontal className="size-4" /> Filters
        {activeCount > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold tabular-nums text-white">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  );
}

export function MovingBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="absolute bottom-20 left-1/2 z-[1000] inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-gold px-3 py-1.5 text-xs font-medium text-white shadow">
      <Move className="size-3.5" /> Drag the pin onto the right house, then drop it.
      <button
        onClick={onCancel}
        className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 hover:bg-white/30"
      >
        <X className="size-3" /> Cancel
      </button>
    </div>
  );
}

export function ViewSwitcher({
  tab,
  onChange,
}: {
  tab: string;
  onChange: (t: "map" | "list" | "insights") => void;
}) {
  return (
    // bottom-24 clears the status bar and Leaflet's attribution strip below it.
    <div className="absolute left-1/2 bottom-24 z-[1000] inline-flex -translate-x-1/2 overflow-hidden rounded-full bg-background/95 shadow ring-1 ring-border backdrop-blur">
      {(["map", "list", "insights"] as const).map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn(
            "px-4 py-1.5 text-xs font-semibold capitalize transition-colors",
            tab === t ? "bg-foreground text-background" : "hover:bg-muted"
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
