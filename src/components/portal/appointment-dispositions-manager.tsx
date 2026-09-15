"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Hint,
  ListEditor,
  Panel,
  SaveBar,
  type ListRow,
} from "@/components/portal/settings-kit";
import {
  OUTCOME_CATEGORIES,
  OUTCOME_CATEGORY_LABELS,
  inferCountsAs,
  type Disposition,
  type OutcomeCategory,
} from "@/lib/dispositions";
import { updateAppointmentDispositionsAction } from "@/server/modules/settings/actions";

type Row = ListRow & { group: string; countsAs: OutcomeCategory };

/**
 * The outcomes a rep records at the end of an appointment.
 *
 * Every edit used to write straight to the server — a rename on blur, a reorder
 * on the arrow press, a delete behind a browser confirm — so a list being
 * reworked was half-published the whole way through. One draft, one Save.
 *
 * The group is what turns a flat list of fifteen into a menu somebody can read:
 * "Sold", "Not sold", "No show". Left blank, an outcome sits on its own at the
 * top level.
 *
 * On solar each outcome also says what it COUNTS AS — ran, not ran,
 * rescheduled, cancelled — which is how the Appointments list sorts. Roofing
 * shows no such control and saves exactly the shape it always saved.
 */
export function AppointmentDispositionsManager({
  items,
  defaults,
  showCategories,
}: {
  items: Disposition[];
  /** What "Standard list" loads: this workspace's own defaults. */
  defaults: Disposition[];
  showCategories: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  // The shape a save writes, and so the shape "dirty" is measured in. Roofing's
  // has no category, or its parsed (inferred) one would read as an unsaved edit.
  const toStored = React.useCallback(
    (d: { group: string | null; label: string; countsAs: OutcomeCategory }) =>
      showCategories
        ? { group: d.group, label: d.label, countsAs: d.countsAs }
        : { group: d.group, label: d.label },
    [showCategories]
  );

  const seed = React.useCallback(
    (): Row[] =>
      items.map((d, i) => ({
        id: `${i}-${d.label}`,
        label: d.label,
        group: d.group ?? "",
        countsAs: d.countsAs,
      })),
    [items]
  );
  const [rows, setRows] = React.useState(seed);

  const serverKey = JSON.stringify(items.map(toStored));
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setRows(seed());
  }

  const payload = rows
    .filter((r) => r.label.trim() !== "")
    .map((r) => toStored({ group: r.group.trim() || null, label: r.label.trim(), countsAs: r.countsAs }));
  const dirty = JSON.stringify(payload) !== serverKey;

  // Every group already in use, so adding another outcome to one is a matter of
  // recognising the name rather than spelling it the same way twice.
  const groups = Array.from(new Set(rows.map((r) => r.group.trim()).filter(Boolean)));

  async function commit(next: typeof payload, okMsg: string) {
    setBusy(true);
    try {
      const res = await updateAppointmentDispositionsAction({ items: next });
      if (!res.ok) return toast.error(res.error);
      toast.success(okMsg);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        title="Outcomes"
        description="In the order a rep is offered them. Deleting one keeps it on every appointment that already recorded it — the outcome is stored as text on the appointment, not as a pointer to this list."
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setRows(
                defaults.map((d, i) => ({
                  id: `default-${i}`,
                  label: d.label,
                  group: d.group ?? "",
                  countsAs: d.countsAs,
                }))
              );
              toast.info("Standard list loaded — Save to keep it.");
            }}
          >
            <RotateCcw className="size-4" /> Standard list
          </Button>
        }
      >
        <ListEditor
          rows={rows}
          onChange={(next) =>
            setRows(
              next.map((n) => ({
                ...n,
                group: (n as Row).group ?? "",
                // A freshly added row has no category yet: guess from its words.
                countsAs: (n as Row).countsAs ?? inferCountsAs(n.label),
              }))
            )
          }
          addLabel="Add outcome"
          placeholder="e.g. Sold — full replacement"
          disabled={busy}
          renderExtra={(row, i) => (
            <>
              <Input
                value={(row as Row).group}
                disabled={busy}
                list="disposition-groups"
                placeholder="group"
                aria-label={`Group for ${row.label || `outcome ${i + 1}`}`}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, group: e.target.value } : r))
                  )
                }
                className="h-9 w-32 shrink-0"
              />
              {showCategories && (
                <select
                  value={(row as Row).countsAs}
                  disabled={busy}
                  aria-label={`Counts as for ${row.label || `outcome ${i + 1}`}`}
                  onChange={(e) => {
                    const countsAs = e.target.value as OutcomeCategory;
                    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, countsAs } : r)));
                  }}
                  className="h-9 w-32 shrink-0 rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {OUTCOME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {OUTCOME_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        />
        <datalist id="disposition-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Hint>
          Outcomes sharing a group are shown together under it. Leave the group blank and the
          outcome sits on its own.
        </Hint>
        {showCategories && (
          <Hint>
            Counts as decides where an appointment with this outcome lands on the Appointments
            list: Ran, Not ran, Rescheduled or Cancelled.
          </Hint>
        )}
      </Panel>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="appointment outcomes"
        onSave={() => void commit(payload, "Outcomes saved")}
        onDiscard={() => setRows(seed())}
        disabled={payload.length === 0}
        blockedReason={
          payload.length === 0 ? "Keep at least one outcome — the picker needs an answer." : undefined
        }
      />

      {busy && (
        <span className="sr-only" role="status">
          <Loader2 className="size-4 animate-spin" /> Saving
        </span>
      )}
    </>
  );
}
