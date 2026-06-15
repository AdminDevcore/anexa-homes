"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock, User, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type EventType = "appointment" | "adjuster" | "install";
type Ev = { id: string; type: EventType; date: string; title: string; subtitle: string | null; rep: string | null; href: string };

const TYPE_META: Record<EventType, { label: string; dot: string; pill: string }> = {
  appointment: { label: "Appointments", dot: "bg-gold", pill: "bg-gold/15 text-gold-muted" },
  adjuster: { label: "Adjuster meetings", dot: "bg-blue-500", pill: "bg-blue-500/15 text-blue-600" },
  install: { label: "Installs", dot: "bg-emerald-500", pill: "bg-emerald-500/15 text-emerald-600" },
};
const TYPES: EventType[] = ["appointment", "adjuster", "install"];

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const startOfMonth = (d: Date) => { const x = startOfDay(d); x.setDate(1); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const dayKey = (d: Date | string) => startOfDay(new Date(d)).toDateString();
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function WorkCalendar() {
  const router = useRouter();
  const [anchor, setAnchor] = React.useState<Date>(() => startOfMonth(new Date()));
  const [on, setOn] = React.useState<Record<EventType, boolean>>({ appointment: true, adjuster: true, install: true });
  const [selected, setSelected] = React.useState<Ev | null>(null);

  const gridStart = startOfWeek(startOfMonth(anchor));
  const gridEnd = addDays(gridStart, 42);
  const todayKey = dayKey(new Date());

  const { data } = useQuery<{ events: Ev[] }>({
    queryKey: ["calendar", gridStart.toISOString(), gridEnd.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/calendar?from=${gridStart.toISOString()}&to=${gridEnd.toISOString()}`);
      if (!res.ok) return { events: [] };
      return res.json();
    },
    placeholderData: (p) => p,
  });

  const events = (data?.events ?? []).filter((e) => on[e.type]);
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
        <div className="flex flex-wrap items-center gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setOn((s) => ({ ...s, [t]: !s[t] }))}
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
                      title={`${TYPE_META[e.type].label.replace(/s$/, "")} · ${e.title}${e.rep ? ` · ${e.rep}` : ""}`}
                      className={cn("flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium leading-tight hover:opacity-90", TYPE_META[e.type].pill)}
                    >
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
                <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium", TYPE_META[selected.type].pill)}>
                  {TYPE_META[selected.type].label.replace(/s$/, "")}
                </span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4 shrink-0" /> {fmtDateTime(selected.date)}
                </div>
                {selected.subtitle && <div className="text-muted-foreground">{selected.subtitle}</div>}
                {selected.rep && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="size-4 shrink-0" /> {selected.rep}
                  </div>
                )}
              </div>
              <Button
                onClick={() => { const href = selected.href; setSelected(null); router.push(href); }}
                className="mt-2 w-full bg-gold text-gold-foreground hover:bg-gold/90"
              >
                Open details <ArrowRight className="size-4" />
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
