"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setWeeklyTaskRemindersAction } from "@/server/modules/settings/actions";

/** Scheduled (time-based) reminders — distinct from the event-driven rules below. */
export function ScheduledRemindersSettings({ weeklyTaskReminders }: { weeklyTaskReminders: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(weeklyTaskReminders);
  const [pending, setPending] = React.useState(false);

  async function toggle(next: boolean) {
    setEnabled(next); // optimistic
    setPending(true);
    const res = await setWeeklyTaskRemindersAction(next);
    setPending(false);
    if (res.ok) {
      toast.success(next ? "Weekly task reminders on" : "Weekly task reminders off");
      router.refresh();
    } else {
      setEnabled(!next); // revert
      toast.error(res.error);
    }
  }

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
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div className="pr-4">
          <Label className="font-normal">Weekly open-task reminder</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every Monday, email each rep their open follow-ups (overdue flagged) and managers a team rollup.
          </p>
        </div>
        <Switch checked={enabled} disabled={pending} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
