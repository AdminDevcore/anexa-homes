"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setWeeklyTaskRemindersAction, setOverdueDigestAction } from "@/server/modules/settings/actions";

type Action = (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;

/** A single scheduled-digest toggle row backed by a server action. */
function ToggleRow({
  initial, title, description, action, onLabel, offLabel,
}: {
  initial: boolean; title: string; description: string; action: Action; onLabel: string; offLabel: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  async function toggle(next: boolean) {
    setEnabled(next); // optimistic
    setPending(true);
    const res = await action(next);
    setPending(false);
    if (res.ok) {
      toast.success(next ? onLabel : offLabel);
      router.refresh();
    } else {
      setEnabled(!next); // revert
      toast.error(res.error);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
      <div className="pr-4">
        <Label className="font-normal">{title}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={enabled} disabled={pending} onCheckedChange={toggle} />
    </div>
  );
}

/** Scheduled (time-based) reminders — distinct from the event-driven rules below. */
export function ScheduledRemindersSettings({
  weeklyTaskReminders,
  overdueDigest,
}: {
  weeklyTaskReminders: boolean;
  overdueDigest: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <CalendarClock className="size-4 text-gold" /> Scheduled reminders
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Time-based digests sent on a schedule (separate from the event rules below).
        </p>
      </div>

      <ToggleRow
        initial={weeklyTaskReminders}
        title="Weekly open-task reminder"
        description="Every Monday: each rep gets their open follow-ups (overdue flagged), managers get a rollup of their team, and admins get a company-wide rollup. Anyone who has their own tasks plus a team gets both in one email."
        action={setWeeklyTaskRemindersAction}
        onLabel="Weekly task reminders on"
        offLabel="Weekly task reminders off"
      />

      <ToggleRow
        initial={overdueDigest}
        title="Weekly overdue-jobs digest"
        description="Every Monday, managers and admins get one email + in-app summary of every job past its stage day-limit, grouped by the stage it's stuck in (worst offenders first). Mirrors the Overdue Jobs report."
        action={setOverdueDigestAction}
        onLabel="Overdue-jobs digest on"
        offLabel="Overdue-jobs digest off"
      />
    </div>
  );
}
