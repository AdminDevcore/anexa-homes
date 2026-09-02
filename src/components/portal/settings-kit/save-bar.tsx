"use client";

import * as React from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One Save for a whole screen.
 *
 * Settings screens grew a Save per section — a lender had one for its details
 * and a second for its adder table, notifications had three — so setting
 * something up meant remembering which buttons you had pressed, and a half-saved
 * screen looked exactly like a saved one. There is one of these per screen. It
 * is only on the page when something has actually changed, it says what changed
 * and what it belongs to, and it follows you down the page so it is reachable
 * from the tab you are on rather than the tab you started on.
 */
export function SaveBar({
  dirty,
  busy,
  onSave,
  onDiscard,
  what,
  saveLabel = "Save changes",
  disabled,
  blockedReason,
}: {
  dirty: boolean;
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** What is being saved — "Amos", "this checklist". Named, so a person on tab 4 knows. */
  what: React.ReactNode;
  saveLabel?: string;
  /** Save is refused — the draft is not valid yet. */
  disabled?: boolean;
  /** Why it is refused, in place of the "unsaved changes" line. */
  blockedReason?: React.ReactNode;
}) {
  if (!dirty) return null;

  return (
    <div
      data-testid="settings-save-bar"
      className={cn(
        "sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg shadow-black/[0.06] backdrop-blur supports-[backdrop-filter]:bg-card/80",
        blockedReason ? "border-amber-500/50" : "border-gold/40"
      )}
    >
      <span className="flex items-center gap-2 text-xs font-medium">
        <TriangleAlert
          className={cn("size-3.5 shrink-0", blockedReason ? "text-amber-500" : "text-gold")}
        />
        {blockedReason ?? <>Unsaved changes to {what}</>}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy || disabled}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{" "}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * A draft of `T` that re-seeds itself when the server sends something new.
 *
 * The re-seed happens DURING RENDER, not in an effect: an effect that calls
 * setState runs after a paint, so the panel would flash the pre-save values for
 * a frame on every `router.refresh()`. And it compares a SIGNATURE of what the
 * server sent rather than the object, because server components hand down a new
 * object every render — a reference check would throw away an edit somebody was
 * halfway through, on a refresh that changed nothing.
 */
export function useDraft<T>(seed: T): {
  draft: T;
  setDraft: React.Dispatch<React.SetStateAction<T>>;
  /** Patch one key. */
  set: <K extends keyof T>(k: K, v: T[K]) => void;
  dirty: boolean;
  reset: () => void;
} {
  const key = JSON.stringify(seed);
  const [draft, setDraft] = React.useState<T>(seed);
  const [seen, setSeen] = React.useState(key);
  if (seen !== key) {
    setSeen(key);
    setDraft(seed);
  }

  const set = React.useCallback(
    <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => ({ ...d, [k]: v })),
    []
  );

  return {
    draft,
    setDraft,
    set,
    dirty: JSON.stringify(draft) !== key,
    reset: () => setDraft(seed),
  };
}
