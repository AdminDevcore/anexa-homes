"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DISPOSITIONS } from "@/lib/canvassing";
import type { FieldMapFilters, DatePreset } from "@/lib/field-map-filters";
import { DateRangeFilter } from "../canvassing-filters";

export type FilterControlsProps = {
  filters: FieldMapFilters;
  activeCount: number;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  toggleDisposition: (value: string) => void;
  reset: () => void;
  statsByDisp: Record<string, number>;
  reps: { id: string; name: string }[];
  canManage: boolean;
};

/**
 * The filter controls themselves — shared by the rep's bottom sheet and the
 * manager's rail so the two can't drift apart.
 */
export function FilterControls({
  filters,
  activeCount,
  set,
  toggleDisposition,
  reset,
  statsByDisp,
  reps,
  canManage,
}: FilterControlsProps) {
  return (
    <div className="space-y-4">
      <DateRangeFilter
        preset={filters.datePreset}
        setPreset={(p) => set("datePreset", p as DatePreset)}
        customFrom={filters.dateFrom}
        setCustomFrom={(v) => set("dateFrom", v)}
        customTo={filters.dateTo}
        setCustomTo={(v) => set("dateTo", v)}
      />

      {/* Both of these used to be bare chips nobody could decode. The hint is
          the point — without it "Remaining only" and "Deals" read as jargon. */}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50">
          <span className="min-w-0">
            {/* Not "Not knocked yet" — that collides with the Not Knocked
                disposition chip sitting right below it. */}
            <span className="block text-sm font-medium">Only doors left to knock</span>
            <span className="block text-xs leading-snug text-muted-foreground">
              Hides every house you&rsquo;ve already been to.
            </span>
          </span>
          <Switch
            checked={filters.remainingOnly}
            onCheckedChange={(v) => set("remainingOnly", v)}
            aria-label="Only doors left to knock"
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Appointments &amp; sold jobs</span>
            <span className="block text-xs leading-snug text-muted-foreground">
              Shows pipeline pins alongside your knocks.
            </span>
          </span>
          <Switch
            checked={filters.showDeals}
            onCheckedChange={(v) => set("showDeals", v)}
            aria-label="Appointments and sold jobs"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DISPOSITIONS.map((d) => {
          const active = filters.dispositions.has(d.value);
          const count = statsByDisp[d.value] ?? 0;
          return (
            <button
              key={d.value}
              type="button"
              disabled={filters.remainingOnly}
              onClick={() => toggleDisposition(d.value)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
              )}
            >
              <span
                className="size-2.5 rounded-full border"
                style={{ background: d.value === "not_knocked" ? "#fff" : d.color, borderColor: d.color }}
              />
              {d.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {canManage && reps.length > 0 && (
        <select
          value={filters.repId}
          onChange={(e) => set("repId", e.target.value)}
          aria-label="Filter by rep"
          className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
        >
          <option value="all">All reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={reset}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}

export type FiltersSheetProps = FilterControlsProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FiltersSheet({ open, onOpenChange, ...controls }: FiltersSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-3 overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-md"
      >
        <SheetHeader className="p-0 pr-8 text-left">
          <SheetTitle className="text-base font-semibold">Filters</SheetTitle>
        </SheetHeader>
        <FilterControls {...controls} />
      </SheetContent>
    </Sheet>
  );
}
