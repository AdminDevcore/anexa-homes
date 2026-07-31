"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Phone, Mail, CalendarX2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ALL_OUTCOMES,
  buildOutcomeFilters,
  matchesOutcomeFilter,
} from "@/lib/appointment-filters";

/** One appointment row, fully formatted server-side (money/dates use company locale + tz). */
export type AppointmentRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  typeLabel: string;
  sourceName: string | null;
  stage: { name: string; color: string } | null;
  repName: string | null;
  /** Pre-formatted currency; `hasValue` says whether it's worth emphasising. */
  value: string;
  hasValue: boolean;
  /** Pre-formatted date-time, null when nothing is scheduled. */
  when: string | null;
  /** "in 4 days" / "2 wks ago", relative to render time. */
  relative: string | null;
  isPast: boolean;
  /** The recorded appointment outcome ("Ran", "No Show", …), or null if none. */
  outcome: string | null;
};

export function AppointmentsList({
  rows,
  initialQuery = "",
}: {
  rows: AppointmentRow[];
  initialQuery?: string;
}) {
  const [q, setQ] = React.useState(initialQuery);
  const [filter, setFilter] = React.useState<string>(ALL_OUTCOMES);

  const searched = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.phone, r.email, r.repName, r.sourceName, r.stage?.name, r.outcome]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, q]);

  // Counts reflect the current search, so the chips always add up to what's shown.
  const filters = React.useMemo(() => buildOutcomeFilters(searched), [searched]);

  // A filter can disappear as the search narrows (e.g. the last "No Show" is
  // typed out of view). Fall back to All by DERIVING the effective filter rather
  // than resetting state in an effect — no cascading render, and the original
  // choice is restored for free if the search widens again.
  const active = filters.some((f) => f.key === filter) ? filter : ALL_OUTCOMES;

  const visible = React.useMemo(
    () => searched.filter((r) => matchesOutcomeFilter(r, active)),
    [searched, active]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, rep…"
            className="h-9 pl-8"
            aria-label="Search appointments"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by outcome">
          {filters.map((f) => {
            const isActive = active === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "border-gold/40 bg-gold/12 text-gold-muted"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                )}
              >
                {/* Solar outcomes are full sentences ("Signed — proposal
                    accepted"), so cap the label rather than let one chip own
                    the row. The title attribute keeps it readable. */}
                <span className="max-w-[13rem] truncate" title={f.label}>
                  {f.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                    isActive ? "bg-gold/20" : "bg-muted"
                  )}
                >
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
            <CalendarX2 className="size-5" />
          </span>
          <p className="text-sm font-medium">No appointments match</p>
          <p className="text-xs text-muted-foreground">Try a different search or filter.</p>
        </div>
      ) : (
        <>
          {/* Desktop: table. Mobile: tap-friendly cards (below). */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden xl:table-cell">Contact</TableHead>
                  <TableHead className="hidden lg:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Source</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="hidden sm:table-cell">Rep</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Appointment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((l) => (
                  <TableRow key={l.id} className="group">
                    <TableCell className="max-w-[220px]">
                      <Link
                        href={`/portal/leads/${l.id}`}
                        className="font-medium decoration-gold-muted/40 underline-offset-4 group-hover:text-gold-muted group-hover:underline"
                      >
                        {l.name}
                      </Link>
                      {/* Contact collapses into the name cell below xl. */}
                      <div className="truncate text-xs text-muted-foreground xl:hidden">
                        {l.phone ?? l.email ?? ""}
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {l.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="size-3 shrink-0" /> {l.phone}
                          </span>
                        )}
                        {l.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="size-3 shrink-0" />
                            <span className="max-w-[190px] truncate">{l.email}</span>
                          </span>
                        )}
                        {!l.phone && !l.email && <span className="text-muted-foreground/60">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {l.typeLabel}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {l.sourceName ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell>
                      {l.stage ? (
                        <span
                          className="inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
                          style={{ backgroundColor: `${l.stage.color}22`, color: l.stage.color }}
                        >
                          {l.stage.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {l.repName ? (
                        <span className="text-muted-foreground">{l.repName}</span>
                      ) : (
                        <span className="text-muted-foreground/50">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        l.hasValue ? "font-semibold" : "text-muted-foreground/50"
                      )}
                    >
                      {l.value}
                    </TableCell>
                    <TableCell>
                      <AppointmentCell row={l} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards */}
          <div className="space-y-2 md:hidden">
            {visible.map((l) => (
              <Link
                key={l.id}
                href={`/portal/leads/${l.id}`}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 active:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name}</div>
                    {l.phone ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">{l.phone}</div>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-right tabular-nums",
                      l.hasValue ? "font-semibold" : "text-muted-foreground/50"
                    )}
                  >
                    {l.value}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {l.stage ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: `${l.stage.color}22`, color: l.stage.color }}
                    >
                      {l.stage.name}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">{l.typeLabel}</span>
                  {l.when ? (
                    <span className="text-muted-foreground">· {l.when}</span>
                  ) : (
                    <span className="text-muted-foreground/60">· Not scheduled</span>
                  )}
                  {l.outcome ? (
                    <OutcomePill outcome={l.outcome} />
                  ) : l.isPast ? (
                    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Not ran
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AppointmentCell({ row }: { row: AppointmentRow }) {
  if (!row.when) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground/50">Not scheduled</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="whitespace-nowrap text-sm">{row.when}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.relative && (
          <span className="text-[11px] text-muted-foreground/70">{row.relative}</span>
        )}
        {row.outcome ? (
          <OutcomePill outcome={row.outcome} />
        ) : row.isPast ? (
          // A past appointment with no outcome is the thing a manager chases.
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Not ran
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: string }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold-muted">
      {outcome}
    </span>
  );
}
