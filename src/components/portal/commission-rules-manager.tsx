"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DollarSign, MoreHorizontal, Plus, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChoiceCards,
  Hint,
  ItemRail,
  MoneyField,
  Panel,
  Pill,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
  SaveBar,
  SelectField,
  TextField,
} from "@/components/portal/settings-kit";
import {
  createCommissionRuleAction,
  updateCommissionRuleAction,
  deleteCommissionRuleAction,
  toggleCommissionRuleAction,
} from "@/server/modules/payroll/actions";
import { setOverheadPctAction, setPaFeePctAction } from "@/server/modules/costs/actions";
import { useFormat } from "@/components/portal/branding-provider";

type Rule = {
  id: string;
  name: string;
  role: string;
  type: string;
  percent: number;
  flatAmount: number;
  projectType: string | null;
  active: boolean;
};

// Commission rule categories (NOT user roles). "project_manager" pays the
// project's assigned manager (Project.managerId).
const RULE_ROLES = ["sales_rep", "manager", "project_manager", "installer"] as const;
const RULE_ROLE_LABELS: Record<string, string> = {
  sales_rep: "Sales Rep",
  manager: "Manager",
  project_manager: "Project Manager",
  installer: "Installer / Crew",
};
const ruleRoleLabel = (r: string) => RULE_ROLE_LABELS[r] ?? r;

const TYPES = [
  {
    value: "percentage",
    label: "Percentage",
    detail: "A share of the contract value.",
  },
  {
    value: "flat",
    label: "Flat amount",
    detail: "The same money on every job it matches.",
  },
  {
    value: "job_cost",
    label: "Job-cost %",
    detail: "A share of what the job cost to build, not what it sold for.",
  },
];

/** The rail's non-rule row: the percentages every margin split is worked out from. */
const SPLIT = "__split";
/** A rule being written, which does not exist until it is saved. */
const NEW = "__new";

type Props = {
  rules: Rule[];
  overheadPct: number;
  paFeePct: number;
  initialRuleId?: string | null;
};

/**
 * How the company pays out on a job.
 *
 * Two things used to sit stacked on this page: a card of margin-split
 * percentages with a Save button per box, and a list of rules whose rows read
 * "Sales Rep · percentage · 10%" with a pencil that opened the whole rule in a
 * dialog. Rail and panel, one Save each — and the split percentages are a rail
 * row rather than a card on top, because they answer the same question on a
 * different scale.
 */
export function CommissionRulesManager({ rules, overheadPct, paFeePct, initialRuleId }: Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialRuleId ?? rules[0]?.id ?? SPLIT
  );
  const [query, setQuery] = React.useState("");

  const selected =
    selectedId === SPLIT || selectedId === NEW
      ? selectedId
      : (rules.find((r) => r.id === selectedId)?.id ?? rules[0]?.id ?? SPLIT);
  const rule = rules.find((r) => r.id === selected) ?? null;

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selected && selected !== NEW && selected !== SPLIT) p.set("rule", selected);
    else p.delete("rule");
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [selected]);

  const q = query.trim().toLowerCase();
  const shown = rules.filter((r) => q === "" || r.name.toLowerCase().includes(q));
  const live = shown.filter((r) => r.active);
  const off = shown.filter((r) => !r.active);

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Commission rules"
          add={
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setSelectedId(NEW)}
            >
              <Plus className="size-4" /> New rule
            </Button>
          }
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Find a rule"
          showSearch={rules.length > 6}
        >
          {selected === NEW && (
            <RailRow
              title="New rule"
              subtitle="not saved yet"
              mark={<RuleMark />}
              selected
              onSelect={() => setSelectedId(NEW)}
            />
          )}

          {live.map((r) => (
            <RuleRailRow
              key={r.id}
              rule={r}
              selected={r.id === selected}
              onSelect={() => setSelectedId(r.id)}
            />
          ))}

          {off.length > 0 && (
            <>
              <RailGroup>Switched off ({off.length})</RailGroup>
              {off.map((r) => (
                <RuleRailRow
                  key={r.id}
                  rule={r}
                  selected={r.id === selected}
                  onSelect={() => setSelectedId(r.id)}
                />
              ))}
            </>
          )}

          {rules.length > 0 && shown.length === 0 && <RailNoMatch query={query} />}

          <RailGroup>Company</RailGroup>
          <RailRow
            title="Margin split"
            subtitle={`${overheadPct}% overhead · ${paFeePct}% PA fee`}
            mark={
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Scale className="size-3.5" />
              </span>
            }
            selected={selected === SPLIT}
            onSelect={() => setSelectedId(SPLIT)}
          />
        </ItemRail>
      }
    >
      {selected === SPLIT ? (
        <SplitPanel overheadPct={overheadPct} paFeePct={paFeePct} />
      ) : (
        <RulePanel
          key={rule?.id ?? NEW}
          rule={rule}
          onSaved={setSelectedId}
          onDeleted={() => setSelectedId(SPLIT)}
        />
      )}
    </RailLayout>
  );
}

