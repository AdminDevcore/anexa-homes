"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Bell, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createNotificationRuleAction, updateNotificationRuleAction,
  toggleNotificationRuleAction, deleteNotificationRuleAction, type RuleInput,
} from "@/server/modules/notifications/actions";
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

const CHANNELS = [
  { value: "in_app", label: "In-app", icon: Bell },
  { value: "email", label: "Email", icon: Mail },
  { value: "sms", label: "SMS", icon: MessageSquare },
];

export function NotificationRulesManager(props: {
  rules: Rule[];
  stages: Option[];
  statuses: string[];
  users: Option[];
  roles: RoleOption[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <StarterRulesButton hasRules={props.rules.length > 0} />
        <RuleDialog {...props} />
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {props.rules.length === 0 && (
          <div className="space-y-1 px-5 py-10 text-center text-sm text-muted-foreground">
            <p>No rules yet, so this workspace sends no notifications at all.</p>
            <p className="text-xs">
              Add one, or start from the standard set — rules do not carry across workspaces.
            </p>
          </div>
        )}
        {props.rules.map((r) => (
          <RuleRow key={r.id} rule={r} {...props} />
        ))}
      </div>
    </div>
  );
}

function RuleRow({ rule, ...props }: { rule: Rule } & Omit<Parameters<typeof NotificationRulesManager>[0], "rules">) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function toggle(active: boolean) {
    setBusy(true);
    const res = await toggleNotificationRuleAction(rule.id, active);
    setBusy(false);
    if (res.ok) router.refresh(); else toast.error(res.error);
  }
  async function remove() {
    if (!confirm("Delete this rule?")) return;
    const res = await deleteNotificationRuleAction(rule.id);
    if (res.ok) { toast.success("Rule deleted"); router.refresh(); } else toast.error(res.error);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="font-medium">{rule.name}</div>
        <div className="text-xs text-muted-foreground">
          {eventLabel(rule.event as never)} · {rule.channels.join(", ")}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={rule.active} onCheckedChange={toggle} disabled={busy} />
        <RuleDialog {...props} rules={[]} rule={rule} trigger={<Button variant="ghost" size="icon"><Pencil className="size-4" /></Button>} />
        <Button variant="ghost" size="icon" onClick={remove}><Trash2 className="size-4 text-destructive" /></Button>
      </div>
    </div>
  );
}

function RuleDialog({
  rule, trigger, stages, statuses, users, roles,
}: {
  rule?: Rule;
  trigger?: React.ReactNode;
  rules?: Rule[];
  stages: Option[];
  statuses: string[];
  users: Option[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(rule?.name ?? "");
  const [event, setEvent] = React.useState(rule?.event ?? "stage_changed");
  const [stageId, setStageId] = React.useState(rule?.conditions?.stageId ?? "");
  const [status, setStatus] = React.useState(rule?.conditions?.status ?? "");
  const [roleSel, setRoleSel] = React.useState<string[]>(rule?.recipients?.roles ?? []);
  const [dynSel, setDynSel] = React.useState<string[]>(rule?.recipients?.dynamic ?? []);
  const [userSel, setUserSel] = React.useState<string[]>(rule?.recipients?.userIds ?? []);
  const [channels, setChannels] = React.useState<string[]>(rule?.channels ?? ["in_app"]);
  const [title, setTitle] = React.useState(rule?.titleTemplate ?? "");
  const [body, setBody] = React.useState(rule?.bodyTemplate ?? "");
  const [pending, setPending] = React.useState(false);

  const def = EVENT_DEFS.find((e) => e.value === event);

  function onEventChange(v: string) {
    setEvent(v);
    const d = EVENT_DEFS.find((e) => e.value === v);
    if (d && !rule) {
      setTitle(d.defaultTitle);
      setBody(d.defaultBody);
    }
  }

  // Prefill defaults on first open for a new rule.
  React.useEffect(() => {
    if (!rule && open && !title) {
      const d = EVENT_DEFS.find((e) => e.value === event);
      if (d) { setTitle(d.defaultTitle); setBody(d.defaultBody); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleIn(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  async function save() {
    if (!name.trim()) return toast.error("Name is required.");
    if (channels.length === 0) return toast.error("Pick at least one channel.");
    if (roleSel.length + dynSel.length + userSel.length === 0) return toast.error("Pick at least one recipient.");
    setPending(true);
    const payload: RuleInput = {
      name,
      event: event as RuleInput["event"],
      conditions: { ...(def?.condition === "stage" && stageId ? { stageId } : {}), ...(def?.condition === "status" && status ? { status } : {}) },
      recipients: { roles: roleSel, userIds: userSel, dynamic: dynSel },
      channels: channels as RuleInput["channels"],
      titleTemplate: title,
      bodyTemplate: body,
      active: rule?.active ?? true,
    };
    const res = rule
      ? await updateNotificationRuleAction(rule.id, payload)
      : await createNotificationRuleAction(payload);
    setPending(false);
    if (res.ok) {
      toast.success(rule ? "Rule updated" : "Rule created");
      setOpen(false);
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button className="bg-gold text-gold-foreground hover:bg-gold/90"><Plus className="size-4" /> Add Rule</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{rule ? "Edit" : "New"} Notification Rule</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Rule name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notify managers when a contract is signed" />
          </div>

          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select value={event} onValueChange={onEventChange}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_DEFS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {def?.condition === "stage" && (
            <div className="space-y-1.5">
              <Label>Only for stage (optional)</Label>
              <Select value={stageId || "any"} onValueChange={(v) => setStageId(v === "any" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Any stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any stage</SelectItem>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {def?.condition === "status" && (
            <div className="space-y-1.5">
              <Label>Only for status (optional)</Label>
              <Select value={status || "any"} onValueChange={(v) => setStatus(v === "any" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Any status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any status</SelectItem>
                  {statuses.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Recipients</Label>
            <p className="text-xs text-muted-foreground">Dynamic targets (relative to the event)</p>
            <div className="grid grid-cols-2 gap-1.5">
              {DYNAMIC_TARGETS.map((t) => (
                <CheckRow key={t.value} checked={dynSel.includes(t.value)} onToggle={() => toggleIn(dynSel, setDynSel, t.value)} label={t.label} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">By role</p>
            <div className="grid grid-cols-2 gap-1.5">
              {roles.map((r) => (
                <CheckRow key={r.value} checked={roleSel.includes(r.value)} onToggle={() => toggleIn(roleSel, setRoleSel, r.value)} label={r.label} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Specific people</p>
            <div className="grid max-h-32 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {users.map((u) => (
                <CheckRow key={u.id} checked={userSel.includes(u.id)} onToggle={() => toggleIn(userSel, setUserSel, u.id)} label={u.name} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="flex gap-2">
              {CHANNELS.map((c) => {
                const on = channels.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => toggleIn(channels, setChannels, c.value)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${on ? "border-gold bg-gold/10 text-gold-muted" : "border-border text-muted-foreground"}`}
                  >
                    <c.icon className="size-4" /> {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
            {def && def.tokens.length > 0 && (
              <p className="text-xs text-muted-foreground">Tokens: {def.tokens.join("  ")}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} {rule ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {label}
    </label>
  );
}
