"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock, User, Users, ArrowRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Vertical } from "@prisma/client";
import { WorkspaceTag } from "@/components/portal/workspace-tag";
import { VERTICAL_ACCENT, VERTICAL_LABEL, type ActiveVertical } from "@/lib/vertical";
import { setActiveVerticalAction } from "@/server/modules/vertical/actions";

type EventType = "appointment" | "adjuster" | "install" | "inspection";
type Ev = {
  id: string;
  type: EventType;
  date: string;
  title: string;
  subtitle: string | null;
  rep: string | null;
  /** Who is going out on this visit. Empty for appointments and adjuster meetings. */
  crew: string[];
  /** Null when this viewer may see the visit but not the deal behind it. */
  href: string | null;
  vertical: Vertical;
};

/** One entry per mode the user may pick: a workspace, or "combined". */
export type CalendarModeOption = { value: string; label: string; types: EventType[] };

const TYPE_META: Record<EventType, { label: string; dot: string; pill: string }> = {
  appointment: { label: "Appointments", dot: "bg-gold", pill: "bg-gold/15 text-gold-muted" },
  adjuster: { label: "Adjuster meetings", dot: "bg-blue-500", pill: "bg-blue-500/15 text-blue-600" },
  install: { label: "Installs", dot: "bg-emerald-500", pill: "bg-emerald-500/15 text-emerald-600" },
  inspection: { label: "Inspections", dot: "bg-violet-500", pill: "bg-violet-500/15 text-violet-600" },
};

