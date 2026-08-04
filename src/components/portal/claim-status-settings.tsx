"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, GripVertical, ArrowUp, ArrowDown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClaimStatusOption } from "@/lib/claim-status";

type Item = ClaimStatusOption & { inUse: number; unlocksScope: boolean };

type SaveAction = (input: {
  items: { key?: string; label: string }[];
}) => Promise<{ ok: boolean; error?: string }>;

/**
 * Editor for the company's claim-status list.
 *
 * Deliberately NOT `ListSettingsManager`: that one edits bare labels, and here a
 * rename must carry the row's frozen key along with it. Sending labels alone
 * would re-slug on every edit and orphan every deal sitting on the old key.
 *
 * Two things are surfaced that a plain list can't show, because both are what an
 * admin needs before hitting delete: how many live deals are on a status, and
 * whether it is one of the built-ins that unlocks the Scope of Work tab.
 */
export function ClaimStatusSettings({ items, save }: { items: Item[]; save: SaveAction }) {
  const router = useRouter();
  const [list, setList] = React.useState<Item[]>(items);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function commit(next: Item[]) {
    setBusy(true);
    const res = await save({ items: next.map((i) => ({ key: i.key, label: i.label })) });
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
    if (list.some((i) => i.label.toLowerCase() === label.toLowerCase())) {
      toast.error("That's already in the list.");
      return;
    }
    // No key: the server mints one and freezes it. Counts start at zero.
    const next = [...list, { key: "", label, inUse: 0, unlocksScope: false }];
    setList(next);
    setDraft("");
    if (!(await commit(next))) setList(list);
  }

  async function remove(idx: number) {
    if (list.length === 1) return toast.error("Keep at least one status.");
    const gone = list[idx];
    const next = list.filter((_, i) => i !== idx);
    setList(next);
    if (!(await commit(next))) return setList(list);
    if (gone.inUse > 0) {
      toast.warning(
        `${gone.inUse} deal${gone.inUse === 1 ? "" : "s"} still on "${gone.label}" — they keep it until you change them.`
      );
    }
  }

  async function rename(idx: number, value: string) {
    const label = value.trim();
    if (!label || label === list[idx].label) return;
    if (list.some((i, n) => n !== idx && i.label.toLowerCase() === label.toLowerCase())) {
      toast.error("That's already in the list.");
      setList([...list]);
      return;
    }
    // Key untouched on purpose — this is a rename, not a replacement.
    const next = list.map((i, n) => (n === idx ? { ...i, label } : i));
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
      <div className="divide-y divide-border/60 rounded-xl border border-border bg-card">
        {list.map((item, idx) => (
          <div key={item.key || `new-${idx}`} className="flex items-center gap-2 px-3 py-2">
            <GripVertical className="size-4 shrink-0 text-muted-foreground/50" />
            <input
              defaultValue={item.label}
              disabled={busy}
              onBlur={(e) => rename(idx, e.target.value)}
              aria-label={`Status ${idx + 1}`}
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none"
            />
            {item.unlocksScope && (
              <span
                title="Reaching this status opens the Scope of Work tab. Rename it freely; deleting it removes that shortcut."
                className="hidden shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold sm:inline-flex"
              >
                <Lock className="size-3" /> Opens scope
              </span>
            )}
            {item.inUse > 0 && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {item.inUse} deal{item.inUse === 1 ? "" : "s"}
              </span>
            )}
            <button
              onClick={() => move(idx, -1)}
              disabled={idx === 0 || busy}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              aria-label="Move up"
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              onClick={() => move(idx, 1)}
              disabled={idx === list.length - 1 || busy}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              aria-label="Move down"
            >
              <ArrowDown className="size-4" />
            </button>
            <button
              onClick={() => remove(idx)}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${item.label}`}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="e.g. Depreciation released"
          className="max-w-sm"
        />
        <Button size="sm" variant="outline" disabled={busy || !draft.trim()} onClick={add}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add status
        </Button>
      </div>
    </div>
  );
}