function RuleMark() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
      <DollarSign className="size-3.5" />
    </span>
  );
}

function RuleRailRow({
  rule,
  selected,
  onSelect,
}: {
  rule: Rule;
  selected: boolean;
  onSelect: () => void;
}) {
  const fmt = useFormat();
  const value = rule.type === "flat" ? fmt.money(rule.flatAmount) : `${rule.percent}%`;
  return (
    <RailRow
      title={rule.name}
      subtitle={`${ruleRoleLabel(rule.role)} · ${value}${rule.projectType ? ` · ${rule.projectType}` : ""}`}
      mark={<RuleMark />}
      selected={selected}
      onSelect={onSelect}
      muted={!rule.active}
    />
  );
}

/** One rule: who it pays, how much, and on which jobs. */
function RulePanel({
  rule,
  onSaved,
  onDeleted,
}: {
  rule: Rule | null;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(
    () => ({
      name: rule?.name ?? "",
      role: rule?.role ?? "sales_rep",
      type: rule?.type ?? "percentage",
      percent: rule ? String(rule.percent) : "10",
      flat: rule ? String(rule.flatAmount / 100) : "0",
      projectType: rule?.projectType ?? "",
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
  const set = <K extends keyof ReturnType<typeof seed>>(
    k: K,
    v: ReturnType<typeof seed>[K]
  ) => setDraft((d) => ({ ...d, [k]: v }));

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
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name: draft.name.trim(),
        role: draft.role as "sales_rep" | "manager" | "project_manager" | "installer",
        type: draft.type as "percentage" | "flat" | "job_cost",
        percent: Number(draft.percent) || 0,
        flatAmount: Math.round((Number(draft.flat) || 0) * 100),
        projectType: draft.projectType.trim(),
      };
      if (rule) {
        const res = await updateCommissionRuleAction(rule.id, payload);
        if (!res.ok) return toast.error(res.error);
      } else {
        const res = await createCommissionRuleAction(payload);
        if (!res.ok) return toast.error(res.error);
        onSaved(res.id);
      }
      toast.success(rule ? `${payload.name} saved` : `${payload.name} created`);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="commission-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
          <DollarSign className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {rule?.name || draft.name.trim() || "New rule"}
            </h2>
            {rule && !rule.active && <Pill>Off</Pill>}
            {!rule && <Pill tone="warn">Not saved</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill>{ruleRoleLabel(draft.role)}</Pill>
            <Pill tone="gold">
              {draft.type === "flat" ? `$${draft.flat || 0}` : `${draft.percent || 0}%`}
            </Pill>
            <Pill>{draft.projectType.trim() || "every project type"}</Pill>
          </div>
        </div>

        {rule && (
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={rule.active}
              disabled={busy}
              aria-label={`${rule.name} active`}
              onCheckedChange={(v) =>
                void act(
                  () => toggleCommissionRuleAction(rule.id, v),
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
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    const res = await act(
                      () => deleteCommissionRuleAction(rule.id),
                      "Rule deleted"
                    );
                    if (res.ok) onDeleted();
                  }}
                >
                  <Trash2 className="size-4" /> Delete — commission already paid out is untouched
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <div className="mt-4 space-y-4">
        <Panel title="Name">
          <TextField
            label="What this rule is called"
            value={draft.name}
            onChange={(v) => set("name", v)}
            placeholder="Sales Rep — 10%"
            hint="It appears on the payroll line this rule writes, so name it the way you would explain it."
          />
        </Panel>

        <Panel
          title="Who it pays"
          description="A rule category, not a portal role: “Project Manager” pays the manager assigned to the project."
        >
          <SelectField
            label="Applies to"
            value={draft.role}
            onChange={(v) => set("role", v)}
            options={RULE_ROLES.map((r) => ({ value: r, label: ruleRoleLabel(r) }))}
          />
        </Panel>

        <Panel title="How much">
          <ChoiceCards
            name="commission-type"
            legend="Worked out as"
            value={draft.type}
            onChange={(v) => set("type", v)}
            columns={3}
            options={TYPES}
          />
          {draft.type === "flat" ? (
            <MoneyField
              label="Flat amount"
              value={draft.flat}
              onChange={(v) => set("flat", v)}
            />
          ) : (
            <TextField
              label="Percent"
              type="number"
              value={draft.percent}
              onChange={(v) => set("percent", v)}
              hint={
                draft.type === "job_cost"
                  ? "Of what the job cost to build, not what it sold for."
                  : "Of the contract value."
              }
            />
          )}
        </Panel>

        <Panel title="Which jobs">
          <TextField
            label="Project type filter"
            value={draft.projectType}
            onChange={(v) => set("projectType", v)}
            placeholder="e.g. Shingle"
            hint="Left blank, the rule applies to every project type. Typed, it has to match exactly."
          />
        </Panel>
      </div>

      <SaveBar
        dirty={dirty || !rule}
        busy={busy}
        what={draft.name.trim() || "this rule"}
        saveLabel={rule ? "Save changes" : "Create rule"}
        onSave={save}
        onDiscard={() => setDraft(seed())}
        disabled={draft.name.trim() === ""}
        blockedReason={draft.name.trim() === "" ? "Give the rule a name before saving." : undefined}
      />
    </div>
  );
}

/**
 * The two percentages every margin split comes off.
 *
 * Each box used to carry a Save button of its own, so a screen where one had
 * been pressed and the other had not looked exactly like a saved one.
 */
function SplitPanel({ overheadPct, paFeePct }: { overheadPct: number; paFeePct: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const saved = React.useMemo(
    () => ({ overhead: String(overheadPct), pa: String(paFeePct) }),
    [overheadPct, paFeePct]
  );
  const [draft, setDraft] = React.useState(saved);

  const serverKey = JSON.stringify(saved);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== serverKey;

  async function save() {
    setBusy(true);
    try {
      if (draft.overhead !== saved.overhead) {
        const res = await setOverheadPctAction(parseFloat(draft.overhead));
        if (!res.ok) return toast.error(res.error);
      }
      if (draft.pa !== saved.pa) {
        const res = await setPaFeePctAction(parseFloat(draft.pa));
        if (!res.ok) return toast.error(res.error);
      }
      toast.success("Margin split saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="split-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Scale className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">Margin split</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For each deal: contract − job cost − company overhead − PA fee on supplements = the
            profit pool, split between the company and the rep by that rep&rsquo;s own percentage.
          </p>
        </div>
      </header>

      <div className="mt-4 space-y-4">
        <Panel title="What comes off before the split">
          <TextField
            label="Company overhead (% of contract)"
            type="number"
            value={draft.overhead}
            onChange={(v) => setDraft((d) => ({ ...d, overhead: v }))}
          />
          <TextField
            label="Public-adjuster fee (% of supplement)"
            type="number"
            value={draft.pa}
            onChange={(v) => setDraft((d) => ({ ...d, pa: v }))}
            hint="Charged only against supplement money, not the original contract."
          />
          <Hint>
            Each rep&rsquo;s own split percentage is set on their profile under{" "}
            <Link href="/portal/team" className="underline underline-offset-2">
              Team
            </Link>
            . A rep with none written down earns nothing from the pool, silently.
          </Hint>
        </Panel>
      </div>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="the margin split"
        onSave={save}
        onDiscard={() => setDraft(saved)}
      />
    </div>
  );
}
