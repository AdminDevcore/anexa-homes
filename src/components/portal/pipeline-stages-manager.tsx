"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BlockerParty } from "@prisma/client";
import { stageOwnerLabel, BLOCKER_LABEL, BLOCKER_TONE } from "@/lib/solar-pipeline";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  addPipelineStageAction,
  updatePipelineStageAction,
  deletePipelineStageAction,
  reorderPipelineStagesAction,
} from "@/server/modules/settings/actions";

type Recipient = "none" | "assigned_user" | "team_manager" | "project_owner" | "department_manager" | "everyone";
type Stage = {
  id: string; name: string; color: string; isWon: boolean; isLost: boolean;
  targetDays: number; escalationDays: number; notificationRecipient: string;
  sendInApp: boolean; sendEmail: boolean; markOverdue: boolean;
  stageType: "internally_owned" | "externally_blocked";
  ownerRole: string | null; followUpDays: number;
  isActionRequired: boolean; defaultBlocker: string | null;
};

const RECIPIENTS: { value: Recipient; label: string }[] = [
  { value: "none", label: "None" },
  { value: "assigned_user", label: "Assigned User" },
  { value: "team_manager", label: "Team Manager" },
  { value: "project_owner", label: "Project Owner" },
  { value: "department_manager", label: "Department Manager" },
  { value: "everyone", label: "Everyone" },
];

const COLORS = ["#A1A1AA", "#60A5FA", "#A78BFA", "#F472B6", "#FB923C", "#FBBF24", "#A3E635", "#22C55E", "#2DD4BF", "#BFA15F"];

