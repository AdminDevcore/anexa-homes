"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  ChevronUp,
  Loader2,
  MinusCircle,
  MoreHorizontal,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Caution,
  ItemRail,
  Panel,
  PanelEmpty,
  Pill,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
  SaveBar,
  SelectField,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
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
  initialRuleId?: string | null;
  initialTab?: string | null;
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

/** The rail's one non-rule row: everything that has run lately, across rules. */
const RUNS = "__runs";
/** A rule being written, which does not exist until it is saved. */
const NEW = "__new";

/**
 * Automations, one rule at a time.
 *
 * A rule used to be a row in a list with an Edit button that opened a dialog —
 * so the thing with the most consequences on this screen (an ordered list of
 * actions that fire on somebody's deal without anybody choosing them) was
 * written inside a 42rem modal, and what it actually did was compressed into
 * one grey sentence underneath the row.
 *
 * Rail and panel: the rules on the left with that sentence as their subtitle,
 * the whole rule on the right, and its own recent runs on a tab beside it —
 * because "did it work?" is the question you have straight after writing one.
 */
export function AutomationRulesManager(props: Props) {
  const { rules, runs, initialRuleId, initialTab } = props;

  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialRuleId ?? rules.find((r) => r.active)?.id ?? rules[0]?.id ?? null
  );
  const [tab, setTab] = React.useState<string>(() => initialTab ?? "rule");
  const [query, setQuery] = React.useState("");

  const selected =
    selectedId === RUNS || selectedId === NEW
      ? selectedId
      : (rules.find((r) => r.id === selectedId)?.id ??
        rules.find((r) => r.active)?.id ??
        rules[0]?.id ??
        null);
  const rule = rules.find((r) => r.id === selected) ?? null;

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selected && selected !== NEW) p.set("rule", selected);
    else p.delete("rule");
    p.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [selected, tab]);

  const q = query.trim().toLowerCase();
  const shown = rules.filter((r) => q === "" || r.name.toLowerCase().includes(q));
  const live = shown.filter((r) => r.active);
  const off = shown.filter((r) => !r.active);
  const failures = runs.filter((r) => r.status === "failed").length;

  const railRow = (r: Rule) => (
    <RailRow
      key={r.id}
      title={r.name}
      subtitle={sentence(r, props)}
      mark={
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
          <Zap className="size-3.5" />
        </span>
      }
      selected={r.id === selected}
      onSelect={() => setSelectedId(r.id)}
      needsWork={r.actions.length === 0}
      muted={!r.active}
    />
  );

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Automations"
          add={
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                setSelectedId(NEW);
                setTab("rule");
              }}
            >
              <Plus className="size-4" /> New automation
            </Button>
          }
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Find an automation"
          showSearch={rules.length > 6}
        >
          {selected === NEW && (
            <RailRow
              title="New automation"
              subtitle="not saved yet"
              mark={
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
                  <Plus className="size-3.5" />
                </span>
              }
              selected
              onSelect={() => setSelectedId(NEW)}
            />
          )}

          {live.map(railRow)}

          {off.length > 0 && (
            <>
              <RailGroup>Switched off ({off.length})</RailGroup>
              {off.map(railRow)}
            </>
          )}

          {rules.length > 0 && shown.length === 0 && <RailNoMatch query={query} />}

          <RailGroup>Activity</RailGroup>
          <RailRow
            title="Recent runs"
            subtitle={
              runs.length === 0
                ? "nothing has run yet"
                : `${runs.length} recent · ${failures} failed`
            }
            mark={
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Activity className="size-3.5" />
              </span>
            }
            selected={selected === RUNS}
            onSelect={() => setSelectedId(RUNS)}
            needsWork={failures > 0}
          />
        </ItemRail>
      }
    >
      {selected === RUNS ? (
        <RunsPanel runs={runs} />
      ) : selected === NEW || rule ? (
        <RulePanel
          // Keyed so switching rules remounts the panel: the draft belongs to
          // the rule it was seeded from.
          key={rule?.id ?? NEW}
          rule={rule}
          {...props}
          tab={tab}
          onTabChange={setTab}
          onSaved={(id) => setSelectedId(id)}
          onDeleted={() => setSelectedId(null)}
        />
      ) : (
        <EmptyAutomations onCreated={setSelectedId} />
      )}
    </RailLayout>
  );
}

