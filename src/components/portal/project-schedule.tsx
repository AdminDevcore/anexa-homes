"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Hammer, ClipboardCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setProjectScheduleAction, setLeadScheduleDateAction } from "@/server/modules/costs/actions";

const toInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

/** The dates a deal can schedule from here. Both land on the calendar. */
export type ScheduleField = "install" | "inspection";

const FIELD_LABEL: Record<ScheduleField, string> = {
  install: "Install date",
  inspection: "Inspection date",
};

/**
 * Spelt out rather than formatted through `toLocaleDateString`.
 *
 * This renders on the server AND on the client, and the two do not necessarily
 * agree on a locale or a time zone — which is a hydration mismatch on a string
 * nobody would think to blame. A lookup off the UTC parts of a `YYYY-MM-DD` is
 * the same eleven characters in both places, always.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thursday, Aug 27" — the half of a date the input itself cannot show. */
function spell(yyyymmdd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return null;
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

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
  compact,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  busy: boolean;
  label: string;
  /** Sized to a date instead of stretched across the card. */
  compact?: boolean;
  onPick: (date: string) => void;
}) {
  // Derived during render, never synced in an effect: the input stays
  // uncontrolled (so a half-typed date survives a re-render) while the spelt-out
  // day beside it follows what was actually picked, before the server round
  // trip lands.
  const [picked, setPicked] = React.useState<string | null>(null);
  const shown = picked ?? toInput(value);
  const spelt = shown ? spell(shown) : null;

  return (
    <div className="flex items-center gap-2.5">
      <input
        type="date"
        aria-label={label}
        defaultValue={toInput(value)}
        disabled={disabled}
        onChange={(e) => {
          setPicked(e.target.value);
          onPick(e.target.value);
        }}
        className={cn(
          "h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
          // A date is nine characters wide. Stretched across the card it reads
          // as an empty text field somebody forgot to fill in.
          compact ? "w-[9.5rem] shrink-0" : "flex-1"
        )}
      />
      {busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        spelt && <span className="truncate text-sm text-muted-foreground">{spelt}</span>
      )}
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
      compact={bare}
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
