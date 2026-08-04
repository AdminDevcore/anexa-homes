"use client";

import { cn } from "@/lib/utils";
import { MAX_SCORE, type FieldMapFilters } from "@/lib/field-map-filters";

export type LayersPanelProps = {
  filters: FieldMapFilters;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  /** Managers additionally get ZIP codes, Reports and Warnings. */
  canManage: boolean;
  /** Whether this workspace does storm work at all — see lib/vertical-features. */
  storm: boolean;
};

type Toggle = { key: keyof FieldMapFilters; label: string; managerOnly?: boolean; stormOnly?: boolean };

// A rep prioritising a street cares about hail and heat. ZIP boundaries, storm
// reports and NWS warnings are planning tools — they'd be noise on a phone.
const TOGGLES: Toggle[] = [
  { key: "showRadar", label: "Hail", stormOnly: true },
  { key: "showHeat", label: "Heat", stormOnly: true },
  { key: "showZips", label: "ZIP codes", managerOnly: true },
  { key: "showStormReports", label: "Reports", managerOnly: true, stormOnly: true },
  { key: "showStormWarnings", label: "Warnings", managerOnly: true, stormOnly: true },
];

export function LayersPanel({ filters, set, canManage, storm }: LayersPanelProps) {
  return (
    <div className="space-y-3">
      <div className="inline-flex w-full overflow-hidden rounded-lg border border-border">
        {(["satellite", "street"] as const).map((b) => (
          <button
            key={b}
            onClick={() => set("basemap", b)}
            aria-pressed={filters.basemap === b}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium capitalize transition-colors",
              filters.basemap === b ? "bg-foreground text-background" : "hover:bg-muted"
            )}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TOGGLES.filter((t) => (canManage || !t.managerOnly) && (storm || !t.stormOnly)).map((t) => {
          const on = filters[t.key] as boolean;
          return (
            <button
              key={t.key}
              onClick={() => set(t.key, !on as FieldMapFilters[typeof t.key])}
              aria-pressed={on}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {filters.showHeat && (
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Score ≥</span>
          <input
            type="range"
            min={0}
            max={MAX_SCORE}
            step={10}
            value={filters.minScore}
            onChange={(e) => set("minScore", Number(e.target.value))}
            className="flex-1 accent-[#F4631E]"
            title="Show only pins at/above this storm score"
          />
          <span className="w-6 tabular-nums font-medium">{filters.minScore}</span>
        </label>
      )}
    </div>
  );
}
