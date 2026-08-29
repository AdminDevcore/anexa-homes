"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BatteryCharging, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backupHours } from "@/lib/solar-storage";
import {
  saveBackupProfileAction,
  deleteBackupProfileAction,
  saveRebateAction,
  deleteRebateAction,
  type BackupProfileRow,
  type RebateRow,
} from "@/server/modules/solar/storage";

/**
 * The two lists a storage quote is built from.
 *
 * One screen rather than two routes: both are short, both exist only because a
 * deal can sell a battery, and a rep setting one up is setting up the other in
 * the same sitting.
 */

/** kWh a two-Powerwall system holds, used only to preview hours in Settings. */
const REFERENCE_KWH = 27;

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Run a server action, and ALWAYS put the busy flag back.
 *
 * The `finally` is the point. Roughly forty components in this codebase reset
 * the flag on the line after the await, so an action that throws leaves the
 * form permanently disabled — the "it won't let me type" bug, which looks like
 * a broken input and is actually a latched boolean.
 */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error ?? "Something went wrong.");
          return false;
        }
        toast.success(okMsg);
        router.refresh();
        return true;
      } catch {
        toast.error("Something went wrong.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  return { busy, run };
}

// ---------------------------------------------------------------------------
// Backup load profiles
// ---------------------------------------------------------------------------

export function BackupProfileManager({
  rows,
  canEdit,
}: {
  rows: BackupProfileRow[];
  canEdit: boolean;
}) {
  const { busy, run } = useAction();
  const [name, setName] = React.useState("");
  const [watts, setWatts] = React.useState("");

  const add = () =>
    run(
      () =>
        saveBackupProfileAction({
          name: name.trim(),
          loadWatts: Number(watts),
          rank: rows.length,
          isActive: true,
        }),
      "Profile added."
    ).then((ok) => {
      if (ok) {
        setName("");
        setWatts("");
      }
    });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <BatteryCharging className="size-4" />
          Backup load profiles
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          What a battery is asked to carry when the power goes out. Hours are worked out from these
          — the proposal never asks anyone to type a runtime. The first profile is the one the
          customer&rsquo;s cover leads with, so keep the lightest load at the top.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          No profiles. A storage proposal cannot state backup hours at all without one, and
          readiness will block generating it.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r, i) => (
            <ProfileRow key={r.id} row={r} index={i} canEdit={canEdit} busy={busy} run={run} />
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="min-w-40 flex-1">
            <Label htmlFor="bp-name" className="text-xs">
              Name
            </Label>
            <Input
              id="bp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Essentials + AC"
              disabled={busy}
            />
          </div>
          <div className="w-32">
            <Label htmlFor="bp-watts" className="text-xs">
              Load (watts)
            </Label>
            <Input
              id="bp-watts"
              type="number"
              min={1}
              value={watts}
              onChange={(e) => setWatts(e.target.value)}
              placeholder="3500"
              disabled={busy}
            />
          </div>
          <Button onClick={add} disabled={busy || !name.trim() || !(Number(watts) > 0)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      )}
    </section>
  );
}

function ProfileRow({
  row,
  index,
  canEdit,
  busy,
  run,
}: {
  row: BackupProfileRow;
  index: number;
  canEdit: boolean;
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => Promise<boolean>;
}) {
  const hours = backupHours(REFERENCE_KWH, row.loadWatts);

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="w-6 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
      <span className={row.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>
        {row.name}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {row.loadWatts.toLocaleString("en-US")} W
      </span>
      {hours != null && (
        <span className="text-xs text-muted-foreground">
          {/* Not a promise about any deal — a sanity check on the number just typed. */}
          ~{hours.toFixed(1)} hrs on a {REFERENCE_KWH} kWh system
        </span>
      )}
      {canEdit && (
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(
                () => saveBackupProfileAction({ ...row, isActive: !row.isActive }),
                row.isActive ? "Profile turned off." : "Profile turned on."
              )
            }
          >
            {row.isActive ? "Turn off" : "Turn on"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => deleteBackupProfileAction({ id: row.id }), "Profile deleted.")}
          >
            <Trash2 className="size-4" />
            <span className="sr-only">Delete {row.name}</span>
          </Button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Rebates
// ---------------------------------------------------------------------------

export function RebateManager({ rows, canEdit }: { rows: RebateRow[]; canEdit: boolean }) {
  const { busy, run } = useAction();
  const [name, setName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [perBattery, setPerBattery] = React.useState(true);

  const add = () =>
    run(
      () =>
        saveRebateAction({
          name: name.trim(),
          amountCents: Math.round(Number(amount) * 100),
          perBattery,
          rank: rows.length,
          isActive: true,
        }),
      "Rebate added."
    ).then((ok) => {
      if (ok) {
        setName("");
        setAmount("");
      }
    });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">Rebates</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Manufacturer or utility money the company passes through. A rebate comes off the price
          before the lender&rsquo;s fee, so the amount financed and the monthly payment both drop.
          Priced here once so two reps cannot quote the same rebate at two amounts. Nothing is
          applied to a deal automatically.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rebates yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className={r.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>
                {r.name}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {usd(r.amountCents)} {r.perBattery ? "per battery" : "per job"}
              </span>
              {canEdit && (
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => saveRebateAction({ ...r, isActive: !r.isActive }),
                        r.isActive ? "Rebate turned off." : "Rebate turned on."
                      )
                    }
                  >
                    {r.isActive ? "Turn off" : "Turn on"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => deleteRebateAction({ id: r.id }), "Rebate deleted.")}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Delete {r.name}</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="min-w-40 flex-1">
            <Label htmlFor="rb-name" className="text-xs">
              Name
            </Label>
            <Input
              id="rb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tesla battery rebate"
              disabled={busy}
            />
          </div>
          <div className="w-32">
            <Label htmlFor="rb-amount" className="text-xs">
              Amount ($)
            </Label>
            <Input
              id="rb-amount"
              type="number"
              min={1}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              disabled={busy}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input
              id="rb-per-battery"
              type="checkbox"
              className="size-4"
              checked={perBattery}
              onChange={(e) => setPerBattery(e.target.checked)}
              disabled={busy}
            />
            <Label htmlFor="rb-per-battery" className="text-xs">
              Per battery
            </Label>
          </div>
          <Button onClick={add} disabled={busy || !name.trim() || !(Number(amount) > 0)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      )}
    </section>
  );
}
