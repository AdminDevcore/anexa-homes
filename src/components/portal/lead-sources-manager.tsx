"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Caution,
  Hint,
  ListEditor,
  Panel,
  SaveBar,
  type ListRow,
} from "@/components/portal/settings-kit";
import {
  createLeadSourceAction,
  renameLeadSourceAction,
  moveLeadSourceAction,
  setLeadSourceActiveAction,
  deleteLeadSourceAction,
} from "@/server/modules/settings/actions";

type Source = {
  id: string;
  name: string;
  active: boolean;
  position: number;
  _count: { leads: number };
};

type Row = ListRow & { sourceId: string | null; active: boolean; leads: number };

/**
 * Where leads come from — the options in the "Source" dropdown a rep books
 * against.
 *
 * Every control on this screen used to be its own write: a pencil to rename, two
 * arrows that each posted a move, a switch that posted an activation, a bin
 * behind a browser confirm. It is one draft and one Save now, and the Save
 * works out which of those actions each row actually needs.
 *
 * Deactivating hides a source from the picker but keeps it on past leads and in
 * reports. A source no lead has ever used can be deleted outright; one that has
 * been used cannot, and the row says so rather than failing on the click.
 */
export function LeadSourcesManager({ items }: { items: Source[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(
    (): Row[] =>
      items.map((s) => ({
        id: s.id,
        sourceId: s.id,
        label: s.name,
        active: s.active,
        leads: s._count.leads,
        note: s._count.leads > 0 ? `${s._count.leads} lead${s._count.leads === 1 ? "" : "s"}` : "unused",
        lockedReason:
          s._count.leads > 0
            ? "Leads were booked against this source — switch it off instead, so past leads and reports keep it."
            : undefined,
      })),
    [items]
  );

  const [rows, setRows] = React.useState(seed);
  const serverKey = JSON.stringify(items.map((s) => [s.id, s.name, s.active]));
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setRows(seed());
  }

  const dirty =
    JSON.stringify(rows.map((r) => [r.sourceId ?? "new", r.label.trim(), r.active])) !==
    JSON.stringify(items.map((s) => [s.id, s.name, s.active]));

  const activeCount = rows.filter((r) => r.active && r.label.trim()).length;

  /**
   * Save the DIFF, through the action each change was written for.
   *
   * Ordering is the one that has to go last: `moveLeadSourceAction` swaps a row
   * with its neighbour, so it only makes sense once every row that is going to
   * exist does.
   */
  async function commit() {
    setBusy(true);
    try {
      const before = items;

      for (const gone of before.filter((s) => !rows.some((r) => r.sourceId === s.id))) {
        const res = await deleteLeadSourceAction(gone.id);
        if (!res.ok) return toast.error(res.error);
      }

      for (const row of rows) {
        const name = row.label.trim();
        if (name === "") continue;
        if (row.sourceId == null) {
          const res = await createLeadSourceAction(name);
          if (!res.ok) return toast.error(res.error);
          continue;
        }
        const was = before.find((s) => s.id === row.sourceId);
        if (!was) continue;
        if (was.name !== name) {
          const res = await renameLeadSourceAction(row.sourceId, name);
          if (!res.ok) return toast.error(res.error);
        }
        if (was.active !== row.active) {
          const res = await setLeadSourceActiveAction(row.sourceId, row.active);
          if (!res.ok) return toast.error(res.error);
        }
      }

      // Ordering, once the list is settled. Each step is a swap with the row
      // above, applied top-down, which walks any list into any order.
      const kept = rows.filter((r) => r.sourceId != null && r.label.trim() !== "");
      const order = before
        .filter((s) => kept.some((r) => r.sourceId === s.id))
        .map((s) => s.id);
      for (const [target, row] of kept.entries()) {
        const at = order.indexOf(row.sourceId!);
        for (let i = at; i > target; i--) {
          const res = await moveLeadSourceAction(row.sourceId!, "up");
          if (!res.ok) return toast.error(res.error);
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
        }
      }

      toast.success("Lead sources saved");
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
        title="Sources"
        description="The options a rep picks from when booking a lead, in the order they are offered."
      >
        <ListEditor
          rows={rows}
          onChange={(next) =>
            setRows(
              next.map((n) => {
                const was = rows.find((r) => r.id === n.id);
                return {
                  ...n,
                  sourceId: was?.sourceId ?? null,
                  active: was?.active ?? true,
                  leads: was?.leads ?? 0,
                };
              })
            )
          }
          addLabel="Add source"
          placeholder="e.g. Facebook Ads"
          disabled={busy}
          renderExtra={(row, i) => (
            <span
              className="shrink-0"
              title={(row as Row).active ? "Offered in the picker" : "Hidden from the picker"}
            >
              <Switch
                checked={(row as Row).active}
                disabled={busy}
                aria-label={`${row.label || `Source ${i + 1}`} offered to reps`}
                onCheckedChange={(v) =>
                  setRows((prev) => prev.map((r, j) => (j === i ? { ...r, active: v } : r)))
                }
              />
            </span>
          )}
        />
        <Hint>
          {activeCount} source{activeCount === 1 ? "" : "s"} offered to reps. Switching one off
          hides it from the picker but keeps it on every lead already booked against it and in every
          report.
        </Hint>
        {activeCount === 0 && rows.length > 0 && (
          <Caution>
            Nothing is switched on, so the Source dropdown a rep books against will be empty.
          </Caution>
        )}
      </Panel>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="lead sources"
        onSave={commit}
        onDiscard={() => setRows(seed())}
      />
    </>
  );
}
