"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SaveAction = (input: { items: string[] }) => Promise<{ ok: boolean; error?: string }>;

/**
 * Edits a simple ordered list of labels (e.g. inspection outcomes, QC checklist)
 * and persists the whole list via the provided server action on each change.
 */
export function ListSettingsManager({
  items,
  save,
  addLabel = "Add item",
  placeholder = "New item",
}: {
  items: string[];
  save: SaveAction;
  addLabel?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [list, setList] = React.useState<string[]>(items);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function commit(next: string[]) {
    setBusy(true);
    const res = await save({ items: next });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't save.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    const label = draft.trim();
    if (!label) return;
    if (list.some((l) => l.toLowerCase() === label.toLowerCase())) {
      toast.error("That's already in the list.");
      return;
    }
    const next = [...list, label];
    setList(next);
    setDraft("");
    if (!(await commit(next))) setList(list);
  }

  async function remove(idx: number) {
    if (list.length === 1) return toast.error("Keep at least one.");
    const next = list.filter((_, i) => i !== idx);
    setList(next);
    if (!(await commit(next))) setList(list);
  }

  async function rename(idx: number, value: string) {
    const label = value.trim();
    if (!label || label === list[idx]) return;
    if (list.some((l, i) => i !== idx && l.toLowerCase() === label.toLowerCase())) {
      toast.error("That's already in the list.");
      setList([...list]);
      return;
    }
    const next = list.map((l, i) => (i === idx ? label : l));
    setList(next);
    await commit(next);
  }

  async function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[idx], next[j]] = [next[j], next[idx]];
    setList(next);
    await commit(next);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
        {list.map((label, idx) => (
          <div key={`${idx}-${label}`} className="flex items-center gap-2 px-3 py-2">
            <GripVertical className="size-4 shrink-0 text-muted-foreground/50" />
            <input
              defaultValue={label}
              disabled={busy}
              onBlur={(e) => rename(idx, e.target.value)}
              className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none"
            />
            <button onClick={() => move(idx, -1)} disabled={idx === 0 || busy} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move up">
              <ArrowUp className="size-4" />
            </button>
            <button onClick={() => move(idx, 1)} disabled={idx === list.length - 1 || busy} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move down">
              <ArrowDown className="size-4" />
            </button>
            <button onClick={() => remove(idx)} disabled={busy} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="px-3 py-6 text-sm text-muted-foreground">Nothing here yet.</p>}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="max-w-sm"
        />
        <Button size="sm" variant="outline" disabled={busy || !draft.trim()} onClick={add}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {addLabel}
        </Button>
      </div>
    </div>
  );
}
