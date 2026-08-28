"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  Zap,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronUp,
} from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createAutomationRuleAction,
  updateAutomationRuleAction,
  toggleAutomationRuleAction,
  deleteAutomationRuleAction,
  createStarterAutomationsAction,
} from "@/server/modules/automations/actions.server";
import {
  TRIGGER_DEFS,
  ACTION_DEFS,
  triggerLabel,
  actionLabel,
} from "@/server/modules/automations/types";

type Option = { id: string; name: string };
type Cfg = Record<string, unknown>;

type Rule = {
  id: string;
  name: string;
  trigger: string;
  conditions: Cfg;
  actions: Cfg[];
  once: boolean;
  active: boolean;
};

type Run = {
  id: string;
  ruleName: string;
  status: string;
  steps: { type: string; ok: boolean; detail: string }[];
  error: string | null;
  startedAt: string;
  lead: { id: string; name: string } | null;
};

type Props = {
  rules: Rule[];
  stages: Option[];
  templates: Option[];
  statuses: string[];
  runs: Run[];
};

/**
 * Who signs, when a rule sends a document.
 *
 * No co-owner: Lead stores a co-owner NAME but no co-owner email, so there is
 * no address an automation could send to. Kept in step with the same list in
 * server/modules/automations/actions/send-for-signature.ts.
 */
const SIGNERS = [
  { value: "customer", label: "the customer" },
  { value: "assigned_rep", label: "the assigned rep" },
];

const CHECKLISTS = [
  { value: "site", label: "Site / survey photos" },
  { value: "install", label: "Install photos" },
];

export function AutomationRulesManager(props: Props) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.rules.length === 0 && <StarterAutomationsButton />}
        <RuleDialog {...props} />
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {props.rules.length === 0 && (
          <div className="space-y-1 px-5 py-10 text-center text-sm text-muted-foreground">
            <p>No automations yet, so nothing happens on its own in this workspace.</p>
            <p className="text-xs">Rules do not carry across workspaces.</p>
          </div>
        )}
        {props.rules.map((r) => (
          <RuleRow key={r.id} rule={r} {...props} />
        ))}
      </div>

      <RunsPanel runs={props.runs} />
    </div>
  );
}

// --- One rule --------------------------------------------------------------

