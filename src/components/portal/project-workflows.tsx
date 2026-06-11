"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  submitDailyReportAction,
  updateProjectStatusAction,
  toggleQcItemAction,
  assignCrewAction,
  unassignCrewAction,
} from "@/server/modules/projects/actions";

const STATUS_OPTIONS = [
  "not_started",
  "in_production",
  "on_hold",
  "qc",
  "completed",
  "closed",
  "cancelled",
];

export function ProjectStatusControl({ projectId, status }: { projectId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function change(next: string) {
    setPending(true);
    const res = await updateProjectStatusAction(projectId, next);
    setPending(false);
    if (res.ok) {
      toast.success("Status updated");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <Select value={status} onValueChange={change} disabled={pending}>
      <SelectTrigger className="h-8 w-[170px] capitalize"><SelectValue /></SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((s) => (
          <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function QcChecklistEditor({
  projectId,
  items,
}: {
  projectId: string;
  items: { label: string; done: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggle(i: number, done: boolean) {
    setBusy(true);
    const res = await toggleQcItemAction(projectId, i, done);
    setBusy(false);
    if (res.ok) router.refresh();
    else toast.error(res.error);
  }

  if (items.length === 0) return <p className="text-sm text-muted-foreground">No checklist items.</p>;

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i}>
          <button
            disabled={busy}
            onClick={() => toggle(i, !item.done)}
            className="flex w-full items-center gap-2 text-left text-sm"
          >
            {item.done ? <CheckCircle2 className="size-4 text-emerald-500" /> : <Circle className="size-4 text-muted-foreground" />}
            <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DailyReportForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(() => "");
  const [squares, setSquares] = React.useState("");
  const [crewSize, setCrewSize] = React.useState("");
  const [weather, setWeather] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit() {
    if (!date) {
      toast.error("Pick a date.");
      return;
    }
    setPending(true);
    const res = await submitDailyReportAction({
      projectId,
      date,
      squaresCompleted: Number(squares) || 0,
      crewSize: Number(crewSize) || 0,
      weather,
      summary,
    });
    setPending(false);
    if (res.ok) {
      toast.success("Report submitted");
      setOpen(false);
      setSquares(""); setCrewSize(""); setWeather(""); setSummary(""); setDate("");
      router.refresh();
    } else toast.error(res.error);
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="mb-3">
        <Plus className="size-4" /> Add daily report
      </Button>
    );
  }

  return (
    <div data-testid="daily-report-form" className="mb-4 space-y-3 rounded-lg border border-border bg-background p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Squares done</Label><Input type="number" value={squares} onChange={(e) => setSquares(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Crew size</Label><Input type="number" value={crewSize} onChange={(e) => setCrewSize(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Weather</Label><Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="Clear" /></div>
      </div>
      <div className="space-y-1"><Label className="text-xs">Summary</Label><Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Submit
        </Button>
      </div>
    </div>
  );
}

export function CrewAssigner({
  projectId,
  crews,
  assignments,
}: {
  projectId: string;
  crews: { id: string; name: string }[];
  assignments: { id: string; crewName: string; members: number }[];
}) {
  const router = useRouter();
  const [crewId, setCrewId] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function assign() {
    if (!crewId) return;
    setPending(true);
    const res = await assignCrewAction(projectId, crewId);
    setPending(false);
    if (res.ok) {
      toast.success("Crew assigned");
      setCrewId("");
      router.refresh();
    } else toast.error(res.error);
  }

  async function remove(id: string) {
    const res = await unassignCrewAction(id);
    if (res.ok) router.refresh();
    else toast.error(res.error);
  }

  return (
    <div className="space-y-3">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No crew assigned.</p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-background p-3 text-sm">
              <div>
                <div className="font-medium">{a.crewName}</div>
                <div className="text-xs text-muted-foreground">{a.members} members</div>
              </div>
              <button onClick={() => remove(a.id)} aria-label="Remove crew"><X className="size-4 text-destructive" /></button>
            </li>
          ))}
        </ul>
      )}
      {crews.length > 0 && (
        <div className="flex gap-2">
          <Select value={crewId} onValueChange={setCrewId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Assign a crew" /></SelectTrigger>
            <SelectContent>
              {crews.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={pending || !crewId} onClick={assign}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