// Which filter chips exist is decided by the ACTIVE VERTICAL and passed in from
// the server, which is the only place that knows it. Defaulting to roofing's
// set keeps the component's old behaviour for any caller that doesn't say —
// notably, it never invents an "Adjuster meetings" chip for solar.
const DEFAULT_TYPES: EventType[] = ["appointment", "adjuster", "install"];

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const startOfMonth = (d: Date) => { const x = startOfDay(d); x.setDate(1); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const dayKey = (d: Date | string) => startOfDay(new Date(d)).toDateString();
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function WorkCalendar({
  types,
  modes = [],
  initialMode,
  showWorkspace = false,
  activeVertical = null,
}: {
  types?: EventType[];
  /** Empty for a single-workspace user — the switcher then never renders. */
  modes?: CalendarModeOption[];
  initialMode?: string;
  showWorkspace?: boolean;
  /** The workspace currently open, so we know when opening an event must switch. */
  activeVertical?: ActiveVertical | null;
} = {}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<string | undefined>(initialMode);

  // Which chips exist depends on the mode: Combined has to offer the UNION of
  // both workspaces' event types, because adjuster meetings only exist in
  // roofing and AHJ inspections only in solar. Falling back to `types` keeps
  // single-workspace callers on exactly the behaviour they had.
  const activeMode = modes.find((m) => m.value === mode);
  const TYPES = activeMode?.types?.length ? activeMode.types : types?.length ? types : DEFAULT_TYPES;

  const [anchor, setAnchor] = React.useState<Date>(() => startOfMonth(new Date()));
  const [selected, setSelected] = React.useState<Ev | null>(null);

  // Track which chips are switched OFF, not which are on.
  //
  // Switching mode introduces chips that did not exist a moment ago —
  // "Inspections" appears when moving Roofing → Combined. With an on-map those
  // arrive as `undefined`, read as off, and their events load and are then
  // silently filtered out; keeping it correct needs an effect that syncs state
  // to props. Storing the off-set makes "on" the absence of an entry, so a brand
  // new chip is on by construction and there is no effect to get wrong.
  const [off, setOff] = React.useState<Partial<Record<EventType, boolean>>>({});
  const on = React.useMemo(
    () => Object.fromEntries(TYPES.map((t) => [t, !off[t]])) as Record<EventType, boolean>,
    [TYPES, off]
  );

  // Page search, in the same spirit as the pipeline's: it narrows what the
  // month shows rather than navigating anywhere. Only the fetched window is
  // searchable, so the hint under the toolbar always names the month.
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();

  const gridStart = startOfWeek(startOfMonth(anchor));
  const gridEnd = addDays(gridStart, 42);
  const todayKey = dayKey(new Date());

  const { data } = useQuery<{ events: Ev[] }>({
    queryKey: ["calendar", gridStart.toISOString(), gridEnd.toISOString(), mode ?? ""],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: gridStart.toISOString(), to: gridEnd.toISOString() });
      if (mode) qs.set("mode", mode);
      const res = await fetch(`/api/calendar?${qs}`);
      if (!res.ok) return { events: [] };
      return res.json();
    },
    placeholderData: (p) => p,
  });

  const events = (data?.events ?? []).filter((e) => {
    if (!on[e.type]) return false;
    if (!needle) return true;
    // The subtitle carries the address (appointments) or project number
    // (installs/inspections), so both are searchable without being restated.
    // Type and workspace labels are in the haystack too — searching "install"
    // or "solar" narrows a month as naturally as typing a customer name.
    return [e.title, e.subtitle, e.rep, ...e.crew, TYPE_META[e.type].label, VERTICAL_LABEL[e.vertical]]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const byDay = React.useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) {
      const k = dayKey(e.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    for (const list of m.values()) list.sort((a, b) => +new Date(a.date) - +new Date(b.date));
    return m;
  }, [events]);

  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthLabel = anchor.toLocaleDateString([], { month: "long", year: "numeric" });

  /**
   * Open the deal behind an event, switching workspace first when Combined mode
   * surfaced one from somewhere else. Without the switch the deal page reads
   * through the isolation extension in the OLD workspace and 404s — the calendar
   * would show you a job it then refuses to open.
   */
  async function openEvent(ev: Ev) {
    const href = ev.href;
    // Nothing to open: this viewer is on the visit but not admitted to the
    // deal. The button is hidden in that case; this is the guard behind it.
    if (!href) return;
    const needsSwitch = !!activeVertical && ev.vertical !== activeVertical;
    setSelected(null);
    if (needsSwitch) {
      const res = await setActiveVerticalAction(ev.vertical as ActiveVertical);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Switched to ${VERTICAL_LABEL[ev.vertical]}`);
    }
    router.push(href);
    if (needsSwitch) router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setAnchor((a) => startOfMonth(addMonths(a, -1)))} className="rounded-lg border border-border p-2 hover:bg-muted" aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setAnchor(startOfMonth(new Date()))} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Today
          </button>
          <button onClick={() => setAnchor((a) => startOfMonth(addMonths(a, 1)))} className="rounded-lg border border-border p-2 hover:bg-muted" aria-label="Next month">
            <ChevronRight className="size-4" />
          </button>
          <h2 className="ml-2 font-display text-lg font-semibold">{monthLabel}</h2>
        </div>
        {/* Type filters — toggle each; e.g. turn off Adjuster + Install to see appointments only. */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQ("")}
              placeholder="Search by name, address, rep…"
              className="h-9 pl-8"
              aria-label="Search calendar events"
            />
          </div>
          {/* Workspace mode. Rendered only when there is a genuine choice: a
              single-workspace user gets no control, because a switcher with one
              option is just a label that looks clickable. */}
          {modes.length > 1 && (
            <div className="mr-1 inline-flex items-center rounded-full border border-border p-0.5">
              {modes.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    mode === m.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setOff((s) => ({ ...s, [t]: !s[t] }))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                on[t] ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <span className={cn("size-2 rounded-full", TYPE_META[t].dot)} />
              {TYPE_META[t].label}
            </button>
          ))}
        </div>
      </div>

      {/* A month-scoped search needs to say so: nothing found here may simply
          mean the job sits in another month. */}
      {needle && (
        <p className="text-xs text-muted-foreground">
          {events.length === 0
            ? `No events match “${q.trim()}” in ${monthLabel} — try another month.`
            : `${events.length} ${events.length === 1 ? "event" : "events"} matching “${q.trim()}” in ${monthLabel}.`}
        </p>
      )}

      {/* Month grid */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day) => {
            const inMonth = day.getMonth() === anchor.getMonth();
            const list = byDay.get(dayKey(day)) ?? [];
            const isToday = dayKey(day) === todayKey;
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-[104px] border-b border-r border-border p-1.5 last:border-r-0",
                  !inMonth && "bg-muted/20 text-muted-foreground/50"
                )}
              >
                <div className="mb-1 flex justify-end">
                  <span className={cn("grid size-6 place-items-center rounded-full text-xs tabular-nums", isToday && "bg-gold text-gold-foreground font-semibold")}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {list.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelected(e)}
                      title={`${TYPE_META[e.type].label.replace(/s$/, "")} · ${e.title}${e.crew.length ? ` · ${e.crew.join(", ")}` : ""}${e.rep ? ` · ${e.rep}` : ""}${showWorkspace ? ` · ${VERTICAL_LABEL[e.vertical]}` : ""}`}
                      className={cn("flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium leading-tight hover:opacity-90", TYPE_META[e.type].pill)}
                    >
                      {/* A day cell has no room for a full tag, so the workspace
                          is a coloured dot here and spelled out in the tooltip
                          and the detail dialog. */}
                      {showWorkspace && (
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: VERTICAL_ACCENT[e.vertical] }}
                        />
                      )}
                      <span className="tabular-nums opacity-70">{fmtTime(e.date)}</span>
                      <span className="truncate">{e.title}</span>
                    </button>
                  ))}
                  {list.length > 3 && <div className="px-1.5 text-[10px] text-muted-foreground">+{list.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event detail popup */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-sm">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={cn("size-2.5 rounded-full", TYPE_META[selected.type].dot)} />
                  {selected.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium", TYPE_META[selected.type].pill)}>
                    {TYPE_META[selected.type].label.replace(/s$/, "")}
                  </span>
                  {showWorkspace && <WorkspaceTag vertical={selected.vertical} />}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4 shrink-0" /> {fmtDateTime(selected.date)}
                </div>
                {selected.subtitle && <div className="text-muted-foreground">{selected.subtitle}</div>}
                {selected.rep && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="size-4 shrink-0" /> {selected.rep}
                  </div>
                )}
                {/* Who is going out. Only installs and inspections carry a
                    crew, and "nobody yet" is said out loud rather than left as
                    a missing row — an empty space reads as "already handled". */}
                {(selected.type === "install" || selected.type === "inspection") && (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <Users className="mt-0.5 size-4 shrink-0" />
                    <span data-testid="calendar-event-crew">
                      {selected.crew.length ? selected.crew.join(", ") : "No crew assigned yet"}
                    </span>
                  </div>
                )}
              </div>
              {selected.href && (
                <Button
                  onClick={() => void openEvent(selected)}
                  className="mt-2 w-full bg-gold text-gold-foreground hover:bg-gold/90"
                >
                  Open details <ArrowRight className="size-4" />
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
