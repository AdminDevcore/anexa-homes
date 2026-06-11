"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

type Stage = { id: string; name: string; color: string; isWon: boolean; isLost: boolean };

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
      <div className="flex justify-end">
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
            </div>
            <div className="flex items-center gap-1">
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

function StageDialog({ pipelineId, stage, trigger }: { pipelineId: string; stage?: Stage; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(stage?.name ?? "");
  const [color, setColor] = React.useState(stage?.color ?? COLORS[0]);
  const [isWon, setIsWon] = React.useState(stage?.isWon ?? false);
  const [isLost, setIsLost] = React.useState(stage?.isLost ?? false);
  const [pending, setPending] = React.useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Name required.");
      return;
    }
    setPending(true);
    const payload = { name, color, isWon, isLost };
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
