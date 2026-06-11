"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, CheckCircle2, Circle, Trash2, Link2, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTaskAction, setTaskStatusAction, deleteTaskAction } from "@/server/modules/tasks/actions";
import { useFormat } from "@/components/portal/branding-provider";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  completedBy: string | null;
  assignee: string | null;
  assigneeId: string | null;
  assignedBy: string | null;
  createdById: string | null;
  leadId: string | null;
  leadName: string | null;
};
type Option = { id: string; name: string };

const DAY = 86_400_000;
const PRIORITY_RANK: Record<string, number> = { urgent: 3, high: 2, medium: 1, low: 0 };
const daysBetween = (a: number, b: number) => Math.floor((b - a) / DAY);

type SortCol = "createdAt" | "dueAt" | "priority" | "status";

export function TasksClient({
  meId,
  tasks,
  assignees,
  canAssign,
  canCreate,
  canManage,
}: {
  meId: string;
  tasks: Task[];
  assignees: Option[];
  canAssign: boolean;
  canCreate: boolean;
  canManage: boolean;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [priority, setPriority] = React.useState("medium");
  const [dueAt, setDueAt] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const [person, setPerson] = React.useState("mine"); // mine | to_me | by_me | all | <assigneeId>
  const [statusF, setStatusF] = React.useState("open"); // all | open | completed | overdue
  const [priorityF, setPriorityF] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState<{ col: SortCol; dir: 1 | -1 }>({ col: "createdAt", dir: -1 });

  const now = Date.now();
  const isOverdue = (t: Task) => t.status !== "done" && !!t.dueAt && new Date(t.dueAt).getTime() < now;

  // Summary over the full (server-scoped) set.
  const openCount = tasks.filter((t) => t.status !== "done").length;
  const overdueCount = tasks.filter(isOverdue).length;
  const doneDurations = tasks
    .filter((t) => t.status === "done" && t.completedAt)
    .map((t) => daysBetween(new Date(t.createdAt).getTime(), new Date(t.completedAt!).getTime()));
  const avgDays = doneDurations.length ? Math.round((doneDurations.reduce((a, b) => a + b, 0) / doneDurations.length) * 10) / 10 : null;

  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() + DAY - 1 : null;

  const visible = tasks
    .filter((t) => {
      if (person === "mine" && !(t.assigneeId === meId || t.createdById === meId)) return false;
      if (person === "to_me" && t.assigneeId !== meId) return false;
      if (person === "by_me" && t.createdById !== meId) return false;
      if (!["mine", "to_me", "by_me", "all"].includes(person) && t.assigneeId !== person) return false;
      if (statusF === "open" && t.status === "done") return false;
      if (statusF === "completed" && t.status !== "done") return false;
      if (statusF === "overdue" && !isOverdue(t)) return false;
      if (priorityF !== "all" && t.priority !== priorityF) return false;
      const created = new Date(t.createdAt).getTime();
      if (fromMs && created < fromMs) return false;
      if (toMs && created > toMs) return false;
      return true;
    })
    .sort((a, b) => {
      let av: number, bv: number;
      if (sort.col === "priority") { av = PRIORITY_RANK[a.priority] ?? 0; bv = PRIORITY_RANK[b.priority] ?? 0; }
      else if (sort.col === "status") { av = a.status === "done" ? 1 : 0; bv = b.status === "done" ? 1 : 0; }
      else if (sort.col === "dueAt") { av = a.dueAt ? new Date(a.dueAt).getTime() : Infinity; bv = b.dueAt ? new Date(b.dueAt).getTime() : Infinity; }
      else { av = new Date(a.createdAt).getTime(); bv = new Date(b.createdAt).getTime(); }
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });

  function toggleSort(col: SortCol) {
    setSort((s) => (s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: -1 }));
  }

  async function create() {
    if (!title.trim()) return toast.error("Enter a task title.");
    setPending(true);
    const res = await createTaskAction({ title, assigneeId, priority: priority as "low" | "medium" | "high" | "urgent", dueAt });
    setPending(false);
    if (res.ok) { setTitle(""); setDueAt(""); setAssigneeId(""); toast.success("Task added"); router.refresh(); }
    else toast.error(res.error);
  }
  async function toggle(t: Task) {
    const res = await setTaskStatusAction(t.id, (t.status === "done" ? "todo" : "done") as "todo" | "done");
    if (res.ok) router.refresh(); else toast.error(res.error);
  }
  async function remove(id: string) {
    const res = await deleteTaskAction(id);
    if (res.ok) router.refresh(); else toast.error(res.error);
  }

  function ageCell(t: Task) {
    if (t.status === "done") {
      if (!t.completedAt) return <span className="text-emerald-600">done</span>;
      const d = daysBetween(new Date(t.createdAt).getTime(), new Date(t.completedAt).getTime());
      return <span className="text-emerald-600">took {d} day{d === 1 ? "" : "s"}</span>;
    }
    const d = daysBetween(new Date(t.createdAt).getTime(), now);
    const overdue = isOverdue(t);
    return (
      <span className={cn(overdue ? "font-medium text-destructive" : d >= 7 ? "font-medium text-amber-600" : "text-muted-foreground")}>
        open {d} day{d === 1 ? "" : "s"}{overdue && " · overdue"}
      </span>
    );
  }

  const Th = ({ col, children }: { col: SortCol; children: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold">
      <button onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}<ArrowUpDown className={cn("size-3", sort.col === col ? "text-foreground" : "text-muted-foreground/40")} />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value={openCount} />
        <Stat label="Overdue" value={overdueCount} accent={overdueCount > 0} />
        <Stat label="Avg days to complete" value={avgDays == null ? "—" : avgDays} />
      </div>

      {/* Create */}
      {canCreate && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" className="flex-1" onKeyDown={(e) => e.key === "Enter" && create()} />
          {canAssign && assignees.length > 0 && (
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Assign to me" /></SelectTrigger>
              <SelectContent>{assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-full sm:w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="w-full sm:w-40" />
          <Button onClick={create} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={person} onValueChange={setPerson}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">My tasks</SelectItem>
            <SelectItem value="to_me">Assigned to me</SelectItem>
            <SelectItem value="by_me">Assigned by me</SelectItem>
            {canAssign && <SelectItem value="all">All</SelectItem>}
            {canAssign && assignees.filter((a) => a.id !== meId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityF} onValueChange={setPriorityF}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem><SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36" title="Created from" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-36" title="Created to" />
        <span className="ml-auto text-sm text-muted-foreground">{visible.length} shown</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left font-semibold">Task</th>
              <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">Assigned by</th>
              <th className="hidden px-3 py-2 text-left font-semibold md:table-cell">Assigned to</th>
              <Th col="priority">Priority</Th>
              <Th col="createdAt">Created</Th>
              <Th col="dueAt">Due</Th>
              <th className="px-3 py-2 text-left font-semibold">Age / duration</th>
              {canManage && <th className="w-8 px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No tasks match these filters.</td></tr>
            ) : (
              visible.map((t) => (
                <tr key={t.id} data-search-item data-search-text={`${t.title} ${t.leadName ?? ""} ${t.assignee ?? ""} ${t.assignedBy ?? ""}`} className={cn("hover:bg-muted/40", isOverdue(t) && "bg-destructive/[0.03]")}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggle(t)} aria-label="Toggle done">
                      {t.status === "done" ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</div>
                    {t.leadName && (
                      <Link href={`/portal/leads/${t.leadId}`} className="inline-flex items-center gap-0.5 text-xs text-gold hover:underline">
                        <Link2 className="size-3" /> {t.leadName}
                      </Link>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">{t.assignedBy ?? "—"}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{t.assignee ?? "Unassigned"}</td>
                  <td className="px-3 py-2"><PriorityBadge priority={t.priority} /></td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmt.date(t.createdAt)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {t.dueAt ? <span className={cn(isOverdue(t) && "font-medium text-destructive")}>{fmt.date(t.dueAt)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {ageCell(t)}
                    {t.status === "done" && t.completedBy && <div className="text-[10px] text-muted-foreground">by {t.completedBy}</div>}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <button onClick={() => remove(t.id)} aria-label="Delete"><Trash2 className="size-4 text-destructive" /></button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", accent && "border-destructive/30 bg-destructive/5")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    low: "bg-muted text-muted-foreground",
    medium: "bg-blue-100 text-blue-700",
    high: "bg-orange-100 text-orange-700",
    urgent: "bg-red-100 text-red-700",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", map[priority] ?? map.medium)}>{priority}</span>;
}
