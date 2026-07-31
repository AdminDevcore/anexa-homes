"use client";

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type TaskFilters = {
  q: string;
  person: string; // mine | to_me | by_me | all | <assigneeId>
  status: string; // all | open | completed | overdue
  priority: string; // all | urgent | high | medium | low
  from: string;
  to: string;
};

export const DEFAULT_FILTERS: TaskFilters = {
  q: "",
  person: "mine",
  status: "open",
  priority: "all",
  from: "",
  to: "",
};

type Option = { id: string; name: string };

/** Non-default filters, ignoring the search box (it has its own visible field). */
function activeCount(f: TaskFilters) {
  return (["person", "status", "priority", "from", "to"] as const).filter(
    (k) => f[k] !== DEFAULT_FILTERS[k]
  ).length;
}

/**
 * One row of page chrome: search, one-tap chips for the three views people
 * actually use, and a Filters popover holding the rest. Replaces the old
 * page-level ListFilter (which hid DOM rows, so the "N shown" count ignored the
 * search) plus the loose row of five selects.
 */
export function TasksToolbar({
  filters,
  onChange,
  assignees,
  canAssign,
  meId,
  shown,
  createSlot,
}: {
  filters: TaskFilters;
  onChange: (patch: Partial<TaskFilters>) => void;
  assignees: Option[];
  canAssign: boolean;
  meId: string;
  shown: number;
  createSlot?: React.ReactNode;
}) {
  const count = activeCount(filters);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search tasks…"
          className="h-9 pl-8"
          aria-label="Search tasks"
        />
      </div>

      <Chip
        active={filters.person === "mine"}
        onClick={() => onChange({ person: filters.person === "mine" ? "all" : "mine" })}
      >
        My tasks
      </Chip>
      <Chip
        active={filters.status === "open"}
        onClick={() => onChange({ status: filters.status === "open" ? "all" : "open" })}
      >
        Open
      </Chip>
      <Chip
        active={filters.status === "overdue"}
        onClick={() => onChange({ status: filters.status === "overdue" ? "all" : "overdue" })}
      >
        Overdue
      </Chip>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">{shown} shown</span>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="lg"
              // Spell the count out: the badge is a bare glyph, so without this a
              // screen reader hears "Filters" whether none or five are active.
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
          <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] gap-3 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filters</span>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      person: DEFAULT_FILTERS.person,
                      status: DEFAULT_FILTERS.status,
                      priority: DEFAULT_FILTERS.priority,
                      from: "",
                      to: "",
                    })
                  }
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" /> Reset
                </button>
              ) : null}
            </div>

            <PanelField label="People">
              <Select value={filters.person} onValueChange={(v) => onChange({ person: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mine">My tasks</SelectItem>
                  <SelectItem value="to_me">Assigned to me</SelectItem>
                  <SelectItem value="by_me">Assigned by me</SelectItem>
                  <SelectItem value="all">Everyone</SelectItem>
                  {canAssign &&
                    assignees
                      .filter((a) => a.id !== meId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </PanelField>

            <PanelField label="Status">
              <Select value={filters.status} onValueChange={(v) => onChange({ status: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </PanelField>

            <PanelField label="Priority">
              <Select value={filters.priority} onValueChange={(v) => onChange({ priority: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any priority</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </PanelField>

            <PanelField label="Created">
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={filters.from}
                  onChange={(e) => onChange({ from: e.target.value })}
                  className="h-9 flex-1"
                  aria-label="Created from"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={filters.to}
                  onChange={(e) => onChange({ to: e.target.value })}
                  className="h-9 flex-1"
                  aria-label="Created to"
                />
              </div>
            </PanelField>
          </PopoverContent>
        </Popover>

        {createSlot}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 rounded-full border px-3 text-sm transition-colors",
        active
          ? "border-gold/40 bg-gold/10 font-medium text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
