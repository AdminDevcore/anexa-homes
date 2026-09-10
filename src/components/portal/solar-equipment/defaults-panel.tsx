"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star } from "lucide-react";
import {
  Panel,
  SaveBar,
  SelectField,
  NumField,
  ToggleRow,
  Hint,
  useDraft,
} from "@/components/portal/settings-kit";
import { PanelHeader } from "@/components/portal/settings-kit/panel-header";
import { setSolarEquipmentDefaultsAction } from "@/server/modules/solar/actions";
import { autoBatteryCount } from "@/lib/solar-storage";
import { KINDS, itemName, type Item } from "./types";

/** The "nothing chosen" option — `<select>` has no null, so it needs a value. */
const NONE = "__none__";

/**
 * What a new design starts on, for all three kinds, on one screen.
 *
 * The star already existed. It was one line inside the overflow menu of one
 * catalogue item, which meant setting it required already knowing which item
 * you wanted, and READING it required opening items until you found the one
 * wearing a gold pill. On a catalogue of a hundred entries that is not a
 * control, it is a treasure hunt — and the question it answers ("what does a
 * rep's design begin with?") is asked about the catalogue as a whole, not about
 * any single row in it.
 *
 * So the same fact gets a screen where it reads as a fact: three dropdowns, the
 * current answer visible without clicking anything, and under each one the
 * sentence that says what that default actually does — because the three do
 * different things, and the difference is the part nobody could have guessed.
 *
 * The per-item star stays in the overflow menu. It is the faster gesture when
 * you are already looking at the product you want to promote, and both write
 * the same column.
 */
