"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Hammer, ClipboardCheck, Loader2 } from "lucide-react";
import { setProjectScheduleAction, setLeadScheduleDateAction } from "@/server/modules/costs/actions";

const toInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

/** The dates a deal can schedule from here. Both land on the calendar. */
export type ScheduleField = "install" | "inspection";

const FIELD_LABEL: Record<ScheduleField, string> = {
  install: "Install date",
  inspection: "Inspection date",
};

/**
 * The date input itself. MODULE SCOPE on purpose: defined inside the component
 * it is a new type on every render, which remounts the input — and with
 * `defaultValue` that silently discards a half-typed date. `react-hooks/
 * static-components` is an error in this repo for exactly this reason.
 */
function DateInput({
  value,
  disabled,
  busy,
  label,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  busy: boolean;
  label: string;
  onPick: (date: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        aria-label={label}
        defaultValue={toInput(value)}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
        className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/**
 * Set one of the dates that drive the calendar — the install, or the AHJ /
 * utility inspection that follows it.
 *
 * Takes a leadId as well as a projectId because the date has to be settable on
 * a deal that has NOT started production — which is most of them. Both columns
 * live on Project, so the server creates the job on demand when a date is first
 * picked; see `setLeadScheduleDateAction`.
 */
export function ProjectSchedule({
  field = "install",
  projectId,
  leadId,
  value,
  canManage,
  bare = false,
}: {
  /** Which date this input edits. Defaults to the install date. */
  field?: ScheduleField;
  /** Null when the deal has no job yet. */
  projectId: string | null;
  leadId: string;
  /** Current value as an ISO string, or null when unset. */
  value: string | null;
  canManage: boolean;
  /**
   * Just the input. Set when the surrounding UI already supplies the label and
   * the card — the deal's Installation slide — where this component's own
   * bordered box and second caption read as a duplicate.
   */
  bare?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const label = FIELD_LABEL[field];

  async function save(date: string) {
    setBusy(true);
    // Without a job there is nothing to hang the date on, so route through the
    // action that creates one first. Everything else keeps the direct path.
    const res = projectId
      ? await setProjectScheduleAction({ projectId, field, date: date || null })
      : await setLeadScheduleDateAction({ leadId, field, date: date || null });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(
      !date
        ? "Date cleared"
        : "created" in res && res.created
          ? `${label} set — the job is now open`
          : "Date saved — it'll show on the calendar"
    );
    router.refresh();
  }

  const input = (
    <DateInput
      value={value}
      label={label}
      disabled={!canManage || busy}
      busy={busy}
      onPick={save}
    />
  );

  if (bare) return input;

  const Icon = field === "inspection" ? ClipboardCheck : Hammer;
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5 text-gold" /> {label}
        </span>
        {input}
      </div>
    </div>
  );
}
