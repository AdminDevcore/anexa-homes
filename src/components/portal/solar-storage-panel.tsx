"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BatteryCharging, Loader2, Star } from "lucide-react";
import { Label } from "@/components/ui/label";
import { setSolarDesignEquipmentAction } from "@/server/modules/solar/equipment-actions";
import {
  usableKwh,
  wholeHomeBackup,
  type AutoBatterySizing,
} from "@/lib/solar-storage";

export type StorageEquipmentOption = {
  id: string;
  label: string;
  /** Watt-HOURS. `SolarEquipment.ratingW` holds capacity on a battery. */
  ratingW: number | null;
  /** The company's standard battery — the one starred on the catalogue. */
  isDefault?: boolean;
  /**
   * What the catalogue sells ONE of these for. The price a deal charges for
   * storage unless somebody has typed another on the deal itself — see
   * `batteryChargeCents`.
   */
  priceCents?: number;
};

export type SolarStorageView = {
  batteryId: string | null;
  batteryQty: number;
  /** Every battery this deal's lender approves. Same list the designer offers. */
  batteries: StorageEquipmentOption[];
  /** How many of the standard battery this company's standard offer is. */
  defaultQty: number;
  /**
   * What sizing-to-the-night has to say about this deal, or null when the
   * company does not size that way and the count is simply whatever it says.
   */
  autoSize: {
    /** A person typed this count, so the sizing rule is standing off it. */
    setByRep: boolean;
    nightSharePct: number;
    /** Null when there is nothing to size from yet — no figures, no capacity. */
    sized: AutoBatterySizing | null;
  } | null;
  /**
   * The home's own use, kWh/yr — what the runtime below is divided out of.
   *
   * Null until somebody fills in the Energy step, and the panel says so rather
   * than printing hours from nothing. Readiness blocks generating on the same
   * fact, so a rep sees it here first.
   */
  annualUsageKwh: number | null;
  /** The company's margin over that average while the grid is down. */
  outageDrawFactor: number;
};

/**
 * Step three on a storage deal.
 *
 * The roof designer's job is to answer "how many panels fit and where" — a
 * question a battery does not have. What is left is which battery and how many,
 * and the two figures that follow from them: what it holds, and how long that
 * lasts. Both are DERIVED and shown read-only, because the proposal derives
 * them the same way and a rep who could type one would be typing a promise.
 */
