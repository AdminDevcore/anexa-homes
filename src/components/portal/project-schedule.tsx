"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Hammer, Loader2 } from "lucide-react";
import { setProjectScheduleAction, setLeadInstallDateAction } from "@/server/modules/costs/actions";

const toInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

type Field = "adjuster" | "install";

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
 * Set the install date that drives the calendar.
 *
 * Takes a leadId as well as a projectId because the date has to be settable on
 * a deal that has NOT started production — which is most of them. `installDate`
 * is a Project column, so the server creates the job on demand when a date is
 * first picked; see `setLeadInstallDateAction`.
 */
export function ProjectSchedule({
  projectId,
  leadId,
  installDate,
  canManage,
  bare = false,
}: {
  /** Null when the deal has no job yet. */
  projectId: string | null;
  leadId: string;
  installDate: string | null;
  canManage: boolean;
  /**
   * Just the input. Set when the surrounding UI already supplies the label and
   * the card — the deal Summary sidebar — where this component's own bordered
   * box and second "Install date" caption read as a duplicate.
   */
  bare?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<Field | null>(null);

  async function save(field: Field, date: string) {
    setBusy(field);
    // Without a job there is nothing to hang the date on, so route through the
    // action that creates one first. Everything else keeps the direct path.
    const res =
      field === "install" && !projectId
        ? await setLeadInstallDateAction({ leadId, date: date || null })
        : await setProjectScheduleAction({ projectId: projectId!, field, date: date || null });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(
      !date
        ? "Date cleared"
        : "created" in res && res.created
          ? "Install date set — the job is now open"
          : "Date saved — it'll show on the calendar"
    );
    router.refresh();
  }

  const input = (
    <DateInput
      value={installDate}
      label="Install date"
      disabled={!canManage || busy === "install"}
      busy={busy === "install"}
      onPick={(d) => save("install", d)}
    />
  );

  if (bare) return input;

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Hammer className="size-3.5 text-gold" /> Install date
        </span>
        {input}
      </div>
    </div>
  );
}
