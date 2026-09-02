"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListEditor, Panel, SaveBar, type ListRow } from "@/components/portal/settings-kit";

type SaveAction = (input: { items: string[] }) => Promise<{ ok: boolean; error?: string }>;

/**
 * A simple ordered list of labels — inspection outcomes, the QC checklist.
 *
 * It used to write on every keystroke's blur and on every arrow press: a rename
 * saved itself when focus left the box, a reorder saved itself as it moved. So
 * there was no way to change your mind, and a half-edited list looked exactly
 * like a finished one. The whole list is one draft now, with one Save.
 */
export function ListSettingsManager({
  items,
  save,
  title,
  description,
  addLabel = "Add item",
  placeholder = "New item",
}: {
  items: string[];
  save: SaveAction;
  title: string;
  description?: React.ReactNode;
  addLabel?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(
    (): ListRow[] => items.map((label, i) => ({ id: `${i}-${label}`, label })),
    [items]
  );
  const [rows, setRows] = React.useState(seed);

  const serverKey = JSON.stringify(items);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setRows(seed());
  }

  const labels = rows.map((r) => r.label.trim()).filter(Boolean);
  const dirty = JSON.stringify(labels) !== serverKey;

  async function commit() {
    setBusy(true);
    try {
      const res = await save({ items: labels });
      if (!res.ok) return toast.error(res.error ?? "Couldn't save.");
      toast.success(`${title} saved`);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title={title} description={description}>
        <ListEditor
          rows={rows}
          onChange={setRows}
          addLabel={addLabel}
          placeholder={placeholder}
          disabled={busy}
        />
      </Panel>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what={title.toLowerCase()}
        onSave={commit}
        onDiscard={() => setRows(seed())}
        disabled={labels.length === 0}
        blockedReason={labels.length === 0 ? "Keep at least one item in the list." : undefined}
      />
    </>
  );
}
