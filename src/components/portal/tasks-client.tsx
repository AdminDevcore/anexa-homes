"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, Trash2, Briefcase, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTaskStatusAction, deleteTaskAction } from "@/server/modules/tasks/actions";
import { useFormat } from "@/components/portal/branding-provider";
import { NewTaskDialog } from "@/components/portal/tasks/new-task-dialog";
import { TasksToolbar, DEFAULT_FILTERS, type TaskFilters } from "@/components/portal/tasks/tasks-toolbar";

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

  const [filters, setFilters] = React.useState<TaskFilters>(DEFAULT_FILTERS);
  const patch = React.useCallback(
    (p: Partial<TaskFilters>) => setFilters((f) => ({ ...f, ...p })),
    []
  );
  const [sort, setSort] = React.useState<{ col: SortCol; dir: 1 | -1 }>({ col: "createdAt", dir: -1 });

  // Frozen at mount: "open N days / overdue" is a day-grain readout, so a clock
  // that ticks per render would only churn the list without changing anything.
  const [now] = React.useState(() => Date.now());
  const isOverdue = (t: Task) => t.status !== "done" && !!t.dueAt && new Date(t.dueAt).getTime() < now;

  // Summary over the full (server-scoped) set.
  const openCount = tasks.filter((t) => t.status !== "done").length;
  const overdueCount = tasks.filter(isOverdue).length;
  const doneDurations = tasks
    .filter((t) => t.status === "done" && t.completedAt)
    .map((t) => daysBetween(new Date(t.createdAt).getTime(), new Date(t.completedAt!).getTime()));
  const avgDays = doneDurations.length ? Math.round((doneDurations.reduce((a, b) => a + b, 0) / doneDurations.length) * 10) / 10 : null;

  const fromMs = filters.from ? new Date(filters.from).getTime() : null;
  const toMs = filters.to ? new Date(filters.to).getTime() + DAY - 1 : null;
  const needle = filters.q.trim().toLowerCase();

  const visible = tasks
    .filter((t) => {
      const { person, status, priority } = filters;
      if (person === "mine" && !(t.assigneeId === meId || t.createdById === meId)) return false;
      if (person === "to_me" && t.assigneeId !== meId) return false;
      if (person === "by_me" && t.createdById !== meId) return false;
      if (!["mine", "to_me", "by_me", "all"].includes(person) && t.assigneeId !== person) return false;
      if (status === "open" && t.status === "done") return false;
      if (status === "completed" && t.status !== "done") return false;
      if (status === "overdue" && !isOverdue(t)) return false;
      if (priority !== "all" && t.priority !== priority) return false;
      const created = new Date(t.createdAt).getTime();
      if (fromMs && created < fromMs) return false;
      if (toMs && created > toMs) return false;
      if (needle) {
        const hay = `${t.title} ${t.leadName ?? ""} ${t.assignee ?? ""} ${t.assignedBy ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
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

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value={openCount} />
        <Stat label="Overdue" value={overdueCount} accent={overdueCount > 0} />
        <Stat label="Avg days to complete" value={avgDays == null ? "—" : avgDays} />
      </div>

      <TasksToolbar
        filters={filters}
        onChange={patch}
        assignees={assignees}
        canAssign={canAssign}
        meId={meId}
        shown={visible.length}
        createSlot={
          canCreate ? (
            <NewTaskDialog
              assignees={assignees}
              canAssign={canAssign}
              onCreated={() => router.refresh()}
            />
          ) : null
        }
      />

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left font-semibold">Task</th>
              <th className="hidden px-3 py-2 text-left font-semibold lg:table-cell">Assigned by</th>
              <th className="hidden px-3 py-2 text-left font-semibold md:table-cell">Assigned to</th>
              <SortTh col="priority" sort={sort} onToggle={toggleSort}>Priority</SortTh>
              <SortTh col="createdAt" sort={sort} onToggle={toggleSort}>Created</SortTh>
              <SortTh col="dueAt" sort={sort} onToggle={toggleSort}>Due</SortTh>
              <th className="px-3 py-2 text-left font-semibold">Age / duration</th>
              {canManage && <th className="w-8 px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No tasks match these filters.</td></tr>
            ) : (
              visible.map((t) => (
                <tr key={t.id} className={cn("hover:bg-muted/40", isOverdue(t) && "bg-destructive/[0.03]")}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggle(t)} aria-label="Toggle done">
                      {t.status === "done" ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</div>
                    {t.leadName && <JobTag leadId={t.leadId} leadName={t.leadName} />}
                  </td>
                  <td className="hidden px-3 py-2 lg:table-cell"><Person name={t.assignedBy} /></td>
                  <td className="hidden px-3 py-2 md:table-cell"><Person name={t.assignee} fallback="Unassigned" /></td>
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

      {/* Mobile: cards */}
      <div className="space-y-2 md:hidden">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-10 text-center text-sm text-muted-foreground">
            No tasks match these filters.
          </div>
        ) : (
          visible.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-card p-3",
                isOverdue(t) ? "border-destructive/30 bg-destructive/[0.03]" : "border-border"
              )}
            >
              <button onClick={() => toggle(t)} aria-label="Toggle done" className="mt-0.5 shrink-0">
                {t.status === "done" ? (
                  <CheckCircle2 className="size-5 text-emerald-500" />
                ) : (
                  <Circle className="size-5 text-muted-foreground" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>
                  {t.title}
                </div>
                {t.leadName ? <JobTag leadId={t.leadId} leadName={t.leadName} /> : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <PriorityBadge priority={t.priority} />
                  {t.assignee ? <span>{t.assignee}</span> : null}
                  {t.dueAt ? (
                    <span className={cn(isOverdue(t) && "font-medium text-destructive")}>Due {fmt.date(t.dueAt)}</span>
                  ) : null}
                  <span>{ageCell(t)}</span>
                </div>
              </div>
              {canManage ? (
                <button onClick={() => remove(t.id)} aria-label="Delete" className="mt-0.5 shrink-0">
                  <Trash2 className="size-4 text-destructive" />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Sortable column header. Top-level so it isn't re-created every render. */
function SortTh({
  col,
  sort,
  onToggle,
  children,
}: {
  col: SortCol;
  sort: { col: SortCol; dir: 1 | -1 };
  onToggle: (col: SortCol) => void;
  children: React.ReactNode;
}) {
  return (
    <th className="px-3 py-2 text-left font-semibold">
      <button onClick={() => onToggle(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        <ArrowUpDown className={cn("size-3", sort.col === col ? "text-foreground" : "text-muted-foreground/40")} />
      </button>
    </th>
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

/** The job this task is tagged to — links straight to the deal. */
function JobTag({ leadId, leadName }: { leadId: string | null; leadName: string }) {
  return (
    <Link
      href={`/portal/leads/${leadId}`}
      className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-xs text-gold hover:bg-gold/20"
    >
      <Briefcase className="size-3 shrink-0" />
      <span className="truncate">{leadName}</span>
    </Link>
  );
}

/** Name with an initials chip, so "assigned by" and "assigned to" read apart. */
function Person({ name, fallback = "—" }: { name: string | null; fallback?: string }) {
  if (!name) return <span className="text-muted-foreground">{fallback}</span>;
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
        {initials}
      </span>
      <span className="truncate">{name}</span>
    </span>
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
