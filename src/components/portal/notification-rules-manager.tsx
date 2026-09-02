"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, CalendarClock, Mail, MessageSquare, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Caution,
  Hint,
  ItemRail,
  Panel,
  Pill,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
  SaveBar,
  SelectField,
  TextAreaField,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import {
  createNotificationRuleAction,
  updateNotificationRuleAction,
  toggleNotificationRuleAction,
  deleteNotificationRuleAction,
  type RuleInput,
} from "@/server/modules/notifications/actions";
import {
  setEmailSignedCopyToSignersAction,
  setOverdueDigestAction,
  setWeeklyTaskRemindersAction,
} from "@/server/modules/settings/actions";
import { EVENT_DEFS, DYNAMIC_TARGETS, eventLabel } from "@/server/modules/notifications/types";
import { StarterRulesButton } from "./starter-rules-button";

type Option = { id: string; name: string };
type RoleOption = { value: string; label: string };
type Rule = {
  id: string;
  name: string;
  event: string;
  conditions: { stageId?: string; status?: string };
  recipients: { roles?: string[]; userIds?: string[]; dynamic?: string[] };
  channels: string[];
  titleTemplate: string;
  bodyTemplate: string;
  active: boolean;
};

type Schedules = {
  weeklyTaskReminders: boolean;
  overdueDigest: boolean;
  emailSignedCopyToSigners: boolean;
};

const CHANNELS = [
  { value: "in_app", label: "In-app", icon: Bell },
  { value: "email", label: "Email", icon: Mail },
  { value: "sms", label: "SMS", icon: MessageSquare },
];

/** The rail's non-rule row: the digests nothing on a deal sets off. */
const SCHEDULED = "__scheduled";
/** A rule being written, which does not exist until it is saved. */
const NEW = "__new";

type Props = {
  rules: Rule[];
  stages: Option[];
  statuses: string[];
  users: Option[];
  roles: RoleOption[];
  schedules: Schedules;
  initialRuleId?: string | null;
};

/**
 * Who hears about what, one rule at a time.
 *
 * This screen used to be three stacked cards and a list: two digest switches
 * that saved themselves, a third for signed copies, and every event rule
 * compressed into a row reading "Contract signed · in_app, email" with a pencil
 * that opened all of it inside a 32rem dialog — recipients, channels and the
 * message template, in a box you had to scroll.
 *
 * Rail and panel. The rule you are writing gets the window, and the scheduled
 * digests are one more row in the rail rather than a card above the list, since
 * they are the same question asked on a timer.
 */
export function NotificationRulesManager(props: Props) {
  const { rules, initialRuleId } = props;

  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialRuleId ?? rules.find((r) => r.active)?.id ?? rules[0]?.id ?? SCHEDULED
  );
  const [query, setQuery] = React.useState("");

  const selected =
    selectedId === SCHEDULED || selectedId === NEW
      ? selectedId
      : (rules.find((r) => r.id === selectedId)?.id ?? rules[0]?.id ?? SCHEDULED);
  const rule = rules.find((r) => r.id === selected) ?? null;

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selected && selected !== NEW && selected !== SCHEDULED) p.set("rule", selected);
    else p.delete("rule");
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [selected]);

  const q = query.trim().toLowerCase();
  const shown = rules.filter((r) => q === "" || r.name.toLowerCase().includes(q));
  const live = shown.filter((r) => r.active);
  const off = shown.filter((r) => !r.active);

  const railRow = (r: Rule) => (
    <RailRow
      key={r.id}
      title={r.name}
      subtitle={`${eventLabel(r.event as never)} · ${r.channels.map(channelLabel).join(", ")}`}
      mark={
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
          <Bell className="size-3.5" />
        </span>
      }
      selected={r.id === selected}
      onSelect={() => setSelectedId(r.id)}
      muted={!r.active}
    />
  );

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Notification rules"
          add={
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setSelectedId(NEW)}
              >
                <Plus className="size-4" /> New rule
              </Button>
              <StarterRulesButton hasRules={rules.length > 0} />
            </div>
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

          <RailGroup>On a timer</RailGroup>
          <RailRow
            title="Digests & delivery"
            subtitle="Weekly rollups, and what a signer is sent"
            mark={
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <CalendarClock className="size-3.5" />
              </span>
            }
            selected={selected === SCHEDULED}
            onSelect={() => setSelectedId(SCHEDULED)}
          />
        </ItemRail>
      }
    >
      {selected === SCHEDULED ? (
        <SchedulesPanel schedules={props.schedules} />
      ) : (
        <RulePanel
          key={rule?.id ?? NEW}
          rule={rule}
          {...props}
          onSaved={setSelectedId}
          onDeleted={() => setSelectedId(SCHEDULED)}
        />
      )}
    </RailLayout>
  );
}

const channelLabel = (v: string) => CHANNELS.find((c) => c.value === v)?.label ?? v;

/**
 * One rule: what sets it off, who hears about it, and what they read.
 *
 * `rule` is null while a new one is being written — it does not exist until the
 * Save at the bottom creates it, which is the same Save that edits an existing
 * one.
 */
