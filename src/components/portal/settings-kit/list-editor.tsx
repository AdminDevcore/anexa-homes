"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "./fields";

/** One row of an ordered list. */
export type ListRow = {
  /**
   * Stable identity across a reorder.
   *
   * A database id, a frozen key, or one minted for a row that has not been
   * saved yet. NOT the index: React would carry one row's typing into another's
   * box the moment anything moved.
   */
  id: string;
  label: string;
  /** A short note on the right — "12 deals", "unlocks Scope of Work". */
  note?: React.ReactNode;
  /** Set when this row cannot be removed; the sentence says why. */
  lockedReason?: string;
};

/**
 * An ordered list of labels, edited in place.
 *
 * Six settings screens are exactly this — appointment outcomes, inspection
 * outcomes, the QC checklist, claim statuses, lead sources, the stages a deal
 * moves through — and each had grown its own version, with its own idea of
 * whether a rename saves on blur, whether a reorder writes immediately, and
 * whether deleting the last row is allowed. They now share this, and the screen
 * around it owns the draft and the one Save.
 *
 * The order is the order a rep is offered them, so it is edited with arrows
 * rather than by typing rank numbers — and arrows, not a drag handle, because
 * the same reorder has to work from a keyboard and on a phone.
 */
export function ListEditor({
  rows,
  onChange,
  placeholder = "New item",
  addLabel = "Add",
  /** Keeping at least one is usually the point — an empty picker has no answers. */
  minRows = 1,
  renderExtra,
  disabled,
}: {
  rows: ListRow[];
  onChange: (next: ListRow[]) => void;
  placeholder?: string;
  addLabel?: string;
  minRows?: number;
  /** An extra control per row — a group name, an on/off switch. */
  renderExtra?: (row: ListRow, index: number) => React.ReactNode;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const minted = React.useRef(0);
  const addRef = React.useRef<HTMLInputElement>(null);

  function add() {
    const label = draft.trim();
    if (!label) return;
    if (rows.some((r) => r.label.toLowerCase() === label.toLowerCase())) return;
    onChange([...rows, { id: `new-${minted.current++}`, label }]);
    setDraft("");
    // These get entered in a burst, so the caret goes straight back.
    addRef.current?.focus();
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  const duplicate = (label: string, index: number) =>
    rows.some((r, i) => i !== index && r.label.trim().toLowerCase() === label.trim().toLowerCase());

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {rows.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing here yet.</li>
        )}
        {rows.map((row, i) => {
          const dupe = row.label.trim() !== "" && duplicate(row.label, i);
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <Input
                value={row.label}
                disabled={disabled}
                aria-label={`Item ${i + 1}`}
                aria-invalid={dupe || undefined}
                onChange={(e) =>
                  onChange(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                }
                className={cn("h-9 min-w-0 flex-1", dupe && "border-amber-500")}
              />
              {renderExtra?.(row, i)}
              {row.note && (
                <span className="shrink-0 text-[11px] text-muted-foreground">{row.note}</span>
              )}
              <span className="flex shrink-0 items-center">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled || i === 0}
                  aria-label={`Move ${row.label || `item ${i + 1}`} up`}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled || i === rows.length - 1}
                  aria-label={`Move ${row.label || `item ${i + 1}`} down`}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled || rows.length <= minRows || row.lockedReason != null}
                  title={row.lockedReason}
                  aria-label={`Remove ${row.label || `item ${i + 1}`}`}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={addRef}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-w-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          <Plus className="size-4" /> {addLabel}
        </Button>
      </div>

      {rows.some((r, i) => r.label.trim() !== "" && duplicate(r.label, i)) && (
        <Hint className="text-amber-600 dark:text-amber-400">
          Two rows say the same thing. Both will be stored, and nobody choosing between them will
          know which is which.
        </Hint>
      )}
    </div>
  );
}