export function DefaultsPanel({
  items,
  defaultBatteryQty,
  autoBatteryQty,
  batteryNightSharePct,
  canEdit,
}: {
  /** The whole hardware catalogue — retired rows included, so a retired default is visible. */
  items: Item[];
  defaultBatteryQty: number;
  /** Size the count to each home's night load rather than quoting the flat one. */
  autoBatteryQty: boolean;
  batteryNightSharePct: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const currentFor = (kind: Item["kind"]) =>
    items.find((i) => i.kind === kind && i.isDefault) ?? null;

  // Not memoised: `useDraft` compares a JSON signature of the seed, not its
  // reference, so a fresh object every render is exactly what it expects — and
  // a reference check would throw away an edit on any refresh that changed
  // nothing. See the note on `useDraft`.
  const { draft, set, dirty, reset } = useDraft({
    module: currentFor("module")?.id ?? NONE,
    inverter: currentFor("inverter")?.id ?? NONE,
    battery: currentFor("battery")?.id ?? NONE,
    qty: String(defaultBatteryQty),
    auto: autoBatteryQty,
    night: String(batteryNightSharePct),
  });

  /**
   * Only sellable items are offerable — plus whatever is starred today.
   *
   * A retired product cannot be made the default (the action refuses it), but
   * one that was retired AFTER being starred has to stay in its own list or the
   * select would fall back to "None" and the next Save would silently clear a
   * default nobody meant to touch. The same rule the deal-side pickers follow.
   */
  const optionsFor = (kind: Item["kind"]) => [
    { value: NONE, label: "None — reps pick it themselves" },
    ...items
      .filter((i) => i.kind === kind && (i.isActive || i.isDefault))
      .map((i) => ({
        value: i.id,
        label: i.isActive ? itemName(i) : `${itemName(i)} — retired`,
      })),
  ];

  const qty = Number(draft.qty);
  const night = Number(draft.night);
  const hasBattery = draft.battery !== NONE;
  // Only the field that is on screen can block the Save. The flat count is not
  // shown while sizing is on, and a stale value in a hidden input must not be
  // what stops somebody saving a switch they can see.
  const qtyBad =
    hasBattery && !draft.auto && (!Number.isInteger(qty) || qty < 1 || qty > 20);
  const nightBad =
    hasBattery && draft.auto && (!Number.isFinite(night) || night < 5 || night > 95);
  const blocked = qtyBad || nightBad;

  const set_ = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    if (!canEdit) return;
    set(k, v);
  };

  async function save() {
    if (blocked) return;
    setBusy(true);
    try {
      const res = await setSolarEquipmentDefaultsAction({
        moduleId: draft.module === NONE ? null : draft.module,
        inverterId: draft.inverter === NONE ? null : draft.inverter,
        batteryId: draft.battery === NONE ? null : draft.battery,
        // The flat count is still written while sizing is on. It is what a deal
        // starts with in the window before there are any figures to size from,
        // and clearing it here would put those deals on a silent "1".
        ...(hasBattery ? { defaultBatteryQty: qty, autoBatteryQty: draft.auto } : {}),
        ...(hasBattery && draft.auto ? { batteryNightSharePct: night } : {}),
      });
      if (!res.ok) return toast.error(res.error, { duration: 9000 });
      toast.success("Defaults saved");
      router.refresh();
    } catch {
      // A server action that THROWS skips everything after it, and the busy
      // flag would latch on — leaving a panel nobody can save until a reload.
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = (kind: Item["kind"], id: string) =>
    id === NONE ? null : (items.find((i) => i.id === id) ?? null);

  const noneSet =
    draft.module === NONE && draft.inverter === NONE && draft.battery === NONE;

  return (
    <div className="min-w-0" data-testid="equipment-defaults-panel">
      <PanelHeader
        icon={Star}
        title="Default equipment"
        description="What a rep's design starts with before they touch anything. One per kind — set it once a year when the approved-vendor list lands, and no rep has to remember which panel you sell."
        pills={
          noneSet ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              nothing set — every design starts empty
            </span>
          ) : undefined
        }
      />

      <div className="mt-4 space-y-4">
        <Panel title="What a new design starts on">
          <SelectField
            label={`Default ${KINDS[0].one}`}
            value={draft.module}
            onChange={(v) => set_("module", v)}
            options={optionsFor("module")}
            disabled={!canEdit}
            hint="Sizes every design that has not named a panel of its own — the system size, the production and the price per watt all follow from it. Without one a rep can still pick a panel on the deal, but a design nobody has opened has no size at all."
          />

          <SelectField
            label={`Default ${KINDS[1].one}`}
            value={draft.inverter}
            onChange={(v) => set_("inverter", v)}
            options={optionsFor("inverter")}
            disabled={!canEdit}
            hint="Fills the slot nothing on a rep's screen asks for. No figure moves when an inverter is chosen, so it is the lender that notices: an application with an empty inverter is refused at the homeowner's own Qualify button."
          />

          <SelectField
            label={`Default ${KINDS[2].one}`}
            value={draft.battery}
            onChange={(v) => set_("battery", v)}
            options={optionsFor("battery")}
            disabled={!canEdit}
            hint="Lands on a deal the moment it is set to Solar + Storage or Storage only, and comes off again if it goes back to Solar. Never on a deal quoting panels only, and never over a battery a rep has already chosen."
          />

          {hasBattery && (
            <div className="space-y-4 border-t border-border pt-4">
              <ToggleRow
                label="Size the count to each home"
                description="How many batteries a deal quotes is worked out from what that house uses after dark, instead of the same number on every job."
                checked={draft.auto}
                onChange={(v) => set_("auto", v)}
                disabled={!canEdit}
                why={
                  <>
                    A flat count is right for the house it was chosen for and
                    wrong for the one next door. What a battery has to do is
                    carry the night, and the night is a property of the home —
                    so with this on, a bigger roof quotes more storage and a
                    small one quotes less, without a rep working anything out.
                  </>
                }
              />

              {draft.auto ? (
                <>
                  <div className="max-w-[16rem]">
                    <NumField
                      label="Used after dark %"
                      value={draft.night}
                      onChange={(v) => set_("night", v)}
                      step="1"
                      hint="What share of a day's power the house draws once the sun is down. The batteries have to cover it."
                    />
                    {nightBad && (
                      <Hint className="mt-1.5 text-amber-600 dark:text-amber-400">
                        Between 5% and 95%. A house draws neither nothing nor
                        everything after dark.
                      </Hint>
                    )}
                  </div>
                  <WorkedExample
                    battery={chosen("battery", draft.battery)}
                    nightSharePct={night}
                    flatQty={qty}
                  />
                </>
              ) : (
                <div className="max-w-[16rem]">
                  <NumField
                    label="Batteries per system"
                    value={draft.qty}
                    onChange={(v) => set_("qty", v)}
                    step="1"
                    hint={
                      chosen("battery", draft.battery)
                        ? `How many ${itemName(chosen("battery", draft.battery)!)} a storage deal starts with. A rep can change it on any deal.`
                        : "How many a storage deal starts with. A rep can change it on any deal."
                    }
                  />
                  {qtyBad && (
                    <Hint className="mt-1.5 text-amber-600 dark:text-amber-400">
                      Between 1 and 20. Zero batteries is not a system anybody can build.
                    </Hint>
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Hint>
          Changing a default never touches a deal that has already been built —
          it decides what the NEXT one starts with. Every catalogue item still
          carries the same star in its own &ldquo;&hellip;&rdquo; menu.
        </Hint>
      </div>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          onSave={() => void save()}
          onDiscard={reset}
          what="your default equipment"
          disabled={blocked}
          blockedReason={
            qtyBad
              ? "Batteries per system must be between 1 and 20."
              : nightBad
                ? "The share used after dark must be between 5% and 95%."
                : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * The rule, worked through on a system the reader recognises.
 *
 * A percentage and a division are not something anybody can picture, and the
 * question this panel has to answer before somebody flips the switch is "what
 * will my deals actually quote?". So it is answered directly, on three system
 * sizes spanning the ordinary range, with the arithmetic shown rather than
 * asserted — including the count the flat setting would have quoted, because
 * the whole decision is what changes.
 *
 * Sizes chosen as landmarks, not sampled from the pipeline: a table that moved
 * whenever a deal was sold would be a different explanation of the same rule
 * every time somebody opened the screen.
 */
function WorkedExample({
  battery,
  nightSharePct,
  flatQty,
}: {
  battery: Item | null;
  nightSharePct: number;
  flatQty: number;
}) {
  // Nothing to work through until the reader can see which battery it is
  // dividing by, and what that battery holds.
  if (!battery?.ratingW || !(battery.ratingW > 0)) return null;
  if (!Number.isFinite(nightSharePct) || nightSharePct < 5 || nightSharePct > 95) return null;

  const perUnitKwh = battery.ratingW / 1000;
  const rows = [12_000, 20_000, 34_000].map((basisKwh) => {
    const sized = autoBatteryCount({ basisKwh, nightSharePct, batteryRatingWh: battery.ratingW });
    return { basisKwh, sized };
  });

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium">
        {`What that quotes, on ${itemName(battery)} at ${perUnitKwh.toLocaleString()} kWh each`}
      </p>
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="font-normal">A year of power</th>
            <th className="font-normal">Night load</th>
            <th className="font-normal">Batteries</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ basisKwh, sized }) => (
            <tr key={basisKwh} className="border-t border-border/60">
              <td className="py-1">{`${basisKwh.toLocaleString()} kWh`}</td>
              <td className="py-1">
                {sized ? `${sized.nightKwhPerDay.toFixed(1)} kWh a night` : "—"}
              </td>
              <td className="py-1 font-medium">
                {sized ? `${sized.qty} · ${sized.coveredKwh.toLocaleString()} kWh` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Hint className="mt-2">
        {`Rounded up, always — a part of a battery is not something anybody installs. Today every one of these deals quotes ${flatQty}.`}
      </Hint>
    </div>
  );
}

/**
 * The one line the rail row shows under "Default equipment".
 *
 * A COUNT, not the three names. Three product names run past two hundred
 * characters and the rail is fourteen wide, so naming them showed the module
 * and an ellipsis — which reads as "the inverter and battery are unset" whether
 * or not they are. The count is short enough to survive the truncation, and the
 * names are one click away on the panel itself.
 */
export function defaultsSummary(items: Item[]): string {
  const set = (["module", "inverter", "battery"] as const).filter((kind) =>
    items.some((i) => i.kind === kind && i.isDefault)
  ).length;
  if (set === 0) return "None set — designs start empty";
  if (set === 3) return "Module, inverter and battery set";
  return `${set} of 3 set`;
}