export function PipelineStagesManager({ pipelineId, stages }: { pipelineId: string; stages: Stage[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function move(index: number, dir: -1 | 1) {
    const next = [...stages];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    const res = await reorderPipelineStagesAction(next.map((s) => s.id));
    setBusy(false);
    if (res.ok) router.refresh();
    else toast.error(res.error);
  }

  async function remove(id: string) {
    if (!confirm("Delete this stage? Appointments here will be unassigned from it.")) return;
    setBusy(true);
    const res = await deletePipelineStageAction(id);
    setBusy(false);
    if (res.ok) {
      toast.success("Stage deleted");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Set a <strong className="font-medium text-foreground">day limit</strong> on a stage to track how long deals sit there. Deals past the limit show in the{" "}
          <a href="/portal/reports/delinquency" className="underline underline-offset-2 hover:text-foreground">Overdue Jobs report</a> and trigger overdue alerts.
        </p>
        <StageDialog pipelineId={pipelineId} />
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {stages.map((s, i) => (
          <div key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="size-3 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="font-medium">{s.name}</span>
              {s.isWon && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Won</span>}
              {s.isLost && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">Lost</span>}
              {s.escalationDays > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" title="Extra days after the limit before the deal escalates">
                  +{s.escalationDays}d escalate
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <StageOwnership stage={s} />
              <InlineDayLimit stage={s} />
              <Button variant="ghost" size="icon" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button variant="ghost" size="icon" disabled={busy || i === stages.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
              <StageDialog pipelineId={pipelineId} stage={s} trigger={<Button variant="ghost" size="icon"><Pencil className="size-4" /></Button>} />
              <Button variant="ghost" size="icon" disabled={busy} onClick={() => remove(s.id)}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Who owns this stage, and who a deal here is waiting on.
 *
 * Owners are DEPARTMENT ROLES rather than named people, so work keeps routing
 * correctly as staff change. Roofing stages carry no owner and render nothing,
 * so this is invisible on the roofing pipeline.
 */
function StageOwnership({ stage }: { stage: Stage }) {
  const owner = stageOwnerLabel(stage.ownerRole);
  const blocker = stage.defaultBlocker as BlockerParty | null;
  if (!owner && !blocker && !stage.isActionRequired) return null;
  return (
    <div className="mr-1 hidden items-center gap-1.5 sm:flex">
      {stage.isActionRequired && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
          action required
        </span>
      )}
      {owner && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {owner}
        </span>
      )}
      {blocker && (
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", BLOCKER_TONE[blocker])}>
          {BLOCKER_LABEL[blocker]}
        </span>
      )}
    </div>
  );
}

// Quick inline day-limit box on each stage row — type a number, blur/Enter to save.
function InlineDayLimit({ stage }: { stage: Stage }) {
  const router = useRouter();
  const [val, setVal] = React.useState(stage.targetDays > 0 ? String(stage.targetDays) : "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { setVal(stage.targetDays > 0 ? String(stage.targetDays) : ""); }, [stage.targetDays]);

  async function save() {
    const n = Math.max(0, parseInt(val || "0", 10) || 0);
    if (n === (stage.targetDays || 0)) return;
    setSaving(true);
    const res = await updatePipelineStageAction(stage.id, {
      name: stage.name, color: stage.color, isWon: stage.isWon, isLost: stage.isLost,
      targetDays: n, escalationDays: stage.escalationDays, notificationRecipient: stage.notificationRecipient as never,
      sendInApp: stage.sendInApp, sendEmail: stage.sendEmail, markOverdue: stage.markOverdue,
    });
    setSaving(false);
    if (res.ok) { toast.success(n > 0 ? `Day limit set to ${n}` : "Day limit removed"); router.refresh(); }
    else toast.error(res.error);
  }

  // An externally-blocked stage has no completion deadline by design — it is
  // waiting on an AHJ, utility, lender or the customer. Offering a day limit
  // here would invite someone to put our team on the hook for their queue.
  if (stage.stageType === "externally_blocked") {
    return (
      <span
        className="mr-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700"
        title="Waiting on a third party. Tracked by follow-up cadence, not a deadline."
      >
        chase {stage.followUpDays || "—"}d
      </span>
    );
  }

  return (
    <div className="mr-1 flex items-center gap-1.5" title="Max days a deal should stay in this stage before it's flagged delinquent. Blank = no limit.">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        className="h-8 w-14 text-center text-sm"
      />
      <span className="w-12 text-xs text-muted-foreground">{saving ? "saving…" : "day limit"}</span>
    </div>
  );
}

function StageDialog({ pipelineId, stage, trigger }: { pipelineId: string; stage?: Stage; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(stage?.name ?? "");
  const [color, setColor] = React.useState(stage?.color ?? COLORS[0]);
  const [isWon, setIsWon] = React.useState(stage?.isWon ?? false);
  const [isLost, setIsLost] = React.useState(stage?.isLost ?? false);
  const [targetDays, setTargetDays] = React.useState(String(stage?.targetDays ?? 0));
  const [escalationDays, setEscalationDays] = React.useState(String(stage?.escalationDays ?? 0));
  const [recipient, setRecipient] = React.useState<Recipient>((stage?.notificationRecipient as Recipient) ?? "none");
  const [sendInApp, setSendInApp] = React.useState(stage?.sendInApp ?? true);
  const [sendEmail, setSendEmail] = React.useState(stage?.sendEmail ?? false);
  const [markOverdue, setMarkOverdue] = React.useState(stage?.markOverdue ?? false);
  const [pending, setPending] = React.useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Name required.");
      return;
    }
    setPending(true);
    const payload = {
      name, color, isWon, isLost,
      targetDays: Math.max(0, parseInt(targetDays || "0", 10) || 0),
      escalationDays: Math.max(0, parseInt(escalationDays || "0", 10) || 0),
      notificationRecipient: recipient,
      sendInApp, sendEmail, markOverdue,
    };
    const res = stage
      ? await updatePipelineStageAction(stage.id, payload)
      : await addPipelineStageAction(pipelineId, payload);
    setPending(false);
    if (res.ok) {
      toast.success(stage ? "Stage updated" : "Stage added");
      setOpen(false);
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="bg-gold text-gold-foreground hover:bg-gold/90">
            <Plus className="size-4" /> Add Stage
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stage ? "Edit" : "New"} Stage</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adjuster Meeting" />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isWon} onCheckedChange={setIsWon} /> Won stage
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isLost} onCheckedChange={setIsLost} /> Lost stage
            </label>
          </div>

          {/* SLA / stage-duration tracking */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-muted-foreground">⏱ Stage duration tracking</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Day limit in stage</Label>
                <Input type="number" inputMode="numeric" value={targetDays} onChange={(e) => setTargetDays(e.target.value)} placeholder="0" />
                <p className="text-[10px] text-muted-foreground">Days a deal may sit here before it&apos;s flagged delinquent. 0 = no tracking.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Escalation days</Label>
                <Input type="number" inputMode="numeric" value={escalationDays} onChange={(e) => setEscalationDays(e.target.value)} placeholder="0" />
                <p className="text-[10px] text-muted-foreground">Extra days after target before escalating.</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notify</Label>
              <select value={recipient} onChange={(e) => setRecipient(e.target.value as Recipient)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                {RECIPIENTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm"><Switch checked={sendInApp} onCheckedChange={setSendInApp} /> Send in-app notification</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={sendEmail} onCheckedChange={setSendEmail} /> Send email notification</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={markOverdue} onCheckedChange={setMarkOverdue} /> Mark project as overdue</label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {stage ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