function RuleRow({ rule, ...props }: Props & { rule: Rule }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggle(active: boolean) {
    setBusy(true);
    try {
      const res = await toggleAutomationRuleAction(rule.id, active);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    } finally {
      // ALWAYS in a finally. A busy flag left true by a thrown action is a row
      // whose switch never comes back to life.
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await deleteAutomationRuleAction(rule.id);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Automation deleted.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3 px-5 py-4">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
        <Zap className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{rule.name}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{sentence(rule, props)}</p>
        {!rule.once && (
          <p className="mt-1 text-xs text-muted-foreground">Repeats every time it matches.</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={rule.active}
          onCheckedChange={toggle}
          disabled={busy}
          aria-label={`${rule.name} active`}
        />
        <RuleDialog {...props} existing={rule} />
        <Button
          variant="ghost"
          size="icon"
          onClick={remove}
          disabled={busy}
          aria-label={`Delete ${rule.name}`}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

/** "When a deal lands in a pipeline stage (Installed) → generate …, move to …" */
function sentence(rule: Rule, props: Props): string {
  const def = TRIGGER_DEFS.find((t) => t.value === rule.trigger);
  const where = conditionLabel(rule, props);
  const what = rule.actions.map((a) => actionSummary(a, props)).join(", ");
  return `When a deal ${def?.blurb ?? triggerLabel(rule.trigger)}${where} → ${what || "nothing yet"}`;
}

function conditionLabel(rule: Rule, props: Props): string {
  const c = rule.conditions;
  if (rule.trigger === "stage_entered") {
    const s = props.stages.find((x) => x.id === c.stageId);
    return s ? ` (${s.name})` : "";
  }
  if (rule.trigger === "stage_age_exceeded") {
    const s = props.stages.find((x) => x.id === c.stageId);
    return s ? ` (${s.name}, ${String(c.days ?? "?")} days)` : "";
  }
  if (rule.trigger === "photo_checklist_completed") {
    const k = CHECKLISTS.find((x) => x.value === c.kind);
    return k ? ` (${k.label})` : "";
  }
  if (rule.trigger === "document_completed") {
    const t = props.templates.find((x) => x.id === c.templateId);
    return t ? ` (${t.name})` : "";
  }
  return "";
}

function actionSummary(a: Cfg, props: Props): string {
  switch (a.type) {
    case "generate_document":
      return `generate ${props.templates.find((t) => t.id === a.templateId)?.name ?? "a document"}`;
    case "send_for_signature":
      return `send ${props.templates.find((t) => t.id === a.templateId)?.name ?? "a document"} to ${
        SIGNERS.find((s) => s.value === a.signer)?.label ?? "a signer"
      }`;
    case "move_stage":
      return `move to ${props.stages.find((s) => s.id === a.stageId)?.name ?? "a stage"}`;
    case "set_project_status":
      return `set status to ${String(a.status ?? "?").replace(/_/g, " ")}`;
    case "compile_photos":
      return `compile the ${CHECKLISTS.find((c) => c.value === a.kind)?.label.toLowerCase() ?? ""}`;
    default:
      return actionLabel(String(a.type));
  }
}

// --- Create / edit ---------------------------------------------------------

function RuleDialog({ existing, ...props }: Props & { existing?: Rule }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [name, setName] = React.useState(existing?.name ?? "");
  const [trigger, setTrigger] = React.useState(existing?.trigger ?? "stage_entered");
  const [conditions, setConditions] = React.useState<Cfg>(existing?.conditions ?? {});
  const [actions, setActions] = React.useState<Cfg[]>(existing?.actions ?? []);
  const [once, setOnce] = React.useState(existing?.once ?? true);

  const def = TRIGGER_DEFS.find((t) => t.value === trigger);

  function pickTrigger(v: string) {
    setTrigger(v);
    // A stage id means nothing to a document trigger. Clearing it is what stops
    // a stale condition from silently matching everything after an edit.
    setConditions({});
  }

  async function save() {
    setBusy(true);
    try {
      const input = {
        name,
        trigger: trigger as never,
        conditions,
        actions,
        once,
        active: existing?.active ?? true,
      };
      const res = existing
        ? await updateAutomationRuleAction(existing.id, input)
        : await createAutomationRuleAction(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(existing ? "Automation updated." : "Automation created.");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? (
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="mr-1.5 size-4" /> New automation
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit automation" : "New automation"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Installed paperwork"
            />
          </div>

          <div className="space-y-1.5">
            <Label>When</Label>
            <Select value={trigger} onValueChange={pickTrigger}>
              <SelectTrigger aria-label="Trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_DEFS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ConditionControl
              kind={def?.condition ?? "stage"}
              value={conditions}
              onChange={setConditions}
              {...props}
            />
          </div>

          <div className="space-y-2">
            <Label>Then, in order</Label>
            {actions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No actions yet — a rule needs at least one.
              </p>
            )}
            {actions.map((a, i) => (
              <ActionRow
                key={i}
                index={i}
                value={a}
                onChange={(next) => setActions(actions.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setActions(actions.filter((_, j) => j !== i))}
                onMoveUp={
                  i === 0
                    ? undefined
                    : () => {
                        const next = [...actions];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setActions(next);
                      }
                }
                {...props}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActions([...actions, { type: "generate_document" }])}
            >
              <Plus className="mr-1.5 size-4" /> Add action
            </Button>
            {actions.length > 1 && (
              <p className="text-xs text-muted-foreground">
                They run in this order and stop at the first one that fails.
              </p>
            )}
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Switch checked={once} onCheckedChange={setOnce} />
            <span className="text-sm">
              Run at most once per deal
              <span className="block text-xs text-muted-foreground">
                Off means it runs every time the trigger matches.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={busy || !name.trim() || actions.length === 0}>
            {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {existing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConditionControl(
  props: Props & { kind: string; value: Cfg; onChange: (v: Cfg) => void }
) {
  const { kind, value, onChange } = props;

  if (kind === "stage" || kind === "stage_age") {
    return (
      <div className="flex flex-wrap gap-2">
        <Select
          value={(value.stageId as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, stageId: v })}
        >
          <SelectTrigger className="min-w-52 flex-1" aria-label="Which stage">
            <SelectValue placeholder="Any stage" />
          </SelectTrigger>
          <SelectContent>
            {props.stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === "stage_age" && (
          <Input
            type="number"
            min={1}
            className="w-28"
            placeholder="days"
            value={(value.days as number) ?? ""}
            onChange={(e) => onChange({ ...value, days: Number(e.target.value) || undefined })}
            aria-label="Days in stage"
          />
        )}
      </div>
    );
  }

  if (kind === "checklist") {
    return (
      <Select value={(value.kind as string) ?? ""} onValueChange={(v) => onChange({ kind: v })}>
        <SelectTrigger aria-label="Which checklist">
          <SelectValue placeholder="Any checklist" />
        </SelectTrigger>
        <SelectContent>
          {CHECKLISTS.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select
      value={(value.templateId as string) ?? ""}
      onValueChange={(v) => onChange({ templateId: v })}
    >
      <SelectTrigger aria-label="Which document">
        <SelectValue placeholder="Any document" />
      </SelectTrigger>
      <SelectContent>
        {props.templates.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActionRow(
  props: Props & {
    index: number;
    value: Cfg;
    onChange: (v: Cfg) => void;
    onRemove: () => void;
    onMoveUp?: () => void;
  }
) {
  const { value, onChange, index } = props;
  const def = ACTION_DEFS.find((a) => a.value === value.type);
  const n = index + 1;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={props.onMoveUp}
        disabled={!props.onMoveUp}
        aria-label={`Move action ${n} earlier`}
      >
        <ChevronUp className="size-4" />
      </Button>

      <Select value={String(value.type ?? "")} onValueChange={(v) => onChange({ type: v })}>
        <SelectTrigger className="min-w-56 flex-1" aria-label={`Action ${n}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_DEFS.map((a) => (
            <SelectItem key={a.value} value={a.value}>
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(def?.config === "template" || def?.config === "template_signer") && (
        <Select
          value={(value.templateId as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, templateId: v })}
        >
          <SelectTrigger className="min-w-48" aria-label={`Action ${n} which document`}>
            <SelectValue placeholder="Which document" />
          </SelectTrigger>
          <SelectContent>
            {props.templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "template_signer" && (
        <Select
          value={(value.signer as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, signer: v })}
        >
          <SelectTrigger className="min-w-40" aria-label={`Action ${n} who signs`}>
            <SelectValue placeholder="Who signs" />
          </SelectTrigger>
          <SelectContent>
            {SIGNERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "stage" && (
        <Select
          value={(value.stageId as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, stageId: v })}
        >
          <SelectTrigger className="min-w-48" aria-label={`Action ${n} which stage`}>
            <SelectValue placeholder="Which stage" />
          </SelectTrigger>
          <SelectContent>
            {props.stages.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "project_status" && (
        <Select
          value={(value.status as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, status: v })}
        >
          <SelectTrigger className="min-w-44" aria-label={`Action ${n} which status`}>
            <SelectValue placeholder="Which status" />
          </SelectTrigger>
          <SelectContent>
            {props.statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {def?.config === "checklist" && (
        <Select
          value={(value.kind as string) ?? ""}
          onValueChange={(v) => onChange({ ...value, kind: v })}
        >
          <SelectTrigger className="min-w-44" aria-label={`Action ${n} which photos`}>
            <SelectValue placeholder="Which photos" />
          </SelectTrigger>
          <SelectContent>
            {CHECKLISTS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={props.onRemove}
        aria-label={`Remove action ${n}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// --- Starter set -----------------------------------------------------------

function StarterAutomationsButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function seed() {
    setBusy(true);
    try {
      const res = await createStarterAutomationsAction();
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(
          res.created === 0 ? "You already have all of them." : `Added ${res.created}.`
        );
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={seed} disabled={busy}>
      {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
      Start from the standard set
    </Button>
  );
}

// --- Runs ------------------------------------------------------------------

/**
 * The only place a silent automation becomes visible to a human, which is why
 * every step's outcome is shown rather than a bare pass/fail.
 */
function RunsPanel({ runs }: { runs: Run[] }) {
  const failures = runs.filter((r) => r.status === "failed").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Recent runs</h2>
        {failures > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            {failures} failed
          </span>
        )}
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {runs.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nothing has run yet. This is where an automation that fails shows up.
          </p>
        )}
        {runs.map((run) => (
          <div key={run.id} className="flex gap-3 px-5 py-3">
            <span className="mt-0.5 shrink-0">
              {run.status === "succeeded" && (
                <CheckCircle2 className="size-4 text-emerald-600" aria-label="Succeeded" />
              )}
              {run.status === "failed" && (
                <XCircle className="size-4 text-red-600" aria-label="Failed" />
              )}
              {run.status === "skipped" && (
                <MinusCircle className="size-4 text-muted-foreground" aria-label="Skipped" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{run.ruleName}</span>
                {run.lead && (
                  <Link
                    href={`/portal/leads/${run.lead.id}`}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    {run.lead.name}
                  </Link>
                )}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {run.steps.map((s, i) => (
                  <li
                    key={i}
                    className={
                      s.ok
                        ? "text-xs text-muted-foreground"
                        : "text-xs text-red-600 dark:text-red-400"
                    }
                  >
                    {actionLabel(s.type)} — {s.detail}
                  </li>
                ))}
              </ul>
              {run.error && run.steps.length === 0 && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{run.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