function RulePanel({
  rule,
  stages,
  statuses,
  users,
  roles,
  onSaved,
  onDeleted,
}: Props & { rule: Rule | null; onSaved: (id: string) => void; onDeleted: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(() => {
    const def = EVENT_DEFS.find((e) => e.value === (rule?.event ?? "stage_changed"));
    return {
      name: rule?.name ?? "",
      event: rule?.event ?? "stage_changed",
      stageId: rule?.conditions?.stageId ?? "",
      status: rule?.conditions?.status ?? "",
      roles: rule?.recipients?.roles ?? [],
      dynamic: rule?.recipients?.dynamic ?? [],
      userIds: rule?.recipients?.userIds ?? [],
      channels: rule?.channels ?? ["in_app"],
      title: rule?.titleTemplate ?? def?.defaultTitle ?? "",
      body: rule?.bodyTemplate ?? def?.defaultBody ?? "",
    };
  }, [rule]);

  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([rule?.id ?? NEW, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const def = EVENT_DEFS.find((e) => e.value === draft.event);
  const recipients = draft.roles.length + draft.dynamic.length + draft.userIds.length;

  const blocked =
    draft.name.trim() === "" || draft.channels.length === 0 || recipients === 0;

  function toggleIn(key: "roles" | "dynamic" | "userIds" | "channels", value: string) {
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((x) => x !== value) : [...d[key], value],
    }));
  }

  /**
   * Changing the trigger reseeds the message.
   *
   * Only on a NEW rule: on an existing one it would throw away wording somebody
   * has written. The condition is always cleared — a stage id means nothing to a
   * status event, and a stale one silently matches everything.
   */
  function pickEvent(v: string) {
    const d = EVENT_DEFS.find((e) => e.value === v);
    setDraft((prev) => ({
      ...prev,
      event: v,
      stageId: "",
      status: "",
      title: rule ? prev.title : (d?.defaultTitle ?? prev.title),
      body: rule ? prev.body : (d?.defaultBody ?? prev.body),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const payload: RuleInput = {
        name: draft.name.trim(),
        event: draft.event as RuleInput["event"],
        conditions: {
          ...(def?.condition === "stage" && draft.stageId ? { stageId: draft.stageId } : {}),
          ...(def?.condition === "status" && draft.status ? { status: draft.status } : {}),
        },
        recipients: { roles: draft.roles, userIds: draft.userIds, dynamic: draft.dynamic },
        channels: draft.channels as RuleInput["channels"],
        titleTemplate: draft.title,
        bodyTemplate: draft.body,
        active: rule?.active ?? true,
      };
      if (rule) {
        const res = await updateNotificationRuleAction(rule.id, payload);
        if (!res.ok) return toast.error(res.error);
      } else {
        const res = await createNotificationRuleAction(payload);
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

  return (
    <div className="min-w-0" data-testid="notification-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
          <Bell className="size-5" />
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
            <Pill>{eventLabel(draft.event as never)}</Pill>
            {draft.channels.map((c) => (
              <Pill key={c} tone="gold">
                {channelLabel(c)}
              </Pill>
            ))}
            <Pill tone={recipients === 0 ? "warn" : "plain"}>
              {recipients === 0 ? "nobody" : `${recipients} recipients`}
            </Pill>
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
                  () => toggleNotificationRuleAction(rule.id, v),
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
                      () => deleteNotificationRuleAction(rule.id),
                      "Rule deleted"
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

      <div className="mt-4 space-y-4">
        <Panel title="Name">
          <TextField
            label="What this rule is called"
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            placeholder="Notify managers when a contract is signed"
            hint="Only your team sees it."
          />
        </Panel>

        <Panel title="When">
          <SelectField
            label="Trigger"
            value={draft.event}
            onChange={pickEvent}
            options={EVENT_DEFS.map((e) => ({ value: e.value, label: e.label }))}
          />
          {def?.condition === "stage" && (
            <SelectField
              label="Only for one stage"
              value={draft.stageId || "any"}
              onChange={(v) => setDraft((d) => ({ ...d, stageId: v === "any" ? "" : v }))}
              options={[
                { value: "any", label: "Any stage" },
                ...stages.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}
          {def?.condition === "status" && (
            <SelectField
              label="Only for one status"
              value={draft.status || "any"}
              onChange={(v) => setDraft((d) => ({ ...d, status: v === "any" ? "" : v }))}
              options={[
                { value: "any", label: "Any status" },
                ...statuses.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
              ]}
            />
          )}
        </Panel>

        <Panel
          title="Who hears about it"
          description="All three lists add together. A person named twice is still notified once."
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Relative to the event</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {DYNAMIC_TARGETS.map((t) => (
                  <CheckRow
                    key={t.value}
                    checked={draft.dynamic.includes(t.value)}
                    onToggle={() => toggleIn("dynamic", t.value)}
                    label={t.label}
                  />
                ))}
              </div>
              <Hint>
                Works out who to tell from the deal itself — the rep it is assigned to, the manager
                over them — so it keeps up as people change.
              </Hint>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">By role</p>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {roles.map((r) => (
                  <CheckRow
                    key={r.value}
                    checked={draft.roles.includes(r.value)}
                    onToggle={() => toggleIn("roles", r.value)}
                    label={r.label}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">Specific people</p>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-3">
                {users.map((u) => (
                  <CheckRow
                    key={u.id}
                    checked={draft.userIds.includes(u.id)}
                    onToggle={() => toggleIn("userIds", u.id)}
                    label={u.name}
                  />
                ))}
              </div>
              <Hint>
                Named people stay named when they change role or leave the team, so this list is
                worth re-reading when somebody does.
              </Hint>
            </div>

            {recipients === 0 && (
              <Caution>
                Nobody is picked, so this rule would fire and reach no one. The save is refused
                until at least one recipient is ticked.
              </Caution>
            )}
          </div>
        </Panel>

        <Panel title="How it reaches them">
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const on = draft.channels.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleIn("channels", c.value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    on
                      ? "border-gold bg-gold/10 text-gold-muted"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <c.icon className="size-4" /> {c.label}
                </button>
              );
            })}
          </div>
          {draft.channels.length === 0 && (
            <Caution>Pick at least one channel, or the rule has nowhere to send.</Caution>
          )}
          {draft.channels.includes("email") && (
            <Hint>Email reaches people outside the app, including on days off.</Hint>
          )}
        </Panel>

        <Panel title="What they read">
          <TextField
            label="Title"
            value={draft.title}
            onChange={(v) => setDraft((d) => ({ ...d, title: v }))}
          />
          <TextAreaField
            label="Message"
            rows={3}
            value={draft.body}
            onChange={(v) => setDraft((d) => ({ ...d, body: v }))}
            hint={
              def && def.tokens.length > 0
                ? `Tokens filled in when it sends: ${def.tokens.join("  ")}`
                : undefined
            }
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
        disabled={blocked}
        blockedReason={
          blocked
            ? draft.name.trim() === ""
              ? "Give the rule a name before saving."
              : draft.channels.length === 0
                ? "Pick at least one channel before saving."
                : "Pick at least one recipient before saving."
            : undefined
        }
      />
    </div>
  );
}

/**
 * The notifications nothing on a deal sets off.
 *
 * Three switches that used to live in two cards above the rule list, each
 * saving itself the moment it moved. One Save now, like every other panel in
 * Settings — a switch that has moved but not been committed says so.
 */
function SchedulesPanel({ schedules }: { schedules: Schedules }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(schedules);

  const serverKey = JSON.stringify(schedules);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(schedules);
  }

  const dirty = JSON.stringify(draft) !== serverKey;

  async function save() {
    setBusy(true);
    try {
      if (draft.weeklyTaskReminders !== schedules.weeklyTaskReminders) {
        const res = await setWeeklyTaskRemindersAction(draft.weeklyTaskReminders);
        if (!res.ok) return toast.error(res.error);
      }
      if (draft.overdueDigest !== schedules.overdueDigest) {
        const res = await setOverdueDigestAction(draft.overdueDigest);
        if (!res.ok) return toast.error(res.error);
      }
      if (draft.emailSignedCopyToSigners !== schedules.emailSignedCopyToSigners) {
        const res = await setEmailSignedCopyToSignersAction(draft.emailSignedCopyToSigners);
        if (!res.ok) return toast.error(res.error);
      }
      toast.success("Digests saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="schedules-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">Digests & delivery</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sent on a schedule rather than by anything happening on a deal — plus what a signer is
            emailed when a document completes.
          </p>
        </div>
      </header>

      <div className="mt-4 space-y-4">
        <Panel title="Weekly digests">
          <ToggleRow
            label="Weekly open-task reminder"
            description="Every Monday: each rep gets their open follow-ups with overdue flagged, managers get a rollup of their team, and admins get a company-wide one. Anybody with their own tasks plus a team gets both in one email."
            checked={draft.weeklyTaskReminders}
            onChange={(v) => setDraft((d) => ({ ...d, weeklyTaskReminders: v }))}
          />
          <ToggleRow
            label="Weekly overdue-jobs digest"
            description="Every Monday, managers and admins get one email and in-app summary of every job past its stage day-limit, grouped by the stage it is stuck in, worst first. Mirrors the Overdue Jobs report."
            checked={draft.overdueDigest}
            onChange={(v) => setDraft((d) => ({ ...d, overdueDigest: v }))}
          />
        </Panel>

        <Panel title="Document delivery" description="What signers receive once every party has signed.">
          <ToggleRow
            label="Email signers a copy of the signed document"
            description="When a document is fully executed, each signer is emailed the completed PDF — signature audit trail included — as an attachment for their records."
            checked={draft.emailSignedCopyToSigners}
            onChange={(v) => setDraft((d) => ({ ...d, emailSignedCopyToSigners: v }))}
          />
        </Panel>
      </div>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="digests & delivery"
        onSave={save}
        onDiscard={() => setDraft(schedules)}
      />
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {label}
    </label>
  );
}
