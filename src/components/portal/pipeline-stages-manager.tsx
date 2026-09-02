"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { BlockerParty } from "@prisma/client";
import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { stageOwnerLabel, BLOCKER_LABEL } from "@/lib/solar-pipeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Caution,
  FieldGrid,
  Hint,
  ItemRail,
  Panel,
  Pill,
  RailLayout,
  RailRow,
  SaveBar,
  SelectField,
  StatRow,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import {
  addPipelineStageAction,
  updatePipelineStageAction,
  deletePipelineStageAction,
  reorderPipelineStagesAction,
} from "@/server/modules/settings/actions";

type Recipient =
  | "none"
  | "assigned_user"
  | "team_manager"
  | "project_owner"
  | "department_manager"
  | "everyone";

type Stage = {
  id: string;
  name: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
  targetDays: number;
  escalationDays: number;
  notificationRecipient: string;
  sendInApp: boolean;
  sendEmail: boolean;
  markOverdue: boolean;
  stageType: "internally_owned" | "externally_blocked";
  ownerRole: string | null;
  followUpDays: number;
  isActionRequired: boolean;
  defaultBlocker: string | null;
};

const RECIPIENTS: { value: Recipient; label: string }[] = [
  { value: "none", label: "Nobody" },
  { value: "assigned_user", label: "The assigned user" },
  { value: "team_manager", label: "Their team manager" },
  { value: "project_owner", label: "The project owner" },
  { value: "department_manager", label: "The department manager" },
  { value: "everyone", label: "Everyone" },
];

const COLORS = [
  "#A1A1AA",
  "#60A5FA",
  "#A78BFA",
  "#F472B6",
  "#FB923C",
  "#FBBF24",
  "#A3E635",
  "#22C55E",
  "#2DD4BF",
  "#BFA15F",
];

/**
 * The stages a deal moves through, one at a time.
 *
 * The screen this replaces put a stage's whole configuration behind a pencil
 * that opened a 28rem dialog — and then, because a day limit is the field
 * people actually change, smuggled a second copy of it onto the row as an
 * inline box that saved on blur. So one setting had two editors that could
 * disagree, and everything else was two clicks and a scroll away.
 *
 * One rail, one panel, one Save.
 */
export function PipelineStagesManager({
  pipelineId,
  stages,
  initialStageId,
}: {
  pipelineId: string;
  stages: Stage[];
  initialStageId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialStageId ?? stages[0]?.id ?? null
  );

  const selected = stages.find((s) => s.id === selectedId) ?? stages[0] ?? null;
  const index = selected ? stages.findIndex((s) => s.id === selected.id) : -1;

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selected) p.set("stage", selected.id);
    else p.delete("stage");
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [selected]);

  async function move(dir: -1 | 1) {
    const target = index + dir;
    if (index < 0 || target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const res = await reorderPipelineStagesAction(next.map((s) => s.id));
      if (!res.ok) return toast.error(res.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Pipeline stages"
          add={<AddStageDialog pipelineId={pipelineId} onAdded={setSelectedId} full />}
        >
          {stages.map((s) => (
            <RailRow
              key={s.id}
              title={s.name}
              subtitle={stageSubtitle(s)}
              mark={
                <span
                  className="size-3 shrink-0 rounded-full ring-2 ring-background"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
              }
              selected={s.id === selected?.id}
              onSelect={() => setSelectedId(s.id)}
            />
          ))}
        </ItemRail>
      }
    >
      {selected && (
        <StagePanel
          key={selected.id}
          stage={selected}
          index={index}
          total={stages.length}
          busy={busy}
          onMove={move}
          onDeleted={() => setSelectedId(null)}
        />
      )}
    </RailLayout>
  );
}

/** What a stage says about itself in one line. */
function stageSubtitle(s: Stage): string {
  if (s.isWon) return "won";
  if (s.isLost) return "lost";
  if (s.stageType === "externally_blocked") {
    return `waiting${s.followUpDays ? ` · chase every ${s.followUpDays}d` : ""}`;
  }
  return s.targetDays > 0 ? `${s.targetDays} day limit` : "no day limit";
}

