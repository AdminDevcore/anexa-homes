"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Pick one thing on the left; everything about it is on the right.
 *
 * This is the shape the lenders screen was rebuilt into and the reason it works:
 * a settings screen that holds a LIST of configured things — partners, energy
 * providers, automations, photo checklists — used to lay them out as a grid of
 * third-width cards and then open the edit form inside one of them, so twenty
 * fields stacked down a narrow column with two thirds of the window empty. Or
 * worse, it spread one thing over three sections of a very long page.
 *
 * A rail costs one column and buys the whole window for the thing being edited.
 *
 * It stacks above the panel below `lg`, rather than disappearing. That used to
 * be `xl`, because Settings spent a second column on its own section nav and
 * two rails plus a form do not fit a laptop; the section nav now lives in the
 * app sidebar, so the rail is the only one left and can appear a breakpoint
 * earlier. Stacked, the list keeps its own scroll so a long list never pushes
 * the panel off the screen.
 */
export function RailLayout({
  rail,
  children,
  className,
}: {
  rail: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]", className)}>
      <aside className="lg:sticky lg:top-20 lg:self-start">{rail}</aside>
      {children}
    </div>
  );
}

/**
 * The rail itself: what you can add, a way to find one, and the list.
 *
 * Search only appears once the list is long enough to need it — a filter box
 * over four rows is furniture, not help.
 *
 * It sits on a surface of its own. A workspace with one lender used to render
 * as a button and a single row adrift in the page background above a very tall
 * empty column, which reads as something broken rather than as a short list;
 * inside a card the same two elements are simply a small panel.
 */
export function ItemRail({
  label,
  add,
  query,
  onQueryChange,
  searchPlaceholder,
  showSearch,
  children,
}: {
  /** Names the list for a screen reader: "Financing partners". */
  label: string;
  /** The "New …" button. Absent for a reader who cannot edit. */
  add?: React.ReactNode;
  query?: string;
  onQueryChange?: (v: string) => void;
  searchPlaceholder?: string;
  showSearch?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-2">
      {add}

      {showSearch && onQueryChange && (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query ?? ""}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={searchPlaceholder ?? `Find in ${label.toLowerCase()}`}
            aria-label={searchPlaceholder ?? `Find in ${label.toLowerCase()}`}
            className="h-8 pl-8 pr-8"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <nav
        aria-label={label}
        className="max-h-[20rem] space-y-1 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-13rem)]"
      >
        {children}
      </nav>
    </div>
  );
}

/** A heading inside the rail — "Retired (2)", "Inverters". */
export function RailGroup({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * One thing in the rail.
 *
 * The second line is the part a grid of cards could never say: whether this one
 * is ready to be used. A lender with no rate sheet, a checklist with no shots, a
 * provider with no rate — all of them produce empty lists and dead ends
 * downstream, and all of them used to be discoverable only by opening them.
 */
export function RailRow({
  title,
  subtitle,
  mark,
  selected,
  onSelect,
  needsWork,
  muted,
  trailing,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** A logo, an icon, a colour swatch — whatever this kind of thing looks like. */
  mark?: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  /** Amber dot: this one is not finished, and nothing downstream will say so. */
  needsWork?: boolean;
  /** Retired / inactive / hidden — still editable, visibly not in play. */
  muted?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-gold/50 bg-gold/[0.08]"
          : "border-transparent hover:border-border hover:bg-muted/50",
        muted && "opacity-70"
      )}
    >
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {trailing}
      {needsWork && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
          aria-label="Needs setup"
          role="img"
        />
      )}
    </button>
  );
}

/** Nothing matched the filter. */
export function RailNoMatch({ query }: { query: string }) {
  return (
    <p className="px-2 py-4 text-xs text-muted-foreground">
      Nothing matches &ldquo;{query}&rdquo;.
    </p>
  );
}