/** Nothing set up: the standard set, or a blank rule. */
function EmptyAutomations({ onCreated }: { onCreated: (id: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function seed() {
    setBusy(true);
    try {
      const res = await createStarterAutomationsAction();
      if (!res.ok) return toast.error(res.error);
      toast.success(res.created === 0 ? "You already have all of them." : `Added ${res.created}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Zap className="size-6" />
      </span>
      <h3 className="mt-3 font-medium">No automations yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Nothing happens on its own in this workspace. Rules do not carry across workspaces, so a
        second one starts empty even when the first is full.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={seed} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Start from the standard set
        </Button>
        <Button size="sm" onClick={() => onCreated(NEW)}>
          <Plus className="size-4" /> Write one
        </Button>
      </div>
    </div>
  );
}

/**
 * One rule: when it fires, what it does, and how it has been getting on.
 *
 * `rule` is null while a new one is being written — it does not exist until the
 * Save at the bottom creates it, which is the same Save that edits an existing
 * one. A rule with no actions cannot be stored, so there is nothing to create
 * halfway.
 */
function RulePanel({
  rule,
  stages,
  templates,
  statuses,
  runs,
  tab,
  onTabChange,
  onSaved,
  onDeleted,
}: Props & {
  rule: Rule | null;
  tab: string;
  onTabChange: (t: string) => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const props = { rules: [], stages, templates, statuses, runs };
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(
    () => ({
      name: rule?.name ?? "",
      trigger: rule?.trigger ?? "stage_entered",
      conditions: rule?.conditions ?? {},
      actions: rule?.actions ?? [],
      once: rule?.once ?? true,
    }),
    [rule]
  );

  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([rule?.id ?? NEW, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const def = TRIGGER_DEFS.find((t) => t.value === draft.trigger);
  const mine = rule ? runs.filter((r) => r.ruleName === rule.name) : [];

  const noActions = draft.actions.length === 0;
  const noName = draft.name.trim() === "";

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.");
        return res;
      }
      toast.success(okMsg);
      router.refresh();
      return res;
    } finally {
      // ALWAYS in a finally. A busy flag left true by a thrown action is a panel
      // whose controls never come back to life.
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const input = {
        name: draft.name.trim(),
        trigger: draft.trigger as never,
        conditions: draft.conditions,
        actions: draft.actions,
        once: draft.once,
        active: rule?.active ?? true,
      };
      if (rule) {
        const res = await updateAutomationRuleAction(rule.id, input);
        if (!res.ok) return toast.error(res.error);
      } else {
        const res = await createAutomationRuleAction(input);
        if (!res.ok) return toast.error(res.error);
        onSaved(res.id);
      }
      toast.success(rule ? `${input.name} saved` : `${input.name} created`);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="automation-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
          <Zap className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {rule?.name || draft.name.trim() || "New automation"}
            </h2>
            {rule && !rule.active && <Pill>Off</Pill>}
            {!rule && <Pill tone="warn">Not saved</Pill>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {rule
              ? sentence(rule, { ...props, rules: [] })
              : "When a deal does something, do the paperwork."}
          </p>
        </div>

        {rule && (
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={rule.active}
              disabled={busy}
              aria-label={`${rule.name} active`}
              onCheckedChange={(v) =>
                void act(
                  () => toggleAutomationRuleAction(rule.id, v),
                  v ? "Switched on" : "Switched off"
                )
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`More for ${rule.name}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    const res = await act(
                      () => deleteAutomationRuleAction(rule.id),
                      "Automation deleted."
                    );
                    if (res.ok) onDeleted();
                  }}
                >
                  <Trash2 className="size-4" /> Delete {rule.name}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <Tabs value={tab} onValueChange={onTabChange} className="mt-4 gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="rule">Rule</TabsTrigger>
          <TabsTrigger value="runs" disabled={!rule}>
            Runs
            {mine.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">{mine.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rule" className="space-y-4">
          <Panel title="Name">
            <TextField
              label="What this automation is called"
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="Installed paperwork"
              id="rule-name"
              hint="Only your team sees it. It is what a failed run is reported under."
            />
          </Panel>

          <Panel title="When" description={def?.blurb ? `Fires when a deal ${def.blurb}.` : undefined}>
            <SelectField
              label="Trigger"
              value={draft.trigger}
              onChange={(v) =>
                // A stage id means nothing to a document trigger. Clearing the
                // conditions is what stops a stale one silently matching
                // everything after an edit.
                setDraft((d) => ({ ...d, trigger: v, conditions: {} }))
              }
              options={TRIGGER_DEFS.map((t) => ({ value: t.value, label: t.label }))}
            />
            <ConditionControl
              kind={def?.condition ?? "stage"}
              value={draft.conditions}
              onChange={(v) => setDraft((d) => ({ ...d, conditions: v }))}
              {...props}
            />
          </Panel>

          <Panel
            title="Then, in order"
            description="They run top to bottom and stop at the first one that fails."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    actions: [...d.actions, { type: "generate_document" }],
                  }))
                }
              >
                <Plus className="size-4" /> Add action
              </Button>
            }
          >
            {noActions ? (
              <PanelEmpty>
                No actions yet — a rule needs at least one, and cannot be saved without it.
              </PanelEmpty>
            ) : (
              draft.actions.map((a, i) => (
                <ActionRow
                  key={i}
                  index={i}
                  value={a}
                  onChange={(next) =>
                    setDraft((d) => ({
                      ...d,
                      actions: d.actions.map((x, j) => (j === i ? next : x)),
                    }))
                  }
                  onRemove={() =>
                    setDraft((d) => ({ ...d, actions: d.actions.filter((_, j) => j !== i) }))
                  }
                  onMoveUp={
                    i === 0
                      ? undefined
                      : () =>
                          setDraft((d) => {
                            const next = [...d.actions];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            return { ...d, actions: next };
                          })
                  }
                  {...props}
                />
              ))
            )}
          </Panel>

          <Panel title="How often">
            <ToggleRow
              label="Run at most once per deal"
              description="Off means it runs every time the trigger matches — every stage move back into the same stage, every time a checklist is completed again."
              checked={draft.once}
              onChange={(v) => setDraft((d) => ({ ...d, once: v }))}
            />
            {!draft.once && (
              <Caution>
                This will fire more than once on the same deal. On a rule that generates a document
                or sends one for signature, that is a second copy each time.
              </Caution>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          {mine.length === 0 ? (
            <PanelEmpty>
              This rule has not run yet. When it does — and especially when it fails — it shows up
              here and under Recent runs.
            </PanelEmpty>
          ) : (
            <RunList runs={mine} />
          )}
        </TabsContent>
      </Tabs>

      <SaveBar
        dirty={dirty || !rule}
        busy={busy}
        what={draft.name.trim() || "this automation"}
        saveLabel={rule ? "Save changes" : "Create automation"}
        onSave={save}
        onDiscard={() => setDraft(seed())}
        disabled={noName || noActions}
        blockedReason={
          noName
            ? "Give the automation a name before saving."
            : noActions
              ? "A rule needs at least one action before it can be saved."
              : undefined
        }
      />
    </div>
  );
}