/** One stage: what it is called, and how long a deal may sit in it. */
function StagePanel({
  stage,
  index,
  total,
  busy: reordering,
  onMove,
  onDeleted,
}: {
  stage: Stage;
  index: number;
  total: number;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const busy = saving || reordering;

  const seed = React.useCallback(
    () => ({
      name: stage.name,
      color: stage.color,
      isWon: stage.isWon,
      isLost: stage.isLost,
      targetDays: stage.targetDays ? String(stage.targetDays) : "",
      escalationDays: stage.escalationDays ? String(stage.escalationDays) : "",
      recipient: (stage.notificationRecipient as Recipient) ?? "none",
      sendInApp: stage.sendInApp,
      sendEmail: stage.sendEmail,
      markOverdue: stage.markOverdue,
    }),
    [stage]
  );

  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([stage.id, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const set = <K extends keyof ReturnType<typeof seed>>(k: K, v: ReturnType<typeof seed>[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const owner = stageOwnerLabel(stage.ownerRole);
  const blocker = stage.defaultBlocker as BlockerParty | null;
  const external = stage.stageType === "externally_blocked";

  async function save() {
    setSaving(true);
    try {
      const res = await updatePipelineStageAction(stage.id, {
        name: draft.name.trim(),
        color: draft.color,
        isWon: draft.isWon,
        isLost: draft.isLost,
        targetDays: Math.max(0, parseInt(draft.targetDays || "0", 10) || 0),
        escalationDays: Math.max(0, parseInt(draft.escalationDays || "0", 10) || 0),
        notificationRecipient: draft.recipient,
        sendInApp: draft.sendInApp,
        sendEmail: draft.sendEmail,
        markOverdue: draft.markOverdue,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success(`${draft.name.trim()} saved`);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="stage-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span
          className="mt-1 size-8 shrink-0 rounded-lg"
          style={{ backgroundColor: draft.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold tracking-tight">
            {stage.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill>
              #{index + 1} of {total}
            </Pill>
            {stage.isWon && <Pill tone="gold">Won</Pill>}
            {stage.isLost && <Pill tone="warn">Lost</Pill>}
            {stage.isActionRequired && <Pill tone="warn">Action required</Pill>}
            {owner && <Pill>{owner}</Pill>}
            {blocker && <Pill tone="solar">{BLOCKER_LABEL[blocker]}</Pill>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            disabled={busy || index === 0}
            aria-label={`Move ${stage.name} earlier`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            disabled={busy || index === total - 1}
            aria-label={`Move ${stage.name} later`}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`More for ${stage.name}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  setSaving(true);
                  try {
                    const res = await deletePipelineStageAction(stage.id);
                    if (!res.ok) return toast.error(res.error);
                    toast.success("Stage deleted");
                    onDeleted();
                    router.refresh();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Trash2 className="size-4" /> Delete — deals sitting here are left with no stage
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <Panel title="Identity">
            <TextField
              label="Name"
              value={draft.name}
              onChange={(v) => set("name", v)}
              placeholder="e.g. Adjuster Meeting"
              id={`stage-${stage.id}-name`}
            />
            <div className="space-y-1.5">
              <Label className="text-xs">Colour</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set("color", c)}
                    className={cn(
                      "size-7 rounded-full border-2",
                      draft.color === c ? "border-foreground" : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`Colour ${c}`}
                    aria-pressed={draft.color === c}
                  />
                ))}
              </div>
              <Hint>What the board column and every stage chip on a deal are tinted with.</Hint>
            </div>
            <FieldGrid columns={2}>
              <ToggleRow
                label="Won stage"
                description="A deal reaching it counts as sold."
                checked={draft.isWon}
                onChange={(v) => set("isWon", v)}
              />
              <ToggleRow
                label="Lost stage"
                description="A deal reaching it counts as lost."
                checked={draft.isLost}
                onChange={(v) => set("isLost", v)}
              />
            </FieldGrid>
            {draft.isWon && draft.isLost && (
              <Caution>
                A stage cannot honestly be both won and lost — every report that counts one will
                count the other.
              </Caution>
            )}
          </Panel>

          <Panel
            title="How long a deal may sit here"
            description="Deals past the limit show in the Overdue Jobs report and set off the overdue alerts."
          >
            {external ? (
              <Hint>
                This stage waits on somebody outside the company — an AHJ, a utility, a lender, the
                customer — so it has no completion deadline by design. It is tracked by a follow-up
                cadence instead, currently every {stage.followUpDays || "—"} days, set on the stage
                model under{" "}
                <Link href="/portal/settings/solar" className="underline underline-offset-2">
                  Solar Settings
                </Link>
                .
              </Hint>
            ) : (
              <>
                <FieldGrid columns={2}>
                  <TextField
                    label="Day limit"
                    type="number"
                    value={draft.targetDays}
                    onChange={(v) => set("targetDays", v)}
                    placeholder="0"
                    hint="Days a deal may sit here before it is flagged delinquent. Blank or 0 means no tracking."
                  />
                  <TextField
                    label="Escalation days"
                    type="number"
                    value={draft.escalationDays}
                    onChange={(v) => set("escalationDays", v)}
                    placeholder="0"
                    hint="Extra days after the limit before it escalates."
                  />
                </FieldGrid>
                <SelectField
                  label="Notify"
                  value={draft.recipient}
                  onChange={(v) => set("recipient", v)}
                  options={RECIPIENTS}
                />
                <ToggleRow
                  label="Send an in-app notification"
                  checked={draft.sendInApp}
                  onChange={(v) => set("sendInApp", v)}
                />
                <ToggleRow
                  label="Send an email"
                  description="Reaches people outside the app, including on days off."
                  checked={draft.sendEmail}
                  onChange={(v) => set("sendEmail", v)}
                />
                <ToggleRow
                  label="Mark the project overdue"
                  description="Puts the job on the Overdue Jobs report and the manager dashboard."
                  checked={draft.markOverdue}
                  onChange={(v) => set("markOverdue", v)}
                />
                {draft.recipient !== "none" && !draft.sendInApp && !draft.sendEmail && (
                  <Caution>
                    Somebody is named to notify but neither channel is on, so nothing is ever sent.
                  </Caution>
                )}
              </>
            )}
          </Panel>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Panel title="Set on the stage model" tone="muted">
            <dl>
              <StatRow label="Kind" value={external ? "waiting on others" : "ours to move"} />
              <StatRow label="Owner" value={owner ?? "—"} />
              <StatRow label="Waiting on" value={blocker ? BLOCKER_LABEL[blocker] : "—"} />
              <StatRow label="Chase every" value={stage.followUpDays ? `${stage.followUpDays}d` : "—"} />
              <StatRow label="Action required" value={stage.isActionRequired ? "yes" : "no"} />
            </dl>
            <Hint className="mt-2">
              These belong to the solar stage model — who owns a stage and who a deal there is
              waiting on — and are edited under{" "}
              <Link href="/portal/settings/solar" className="underline underline-offset-2">
                Solar Settings
              </Link>
              . Roofing stages carry none of them.
            </Hint>
          </Panel>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        busy={saving}
        what={stage.name}
        onSave={save}
        onDiscard={() => setDraft(seed())}
        disabled={draft.name.trim() === ""}
        blockedReason={draft.name.trim() === "" ? "A stage needs a name." : undefined}
      />
    </div>
  );
}

/** Adding a stage: a name and a colour. Everything else is set on the panel. */
function AddStageDialog({
  pipelineId,
  onAdded,
  full,
}: {
  pipelineId: string;
  onAdded: (id: string) => void;
  full?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(COLORS[0]);
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await addPipelineStageAction(pipelineId, {
        name: name.trim(),
        color,
        isWon: false,
        isLost: false,
        targetDays: 0,
        escalationDays: 0,
        notificationRecipient: "none",
        sendInApp: true,
        sendEmail: false,
        markOverdue: false,
      });
      if (!res.ok) return toast.error(res.error);
      onAdded(res.id);
      toast.success(`${name.trim()} added`);
      setName("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={full ? "w-full" : undefined}>
          <Plus className="size-4" /> New stage
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a stage</DialogTitle>
          <DialogDescription>
            It lands at the end of the pipeline. Its day limit and alerts are set on the panel next.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-stage-name">
              Name
            </Label>
            <Input
              id="new-stage-name"
              value={name}
              placeholder="e.g. Adjuster Meeting"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Colour</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-7 rounded-full border-2",
                    color === c ? "border-foreground" : "border-transparent"
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={add} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
