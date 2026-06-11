"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, MapPin, User, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rescheduleAppointmentAction, cancelAppointmentAction } from "@/server/modules/canvassing/actions";
import type { AppointmentDTO, CanvassingMeta } from "@/server/modules/canvassing/queries";

type View = "month" | "week" | "day";

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const startOfMonth = (d: Date) => { const x = startOfDay(d); x.setDate(1); return x; };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (d: Date) => startOfDay(d).toDateString();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function CanvassingCalendar() {
  const qc = useQueryClient();
  const { data: meta } = useQuery<CanvassingMeta>({
    queryKey: ["canvassing-meta"],
    queryFn: async () => (await fetch("/api/canvassing/data")).json(),
  });
  const canManage = meta?.me.canManageAll ?? false;
  const reps = meta?.reps ?? [];

  const [view, setView] = React.useState<View>("month");
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());
  const [repFilter, setRepFilter] = React.useState("all");
  const [selected, setSelected] = React.useState<AppointmentDTO | null>(null);

  const rangeStart =
    view === "month" ? startOfWeek(startOfMonth(anchor)) : view === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const rangeEnd = view === "month" ? addDays(rangeStart, 42) : view === "week" ? addDays(rangeStart, 7) : addDays(rangeStart, 1);

  const params = new URLSearchParams({ from: rangeStart.toISOString(), to: rangeEnd.toISOString() });
  if (repFilter !== "all") params.set("rep", repFilter);

  const { data, isFetching } = useQuery<{ appointments: AppointmentDTO[] }>({
    queryKey: ["canvassing-appointments", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/canvassing/appointments?${params.toString()}`);
      if (!res.ok) return { appointments: [] };
      return res.json();
    },
    placeholderData: (p) => p,
  });
  const appts = data?.appointments ?? [];

  const byDay = React.useMemo(() => {
    const m = new Map<string, AppointmentDTO[]>();
    for (const a of appts) {
      const k = dayKey(new Date(a.appointmentAt));
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return m;
  }, [appts]);

  function nav(dir: number) {
    setAnchor((a) => (view === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * (view === "week" ? 7 : 1))));
  }
  function refresh() {
    qc.invalidateQueries({ queryKey: ["canvassing-appointments"] });
  }

  const label =
    view === "month"
      ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
      : view === "week"
        ? `${rangeStart.toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(rangeStart, 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
        : anchor.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const today = new Date();

  const Event = ({ a, compact }: { a: AppointmentDTO; compact?: boolean }) => (
    <button
      onClick={() => setSelected(a)}
      className={cn(
        "block w-full truncate rounded border-l-2 border-gold bg-gold/10 px-1.5 py-0.5 text-left text-[11px] hover:bg-gold/20",
        compact && "leading-tight"
      )}
      title={`${fmtTime(a.appointmentAt)} · ${a.address ?? "Appointment"}${a.repName ? " · " + a.repName : ""}`}
    >
      <span className="font-medium tabular-nums">{fmtTime(a.appointmentAt)}</span> {a.address ?? "Appointment"}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Previous"><ChevronLeft className="size-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button variant="ghost" size="icon" onClick={() => nav(1)} aria-label="Next"><ChevronRight className="size-4" /></Button>
        </div>
        <span className="font-display text-lg font-semibold">{label}</span>
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-2">
          {canManage && reps.length > 0 && (
            <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="h-8 rounded-lg border border-border bg-background px-2 text-sm">
              <option value="all">All reps</option>
              {reps.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
            </select>
          )}
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["month", "week", "day"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn("px-2.5 py-1.5 text-xs font-medium capitalize", view === v ? "bg-foreground text-background" : "hover:bg-muted")}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Month grid */}
      {view === "month" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-[11px] font-semibold text-muted-foreground">
            {WEEKDAYS.map((d) => (<div key={d} className="py-1.5">{d}</div>))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const day = addDays(rangeStart, i);
              const inMonth = day.getMonth() === anchor.getMonth();
              const list = byDay.get(dayKey(day)) ?? [];
              return (
                <div key={i} className={cn("min-h-[92px] border-b border-r border-border p-1 last:border-r-0", !inMonth && "bg-muted/20 text-muted-foreground", i % 7 === 6 && "border-r-0")}>
                  <div className={cn("mb-0.5 text-right text-xs", sameDay(day, today) && "mx-auto flex size-5 items-center justify-center rounded-full bg-gold font-semibold text-gold-foreground")}>{day.getDate()}</div>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((a) => (<Event key={a.id} a={a} compact />))}
                    {list.length > 3 && <button onClick={() => { setView("day"); setAnchor(day); }} className="px-1 text-[10px] text-muted-foreground hover:underline">+{list.length - 3} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week grid */}
      {view === "week" && (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => {
            const day = addDays(rangeStart, i);
            const list = byDay.get(dayKey(day)) ?? [];
            return (
              <div key={i} className="rounded-lg border border-border bg-card">
                <div className={cn("border-b border-border px-2 py-1.5 text-center text-xs font-medium", sameDay(day, today) && "text-gold")}>
                  {WEEKDAYS[day.getDay()]} {day.getDate()}
                </div>
                <div className="min-h-[200px] space-y-1 p-1.5">
                  {list.length === 0 ? <p className="px-1 pt-2 text-center text-[10px] text-muted-foreground">—</p> : list.map((a) => (<Event key={a.id} a={a} />))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Day list */}
      {view === "day" && (
        <div className="rounded-xl border border-border bg-card p-3">
          {(byDay.get(dayKey(anchor)) ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No appointments this day.</p>
          ) : (
            <ul className="space-y-2">
              {(byDay.get(dayKey(anchor)) ?? []).map((a) => (
                <li key={a.id}>
                  <button onClick={() => setSelected(a)} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted/50">
                    <span className="w-20 shrink-0 text-sm font-semibold tabular-nums">{fmtTime(a.appointmentAt)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.address ?? "Appointment"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[a.homeowner, a.repName].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AppointmentDialog appt={selected} onClose={() => setSelected(null)} onChanged={refresh} />
    </div>
  );
}

function AppointmentDialog({ appt, onClose, onChanged }: { appt: AppointmentDTO | null; onClose: () => void; onChanged: () => void }) {
  const [when, setWhen] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (appt) setWhen(toLocalInput(appt.appointmentAt)); }, [appt?.id]);

  async function reschedule() {
    if (!appt) return;
    setBusy(true);
    const res = await rescheduleAppointmentAction({ knockId: appt.id, appointmentAt: new Date(when).toISOString() });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Failed");
    toast.success("Appointment rescheduled");
    onChanged();
    onClose();
  }
  async function cancel() {
    if (!appt) return;
    setBusy(true);
    const res = await cancelAppointmentAction(appt.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Failed");
    toast.success("Appointment cancelled");
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!appt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{appt?.address ?? "Appointment"}</DialogTitle></DialogHeader>
        {appt && (
          <div className="space-y-3">
            <div className="space-y-1 text-sm">
              {appt.homeowner && <p className="flex items-center gap-2"><User className="size-4 text-muted-foreground" /> {appt.homeowner}</p>}
              {appt.repName && <p className="flex items-center gap-2"><User className="size-4 text-muted-foreground" /> Rep: {appt.repName}</p>}
              <p className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /> {appt.address ?? "—"}</p>
              <p className="text-muted-foreground">Status: <span className="capitalize">{appt.status.replace(/_/g, " ")}</span></p>
            </div>
            {appt.leadId && (
              <Link href={`/portal/leads/${appt.leadId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:underline">
                <ExternalLink className="size-3.5" /> Open lead
              </Link>
            )}
            <div className="space-y-1.5 border-t border-border pt-3">
              <label className="text-xs text-muted-foreground">Reschedule</label>
              <div className="flex items-center gap-2">
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-9" />
                <Button size="sm" onClick={reschedule} disabled={busy || !when}>{busy && <Loader2 className="size-3.5 animate-spin" />} Save</Button>
              </div>
            </div>
            <div className="flex justify-end border-t border-border pt-3">
              <Button size="sm" variant="ghost" className="text-destructive" onClick={cancel} disabled={busy}>
                <Trash2 className="size-3.5" /> Cancel appointment
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