/** "When a deal lands in a pipeline stage (Installed) → generate …, move to …" */
function sentence(rule: Rule, props: Omit<Props, "initialRuleId" | "initialTab">): string {
  const def = TRIGGER_DEFS.find((t) => t.value === rule.trigger);
  const where = conditionLabel(rule, props);
  const what = rule.actions.map((a) => actionSummary(a, props)).join(", ");
  return `When a deal ${def?.blurb ?? triggerLabel(rule.trigger)}${where} → ${what || "nothing yet"}`;
}

function conditionLabel(rule: Rule, props: Omit<Props, "initialRuleId" | "initialTab">): string {
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

function actionSummary(a: Cfg, props: Omit<Props, "initialRuleId" | "initialTab">): string {
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

function ConditionControl(
  props: Omit<Props, "initialRuleId" | "initialTab"> & {
    kind: string;
    value: Cfg;
    onChange: (v: Cfg) => void;
  }
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
  props: Omit<Props, "initialRuleId" | "initialTab"> & {
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2">
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

/**
 * The only place a silent automation becomes visible to a human, which is why
 * every step's outcome is shown rather than a bare pass/fail.
 */
function RunsPanel({ runs }: { runs: Run[] }) {
  const failures = runs.filter((r) => r.status === "failed").length;

  return (
    <div className="min-w-0" data-testid="runs-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Activity className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">Recent runs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every automation runs without anybody watching. This is where one that fails says so.
          </p>
          {failures > 0 && (
            <div className="mt-2">
              <Pill tone="warn">{failures} failed</Pill>
            </div>
          )}
        </div>
      </header>

      <div className="mt-4">
        {runs.length === 0 ? (
          <PanelEmpty>
            Nothing has run yet. This is where an automation that fails shows up.
          </PanelEmpty>
        ) : (
          <RunList runs={runs} />
        )}
      </div>
    </div>
  );
}

function RunList({ runs }: { runs: Run[] }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {runs.map((run) => (
        <div key={run.id} className="flex gap-3 px-4 py-3">
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
  );
}
