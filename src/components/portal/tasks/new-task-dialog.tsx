"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JobPicker, type JobOption } from "@/components/portal/job-picker";
import { createTaskAction } from "@/server/modules/tasks/actions";

type Option = { id: string; name: string };
type Priority = "low" | "medium" | "high" | "urgent";

/**
 * "New task" modal. Replaces the old inline create row so the job picker has
 * room to breathe.
 *
 * Tagging a job pre-selects that deal's assigned rep as the assignee — which is
 * also the rule the server enforces (`createTaskAction` only lets a sales_rep be
 * tagged on a deal-linked task if they own that deal), so the default is always
 * a valid one. It stays editable for the office roles that may pick anyone.
 */
export function NewTaskDialog({
  assignees,
  canAssign,
  onCreated,
}: {
  assignees: Option[];
  canAssign: boolean;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [job, setJob] = React.useState<JobOption | null>(null);
  const [assigneeId, setAssigneeId] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("medium");
  const [dueAt, setDueAt] = React.useState("");
  const [pending, setPending] = React.useState(false);

  function reset() {
    setTitle("");
    setJob(null);
    setAssigneeId("");
    setPriority("medium");
    setDueAt("");
  }

  function pickJob(next: JobOption | null) {
    setJob(next);
    // Auto-fill the assignee with the deal's rep, but only if they're actually
    // in the assignable list — otherwise we'd point the Select at a dead value.
    if (next?.assignedRepId && assignees.some((a) => a.id === next.assignedRepId)) {
      setAssigneeId(next.assignedRepId);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("Enter a task title.");
    setPending(true);
    const res = await createTaskAction({
      title: title.trim(),
      assigneeId,
      priority,
      dueAt,
      leadId: job?.id ?? "",
    });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(job ? `Task added to ${job.name}` : "Task added");
    reset();
    setOpen(false);
    onCreated();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90">
          <Plus className="size-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Tag it to a job so it shows up on that deal too.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Task" htmlFor="task-title">
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New task…"
              autoFocus
              maxLength={160}
            />
          </Field>

          <Field label="Job" hint="optional">
            <JobPicker value={job} onChange={pickJob} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {canAssign && assignees.length > 0 ? (
              <Field label="Assign to" className="col-span-2 sm:col-span-1">
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Assign to me" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignees.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field label="Priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due date">
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="bg-gold text-gold-foreground hover:bg-gold/90"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 font-normal text-muted-foreground/70">({hint})</span> : null}
      </label>
      {children}
    </div>
  );
}
