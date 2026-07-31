"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FieldMapLegend } from "@/components/portal/storm/field-map-legend";
import { MAX_SCORE, type FieldMapFilters } from "@/lib/field-map-filters";

export type LayersPanelProps = {
  filters: FieldMapFilters;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  /** Managers additionally get ZIP codes and weather warnings. */
  canManage: boolean;
};

type Toggle = {
  key: keyof FieldMapFilters;
  label: string;
  /** One line, in the words a rep would use. Bare labels taught nobody what
   *  "Heat" or "Reports" meant — which is most of why the old toolbar read as
   *  noise. A control that can't explain itself doesn't earn its place. */
  hint: string;
  managerOnly?: boolean;
};

// A rep prioritising a street cares about hail and damage. ZIP boundaries and
// NWS warnings are planning tools — they'd be noise on a phone.
const TOGGLES: Toggle[] = [
  { key: "showRadar", label: "Hail", hint: "Where hail fell, shaded by size." },
  { key: "showHeat", label: "Storm damage", hint: "Tints each house by how hard it was hit." },
  {
    key: "showZips",
    label: "ZIP codes",
    hint: "Outlines ZIP boundaries. Tap one to turn it into a territory.",
    managerOnly: true,
  },
  {
    key: "showStormWarnings",
    label: "Weather warnings",
    hint: "Live National Weather Service alerts.",
    managerOnly: true,
  },
];

export function LayersPanel({ filters, set, canManage }: LayersPanelProps) {
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

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {TOGGLES.filter((t) => canManage || !t.managerOnly).map((t) => {
          const on = filters[t.key] as boolean;
          return (
            <label
              key={t.key}
              className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{t.hint}</span>
              </span>
              <Switch
                checked={on}
                onCheckedChange={(v) => set(t.key, v as FieldMapFilters[typeof t.key])}
                aria-label={t.label}
              />
            </label>
          );
        })}
      </div>

      {filters.showHeat && (
        <label className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">Only show damage over</span>
          <input
            type="range"
            min={0}
            max={MAX_SCORE}
            step={10}
            value={filters.minScore}
            onChange={(e) => set("minScore", Number(e.target.value))}
            className="min-w-0 flex-1 accent-[#F4631E]"
            title="Show only houses at or above this storm score"
          />
          <span className="w-8 shrink-0 font-medium tabular-nums">{filters.minScore}+</span>
        </label>
      )}

      {/* The colour key lives with the toggles it explains, not floating on the map. */}
      <FieldMapLegend showHail={filters.showRadar} showHeat={filters.showHeat} />
    </div>
  );
}
