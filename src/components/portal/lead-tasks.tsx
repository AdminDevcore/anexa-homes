"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, CheckCircle2, Circle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTaskAction, setTaskStatusAction, deleteTaskAction } from "@/server/modules/tasks/actions";
import { formatDate } from "@/lib/format";

type Task = { id: string; title: string; status: string; dueAt: string | null; assignee: string | null };
type Option = { id: string; name: string };

export function LeadTasks({
  leadId,
  tasks,
  assignees,
  canCreate,
  canManage,
}: {
  leadId: string;
  tasks: Task[];
  assignees: Option[];
  canCreate: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function add() {
    if (!title.trim()) return toast.error("Enter a task.");
    setPending(true);
    const res = await createTaskAction({ title, assigneeId, dueAt, leadId, priority: "medium" });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    setTitle(""); setAssigneeId(""); setDueAt("");
    toast.success("Task added");
    router.refresh();
  }

  async function toggle(t: Task) {
    const res = await setTaskStatusAction(t.id, (t.status === "done" ? "todo" : "done") as "todo" | "done");
    if (res.ok) router.refresh();
  }
  async function remove(id: string) {
    const res = await deleteTaskAction(id);
    if (res.ok) router.refresh();
    else toast.error(res.error);
  }

  const now = Date.now();

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex flex-col gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow-up task…" className="w-full" />
          <div className="flex gap-2">
            {assignees.length > 0 && (
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Assign to me" /></SelectTrigger>
                <SelectContent>
                  {assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="flex-1" />
          </div>
          <Button onClick={add} disabled={pending} size="sm" className="w-full">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add follow-up
          </Button>
        </div>
      )}

      <ul className="space-y-2">
        {tasks.length === 0 && <li className="text-sm text-muted-foreground">No follow-ups yet.</li>}
        {tasks.map((t) => {
          const overdue = t.dueAt && t.status !== "done" && new Date(t.dueAt).getTime() < now;
          return (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
              <button onClick={() => toggle(t)} aria-label="Toggle done">
                {t.status === "done" ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="size-5 text-muted-foreground" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {t.assignee ?? "Unassigned"}
                  {t.dueAt && (
                    <span className={cn(overdue && "font-medium text-destructive")}> · {overdue ? "overdue" : "due"} {formatDate(t.dueAt)}</span>
                  )}
                </div>
              </div>
              {canManage && (
                <button onClick={() => remove(t.id)} aria-label="Delete"><Trash2 className="size-4 text-destructive" /></button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
