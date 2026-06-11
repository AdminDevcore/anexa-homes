"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Hammer, Loader2 } from "lucide-react";
import { setProjectScheduleAction } from "@/server/modules/costs/actions";

const toInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

/** Set the adjuster-meeting + install dates that drive the calendar. */
export function ProjectSchedule({
  projectId,
  installDate,
  canManage,
}: {
  projectId: string;
  installDate: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"adjuster" | "install" | null>(null);

  async function save(field: "adjuster" | "install", date: string) {
    setBusy(field);
    const res = await setProjectScheduleAction({ projectId, field, date: date || null });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(date ? "Date saved — it'll show on the calendar" : "Date cleared");
    router.refresh();
  }

  const Row = ({ field, label, icon: Icon, value }: { field: "adjuster" | "install"; label: string; icon: typeof Hammer; value: string | null }) => (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 text-gold" /> {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="date"
          defaultValue={toInput(value)}
          disabled={!canManage || busy === field}
          onChange={(e) => save(field, e.target.value)}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        {busy === field && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <Row field="install" label="Install date" icon={Hammer} value={installDate} />
    </div>
  );
}
