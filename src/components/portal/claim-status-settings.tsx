"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import {
  Caution,
  Hint,
  ListEditor,
  Panel,
  SaveBar,
  type ListRow,
} from "@/components/portal/settings-kit";
import type { ClaimStatusOption } from "@/lib/claim-status";

type Item = ClaimStatusOption & { inUse: number; unlocksScope: boolean };

type SaveAction = (input: {
  items: { key?: string; label: string }[];
}) => Promise<{ ok: boolean; error?: string }>;

type Row = ListRow & { key: string; inUse: number; unlocksScope: boolean };

/**
 * The company's claim-status list.
 *
 * Deliberately not the plain label list: a rename must carry the row's FROZEN
 * KEY along with it. Sending labels alone would re-slug on every edit and orphan
 * every deal sitting on the old key — which is why a new row is added with no
 * key at all and the server mints one.
 *
 * Two things a plain list cannot show are on each row, because both are what an
 * admin needs before hitting delete: how many live deals are on a status, and
 * whether it is one of the built-ins that unlocks the Scope of Work tab.
 */
export function ClaimStatusSettings({ items, save }: { items: Item[]; save: SaveAction }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(
    (): Row[] =>
      items.map((i, n) => ({
        id: i.key || `row-${n}`,
        key: i.key,
        label: i.label,
        inUse: i.inUse,
        unlocksScope: i.unlocksScope,
        note: (
          <span className="flex items-center gap-1.5">
            {i.unlocksScope && (
              <span
                title="Reaching this status opens the Scope of Work tab. Rename it freely; deleting it removes that shortcut."
                className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold"
              >
                <Lock className="size-3" /> opens scope
              </span>
            )}
            {i.inUse > 0 && <span>{i.inUse === 1 ? "1 deal" : `${i.inUse} deals`}</span>}
          </span>
        ),
      })),
    [items]
  );

  const [rows, setRows] = React.useState(seed);
  const serverKey = JSON.stringify(items.map((i) => ({ key: i.key, label: i.label })));
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setRows(seed());
  }

  const payload = rows
    .filter((r) => r.label.trim() !== "")
    // A row with no key is new: the server mints one and freezes it.
    .map((r) => ({ ...(r.key ? { key: r.key } : {}), label: r.label.trim() }));
  const dirty = JSON.stringify(payload) !== serverKey;

  /** Statuses about to disappear that deals are still sitting on. */
  const strandedDeals = items
    .filter((i) => i.inUse > 0 && !rows.some((r) => r.key === i.key))
    .reduce((n, i) => n + i.inUse, 0);
  const losingScope = items.some((i) => i.unlocksScope && !rows.some((r) => r.key === i.key));

  async function commit() {
    setBusy(true);
    try {
      const res = await save({ items: payload });
      if (!res.ok) return toast.error(res.error ?? "Couldn't save.");
      toast.success("Claim statuses saved");
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
        title="Statuses"
        description="What the deal Summary offers for a carrier claim, in the order a rep picks from."
      >
        <ListEditor
          rows={rows}
          onChange={(next) =>
            setRows(
              next.map((n) => {
                const was = rows.find((r) => r.id === n.id);
                return {
                  ...n,
                  key: was?.key ?? "",
                  inUse: was?.inUse ?? 0,
                  unlocksScope: was?.unlocksScope ?? false,
                };
              })
            )
          }
          addLabel="Add status"
          placeholder="e.g. Depreciation released"
          disabled={busy}
        />
        <Hint>
          Renaming is safe: the internal key is frozen when a status is created, so every deal
          already on it follows the new wording.
        </Hint>
        {strandedDeals > 0 && (
          <Caution>
            {strandedDeals === 1 ? "One deal is" : `${strandedDeals} deals are`} still on a status
            you have removed. They keep showing it until somebody picks a new one.
          </Caution>
        )}
        {losingScope && (
          <Caution>
            You have removed a status that opens the Scope of Work tab. Deals will no longer reach
            it by moving through the claim.
          </Caution>
        )}
      </Panel>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="claim statuses"
        onSave={commit}
        onDiscard={() => setRows(seed())}
        disabled={payload.length === 0}
        blockedReason={payload.length === 0 ? "Keep at least one status." : undefined}
      />
    </>
  );
}
