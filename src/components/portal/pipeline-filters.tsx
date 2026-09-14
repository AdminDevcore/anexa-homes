"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormat } from "@/components/portal/branding-provider";
import {
  NONE,
  STAGE_TIMERS,
  activeFilterCount,
  clearFilters,
  type FilterOption,
  type PipelineFilterOptions,
  type PipelineFilters,
  type StageTimer,
} from "@/lib/pipeline-filters";

/** Radix Select reserves "" for "no value", so "any" needs a stand-in inside the control. */
const ANY = "__any__";

type Shared = {
  filters: PipelineFilters;
  onChange: (patch: Partial<PipelineFilters>) => void;
  options: PipelineFilterOptions;
  stages: FilterOption[];
};

/**
 * The Filters button and its panel. Every change applies as it is made — the
 * board behind the panel narrows live — so there is no Apply step to forget.
 */
export function PipelineFiltersButton({
  filters,
  onChange,
  options,
  stages,
  shown,
  total,
}: Shared & { shown: number; total: number }) {
  const count = activeFilterCount(filters);

  function toggleTimer(key: StageTimer) {
    const next = new Set(filters.timers);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Fixed order, so the same choice always writes the same URL.
    onChange({ timers: STAGE_TIMERS.map((t) => t.key).filter((k) => next.has(k)) });
  }

  const hasInspections = options.inspections.some((o) => o.value !== NONE) || filters.inspection !== "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          className="shrink-0"
          // The badge is a bare number; without this a screen reader hears
          // "Filters" whether none or five are active.
          aria-label={count > 0 ? `Filters (${count} active)` : "Filters"}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {count > 0 ? (
            <span className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-gold-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(40rem,calc(100vh-10rem))] w-[min(34rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange(clearFilters(filters))}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Reset
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <OptionSelect
            label="Rep"
            anyLabel="Any rep"
            value={filters.rep}
            options={options.reps}
            onChange={(rep) => onChange({ rep })}
          />
          <OptionSelect
            label="Setter"
            anyLabel="Any setter"
            value={filters.setter}
            options={options.setters}
            onChange={(setter) => onChange({ setter })}
          />
          <OptionSelect
            label="Stage"
            anyLabel="Any stage"
            value={filters.stage}
            options={stages}
            onChange={(stage) => onChange({ stage })}
          />
          <OptionSelect
            label="Lead source"
            anyLabel="Any source"
            value={filters.source}
            options={options.sources}
            onChange={(source) => onChange({ source })}
          />
          <OptionSelect
            label="Appointment outcome"
            anyLabel="Any outcome"
            value={filters.outcome}
            options={options.outcomes}
            onChange={(outcome) => onChange({ outcome })}
            unknownLabel={filters.outcome}
          />
          {hasInspections ? (
            <OptionSelect
              label="Inspection outcome"
              anyLabel="Any inspection outcome"
              value={filters.inspection}
              options={options.inspections}
              onChange={(inspection) => onChange({ inspection })}
              unknownLabel={filters.inspection}
            />
          ) : null}
          <OptionSelect
            label="City"
            anyLabel="Any city"
            value={filters.city}
            options={options.cities}
            onChange={(city) => onChange({ city })}
            unknownLabel={filters.city}
          />
        </div>

        <PanelField label="Stage timer" hint="Stages with a target only">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage timer">
            {STAGE_TIMERS.map((t) => {
              const active = filters.timers.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleTimer(t.key)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-sm transition-colors",
                    active
                      ? "border-gold/40 bg-gold/10 font-medium text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </PanelField>

        <div className="grid gap-3 sm:grid-cols-2">
          <RangeField
            label="Deal value"
            min={filters.valueMin}
            max={filters.valueMax}
            onChange={(valueMin, valueMax) => onChange({ valueMin, valueMax })}
            type="number"
          />
          <RangeField
            label="Days in stage"
            min={filters.daysMin}
            max={filters.daysMax}
            onChange={(daysMin, daysMax) => onChange({ daysMin, daysMax })}
            type="number"
          />
        </div>

        {/* A date input needs the room a number does not — two to a row clips "mm/dd/yyyy". */}
        <div className="grid gap-3">
          <RangeField
            label="Appointment date"
            min={filters.apptFrom}
            max={filters.apptTo}
            onChange={(apptFrom, apptTo) => onChange({ apptFrom, apptTo })}
            type="date"
          />
          <RangeField
            label="Created"
            min={filters.createdFrom}
            max={filters.createdTo}
            onChange={(createdFrom, createdTo) => onChange({ createdFrom, createdTo })}
            type="date"
          />
        </div>

        <p className="border-t border-border pt-2.5 text-xs text-muted-foreground tabular-nums">
          {`${shown} of ${total} ${total === 1 ? "deal" : "deals"} match`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** The filters in force, one removable chip each — so a narrowed board says why. */
export function ActivePipelineFilters({ filters, onChange, options, stages }: Shared) {
  const fmt = useFormat();
  const money = (s: string) => fmt.money(Math.round(Number(s) * 100));
  const chips: { key: string; label: string; clear: Partial<PipelineFilters> }[] = [];

  const named = (opts: FilterOption[], v: string, unknown: string) =>
    opts.find((o) => o.value === v)?.label ?? unknown;
  const add = (key: string, label: string, clear: Partial<PipelineFilters>) => chips.push({ key, label, clear });

  if (filters.rep) add("rep", `Rep: ${named(options.reps, filters.rep, "not on this pipeline")}`, { rep: "" });
  if (filters.setter)
    add("setter", `Setter: ${named(options.setters, filters.setter, "not on this pipeline")}`, { setter: "" });
  if (filters.stage) add("stage", `Stage: ${named(stages, filters.stage, "unknown")}`, { stage: "" });
  if (filters.timers.length)
    add(
      "timers",
      STAGE_TIMERS.filter((t) => filters.timers.includes(t.key))
        .map((t) => t.label)
        .join(" or "),
      { timers: [] }
    );
  if (filters.source)
    add("source", `Source: ${named(options.sources, filters.source, "not on this pipeline")}`, { source: "" });
  if (filters.outcome)
    add("outcome", `Outcome: ${named(options.outcomes, filters.outcome, filters.outcome)}`, { outcome: "" });
  if (filters.inspection)
    add("inspection", `Inspection: ${named(options.inspections, filters.inspection, filters.inspection)}`, {
      inspection: "",
    });
  if (filters.city) {
    const city =
      filters.city === NONE
        ? "No city"
        : options.cities.find((o) => o.value.trim().toLowerCase() === filters.city.trim().toLowerCase())?.label ??
          filters.city;
    add("city", `City: ${city}`, { city: "" });
  }
  if (filters.valueMin || filters.valueMax)
    add("value", `Value ${range(filters.valueMin, filters.valueMax, money)}`, { valueMin: "", valueMax: "" });
  if (filters.daysMin || filters.daysMax)
    add("days", `Days in stage ${range(filters.daysMin, filters.daysMax, (s) => s)}`, { daysMin: "", daysMax: "" });
  if (filters.apptFrom || filters.apptTo)
    add("appt", `Appointment ${range(filters.apptFrom, filters.apptTo, shortDate)}`, { apptFrom: "", apptTo: "" });
  if (filters.createdFrom || filters.createdTo)
    add("created", `Created ${range(filters.createdFrom, filters.createdTo, shortDate)}`, {
      createdFrom: "",
      createdTo: "",
    });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange(c.clear)}
          aria-label={`Remove filter ${c.label}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-gold/20"
        >
          <span className="truncate">{c.label}</span>
          <X className="size-3 shrink-0" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(clearFilters(filters))}
        className="px-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        Clear all
      </button>
    </div>
  );
}

function range(min: string, max: string, show: (s: string) => string) {
  if (min && max) return `${show(min)} – ${show(max)}`;
  return min ? `≥ ${show(min)}` : `≤ ${show(max)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-09-01" → "Sep 1". Formatted from the digits rather than through Date:
 * new Date("2026-09-01") is UTC midnight, which is the evening of Aug 31 in
 * Texas, and a server/browser timezone difference would split the render.
 */
function shortDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  const label = `${MONTHS[m - 1] ?? "?"} ${d}`;
  return y === new Date().getFullYear() ? label : `${label}, ${y}`;
}

function OptionSelect({
  label,
  anyLabel,
  value,
  options,
  onChange,
  unknownLabel = "Not on this pipeline",
}: {
  label: string;
  anyLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
  /** What the control reads when the chosen value has no deals left here. */
  unknownLabel?: string;
}) {
  const selected = value ? options.find((o) => o.value === value)?.label ?? unknownLabel : anyLabel;
  return (
    <PanelField label={label}>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? "" : v)}>
        <SelectTrigger className="h-9 w-full" aria-label={label}>
          {/* Explicit, so the trigger shows the name without the item's count. */}
          <SelectValue>{selected}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span data-option-label>{o.label}</span>
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                <span className="sr-only">, </span>
                {o.count}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PanelField>
  );
}

function RangeField({
  label,
  min,
  max,
  onChange,
  type,
}: {
  label: string;
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  type: "number" | "date";
}) {
  const number = type === "number";
  return (
    <PanelField label={label}>
      <div className="flex items-center gap-1.5">
        <Input
          type={type}
          value={min}
          min={number ? 0 : undefined}
          inputMode={number ? "numeric" : undefined}
          placeholder={number ? "Min" : undefined}
          onChange={(e) => onChange(e.target.value, max)}
          className="h-9 min-w-0 flex-1"
          aria-label={`${label} ${number ? "minimum" : "from"}`}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type={type}
          value={max}
          min={number ? 0 : undefined}
          inputMode={number ? "numeric" : undefined}
          placeholder={number ? "Max" : undefined}
          onChange={(e) => onChange(min, e.target.value)}
          className="h-9 min-w-0 flex-1"
          aria-label={`${label} ${number ? "maximum" : "to"}`}
        />
      </div>
    </PanelField>
  );
}

function PanelField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <span className="font-normal text-muted-foreground/70">{`· ${hint}`}</span> : null}
      </div>
      {children}
    </div>
  );
}
