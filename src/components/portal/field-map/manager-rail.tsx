"use client";

// Manager tooling, collapsed into a rail that overlays the map instead of
// stacking above it. Reps never render this.
import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pencil,
  Check,
  X,
  Sparkles,
  Trash2,
  CloudHail,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerritoryDTO } from "@/server/modules/canvassing/queries";
import type { FieldMapFilters } from "@/lib/field-map-filters";
import { FilterControls } from "./filters-sheet";

export type StormTab = "storm-leads" | "storm-checker" | "storm-zones";

export type ManagerRailProps = {
  filters: FieldMapFilters;
  activeCount: number;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  toggleDisposition: (value: string) => void;
  reset: () => void;
  statsByDisp: Record<string, number>;
  reps: { id: string; name: string }[];
  territories: TerritoryDTO[];
  drawing: boolean;
  drawPointCount: number;
  onStartDraw: () => void;
  onFinishDraw: () => void;
  onCancelDraw: () => void;
  onGeneratePins: (territoryId: string) => void;
  onDeleteTerritory: (t: TerritoryDTO) => void;
  onSetTerritoryReps: (t: TerritoryDTO, repIds: string[]) => void;
  onOpenStormTab: (tab: StormTab) => void;
  canStorm: boolean;
};

const RAIL_KEY = "field-map-rail";

// localStorage is an external store, so read it through useSyncExternalStore:
// it gives the server the default and the client the stored value without a
// setState-in-effect or a hydration mismatch. localStorage fires no event for
// same-tab writes, hence the manual listener set.
const railListeners = new Set<() => void>();
function subscribeRail(cb: () => void) {
  railListeners.add(cb);
  return () => {
    railListeners.delete(cb);
  };
}
// Closed until asked for. Open-by-default meant every manager — and every
// super admin, which is how the owner always signs in — landed on a 320px
// panel covering a fifth of the map, showing the same date presets and
// disposition chips the redesign was meant to get out of the way.
function getRailOpen() {
  return window.localStorage.getItem(RAIL_KEY) === "1";
}
function setRailOpen(next: boolean) {
  window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
  railListeners.forEach((cb) => cb());
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/50"
      >
        {title}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export function ManagerRail({
  filters,
  activeCount,
  set,
  toggleDisposition,
  reset,
  statsByDisp,
  reps,
  territories,
  drawing,
  drawPointCount,
  onStartDraw,
  onFinishDraw,
  onCancelDraw,
  onGeneratePins,
  onDeleteTerritory,
  onSetTerritoryReps,
  onOpenStormTab,
  canStorm,
}: ManagerRailProps) {
  const open = React.useSyncExternalStore(subscribeRail, getRailOpen, () => false);
  const toggleRail = () => setRailOpen(!open);

  if (!open) {
    // Now the default state, so it has to read as a labelled control rather
    // than an anonymous chevron a manager has to discover by poking at it.
    return (
      <button
        onClick={toggleRail}
        aria-label="Open tools"
        aria-expanded={false}
        className="absolute left-3 top-1/2 z-[1000] inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-background/95 py-2 pl-3 pr-2.5 text-sm font-medium shadow ring-1 ring-border backdrop-blur hover:bg-muted"
      >
        <SlidersHorizontal className="size-4" />
        Tools
        {activeCount > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-gold text-[11px] font-bold tabular-nums text-white">
            {activeCount}
          </span>
        )}
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="absolute inset-y-0 left-0 z-[1000] flex w-80 max-w-[85%] flex-col overflow-y-auto border-r border-border bg-background/97 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-display text-sm font-semibold">Tools</span>
        <button
          onClick={toggleRail}
          aria-label="Collapse tools"
          aria-expanded
          className="grid size-7 place-items-center rounded-md hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>

      {/* No Layers section: the floating ≡ button already opens the same panel
          for every role, and having it in two places is the duplication this
          redesign exists to remove. */}
      <Section title={activeCount > 0 ? `Filters (${activeCount})` : "Filters"} defaultOpen>
        <FilterControls
          filters={filters}
          activeCount={activeCount}
          set={set}
          toggleDisposition={toggleDisposition}
          reset={reset}
          statsByDisp={statsByDisp}
          reps={reps}
          canManage
        />
      </Section>

      <Section title="Territories">
        <div className="space-y-3">
          {drawing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onFinishDraw}
                disabled={drawPointCount < 3}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
              >
                <Check className="size-4" /> Finish ({drawPointCount})
              </button>
              <button
                onClick={onCancelDraw}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <X className="size-4" /> Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onStartDraw}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <Pencil className="size-4" /> Draw territory
            </button>
          )}
          {drawing && (
            <p className="text-xs text-muted-foreground">
              Tap the map to add corners, then Finish — houses inside fill in automatically.
            </p>
          )}

          {territories.length === 0 && !drawing && (
            <p className="text-xs text-muted-foreground">No territories yet.</p>
          )}
          <ul className="space-y-3">
            {territories.map((t) => {
              const pct = t.total ? Math.round((t.knocked / t.total) * 100) : 0;
              return (
                <li key={t.id} className="space-y-1.5 rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block size-3 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="truncate text-sm font-semibold">{t.name}</span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t.knocked}/{t.total} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="max-h-28 space-y-0.5 overflow-y-auto rounded border border-border p-1">
                    {reps.length === 0 && <p className="px-1 text-xs text-muted-foreground">No reps available.</p>}
                    {reps.map((r) => {
                      const on = t.repIds.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              onSetTerritoryReps(t, on ? t.repIds.filter((x) => x !== r.id) : [...t.repIds, r.id])
                            }
                          />
                          <span className="truncate">{r.name}</span>
                          {t.assignedRepId === r.id && (
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">(primary)</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onGeneratePins(t.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold"
                    >
                      <Sparkles className="size-3.5" /> {t.total > 0 ? "Re-sync pins" : "Generate pins"}
                    </button>
                    <button
                      onClick={() => onDeleteTerritory(t)}
                      aria-label={`Delete ${t.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Section>

      {canStorm && (
        <Section title="Storm">
          <div className="space-y-1">
            {(
              [
                ["storm-leads", "Storm leads", "Existing leads ranked by how hard their house was hit."],
                ["storm-checker", "Check an address", "Paste one address to see its hail history."],
                ["storm-zones", "Worst-hit areas", "Neighbourhoods ranked by damage — where to send crews."],
              ] as const
            ).map(([tab, label, hint]) => (
              <button
                key={tab}
                onClick={() => onOpenStormTab(tab)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"
              >
                <CloudHail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