export function SolarStoragePanel({
  leadId,
  view,
  canEdit,
}: {
  leadId: string;
  view: SolarStorageView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  // Optimistic, so the derived figures move the instant the select does rather
  // than after a round trip — the whole point of this screen is watching them.
  const [batteryId, setBatteryId] = React.useState(view.batteryId);
  const [qty, setQty] = React.useState(Math.max(1, view.batteryQty));

  /**
   * Re-seed when the server sends something new.
   *
   * DURING RENDER, not in an effect. An effect that calls setState runs after
   * a paint, so the panel would flash the stale figure for one frame every time
   * the router refreshed — and eslint rejects the pattern outright. Comparing
   * the prop against what was last seen is React's own answer to this, and it
   * is what the proposal document does with its snapshot.
   */
  const [seen, setSeen] = React.useState(view);
  if (seen !== view) {
    setSeen(view);
    setBatteryId(view.batteryId);
    setQty(Math.max(1, view.batteryQty));
  }

  const battery = view.batteries.find((b) => b.id === batteryId) ?? null;
  const standard = view.batteries.find((b) => b.isDefault) ?? null;
  const auto = view.autoSize;
  const autoQty = auto?.sized?.qty ?? null;
  /** The count is the sizing rule's own, and nobody has overridden it. */
  const isAutoSized = !!auto && !auto.setByRep && autoQty === qty;
  const kwh = usableKwh(battery?.ratingW ?? null, batteryId ? qty : 0);
  const backup = wholeHomeBackup({
    usableKwh: kwh,
    annualUsageKwh: view.annualUsageKwh,
    outageDrawFactor: view.outageDrawFactor,
  });

  async function save(next: {
    batteryId?: string | null;
    batteryQty?: number;
    /** Hand the count back to the sizing rule — see the action's own note. */
    batteryQtyAuto?: boolean;
  }) {
    setBusy(true);
    try {
      const res = await setSolarDesignEquipmentAction({ leadId, ...next });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save.");
        // Put the optimistic state back where the server still has it.
        setBatteryId(view.batteryId);
        setQty(Math.max(1, view.batteryQty));
        return;
      }
      router.refresh();
    } catch {
      toast.error("Could not save.");
      setBatteryId(view.batteryId);
      setQty(Math.max(1, view.batteryQty));
    } finally {
      // In a finally. An action that throws must not latch the form shut.
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What we are installing
        </h4>

        {view.batteries.length === 0 ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            No batteries on the catalogue for this deal&rsquo;s lender. Add one
            in Settings → Solar Equipment, or approve one on the lender&rsquo;s
            vendor list.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Label htmlFor="storage-battery" className="text-xs">
                Battery
              </Label>
              <select
                id="storage-battery"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
                value={batteryId ?? ""}
                disabled={!canEdit || busy}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setBatteryId(id);
                  void save({ batteryId: id });
                }}
              >
                <option value="">Pick a battery</option>
                {view.batteries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                    {b.isDefault ? " · standard" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Only once there is a battery to count. A quantity beside an
                empty slot is a question with no meaning — the same rule the
                roof designer's picker follows. */}
            {batteryId && (
              <div className="w-28">
                <Label htmlFor="storage-qty" className="text-xs">
                  How many
                </Label>
                <select
                  id="storage-qty"
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
                  value={qty}
                  disabled={!canEdit || busy}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setQty(n);
                    void save({ batteryQty: n });
                  }}
                >
                  {/* Long enough to contain the number actually on the design:
                      a select with no matching option renders blank and reads
                      as "no batteries". */}
                  {Array.from(
                    { length: Math.max(6, qty) },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {busy && (
              <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        )}

        {/* WHERE THE COUNT CAME FROM, whenever it did not come from this rep.
            A number that changes on its own after a roof is redrawn is money
            appearing on a deal nobody typed — the same complaint the itemised
            adders were built to answer — so it says what it was measured from,
            and says so in kWh a rep can check against the bill. */}
        {batteryId && auto && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
            {auto.setByRep ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">Set by hand</span>
                {autoQty != null ? (
                  <span className="text-muted-foreground">
                    {`· sizing this home's night puts it at ${autoQty}`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    · nothing to size from on this deal yet
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save({ batteryQtyAuto: true })}
                    className="font-medium text-solar underline underline-offset-2 disabled:opacity-50"
                  >
                    Size it to the home
                  </button>
                )}
              </div>
            ) : auto.sized ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {isAutoSized ? "Sized to this home" : "Sizing this home"}
                </span>
                {` · ${auto.sized.nightKwhPerDay.toFixed(1)} kWh a night at ${auto.nightSharePct}% after dark, covered by ${auto.sized.qty} × ${auto.sized.coveredKwh.toLocaleString()} kWh`}
                {auto.sized.capped && " — capped, check the usage on this deal"}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Sized to each home, but this deal has no production or usage on
                it yet. Fill in the Energy step and the count follows.
              </p>
            )}
          </div>
        )}

        {/* THE STANDARD BATTERY, in one click, on an empty slot only.
            Setting a deal to solar + storage already fills the slot, so this is
            for the deal that was on that answer BEFORE the company starred a
            battery — it never passed through that moment, and there is nothing
            else that would ever offer it. */}
        {!batteryId && standard && canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBatteryId(standard.id);
              setQty(Math.max(1, autoQty ?? view.defaultQty));
              // The id ONLY. Sending a count would mark this deal as
              // hand-set and stand the sizing rule off it for good — and
              // this button is a click on a product, not a decision about
              // how many. The server writes the right count either way.
              void save({ batteryId: standard.id });
            }}
            className="flex items-center gap-2 rounded-lg border border-solar/40 bg-solar/5 px-3 py-2 text-sm font-medium hover:bg-solar/10 disabled:opacity-50"
          >
            <Star className="size-4 shrink-0 text-solar" aria-hidden />
            {`Add ${Math.max(1, autoQty ?? view.defaultQty)} × ${standard.label}`}
          </button>
        )}
      </section>

      {kwh > 0 && (
        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What that gives them
          </h4>

          <div className="flex items-baseline gap-2 rounded-xl border border-border bg-muted/30 p-4">
            <BatteryCharging className="size-5 self-center text-muted-foreground" />
            <span className="text-2xl font-semibold tabular-nums">
              {kwh.toFixed(1)}
            </span>
            <span className="text-sm text-muted-foreground">
              kWh of usable storage
            </span>
          </div>

          {backup == null ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              No usage on file, so the proposal cannot state how long this
              lasts. Fill in the Energy step and the runtime follows from the
              home&rsquo;s own use.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-3 rounded-xl border border-border px-4 py-2.5">
                <span className="text-sm">Whole home</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {(backup.loadWatts / 1000).toFixed(1)} kW
                </span>
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {backup.hours < 10
                    ? backup.hours.toFixed(1)
                    : Math.round(backup.hours)}{" "}
                  hrs
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {/* One template literal: JSX drops the space after `{expr}`. */}
                {`${Math.round(view.annualUsageKwh ?? 0).toLocaleString()} kWh a year averages ` +
                  `${(backup.averageLoadWatts / 1000).toFixed(1)} kW, and Settings quotes an outage ` +
                  `${Math.round((view.outageDrawFactor - 1) * 100)}% above that. Nobody types a ` +
                  `runtime — this is the figure the customer's proposal headlines.`}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
