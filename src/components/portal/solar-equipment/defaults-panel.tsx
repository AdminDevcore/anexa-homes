"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { Panel, SaveBar, SelectField, NumField, Hint, useDraft } from "@/components/portal/settings-kit";
import { PanelHeader } from "@/components/portal/settings-kit/panel-header";
import { setSolarEquipmentDefaultsAction } from "@/server/modules/solar/actions";
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
  canEdit,
}: {
  /** The whole hardware catalogue — retired rows included, so a retired default is visible. */
  items: Item[];
  defaultBatteryQty: number;
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
  const qtyBad = draft.battery !== NONE && (!Number.isInteger(qty) || qty < 1 || qty > 20);

  const set_ = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    if (!canEdit) return;
    set(k, v);
  };

  async function save() {
    if (qtyBad) return;
    setBusy(true);
    try {
      const res = await setSolarEquipmentDefaultsAction({
        moduleId: draft.module === NONE ? null : draft.module,
        inverterId: draft.inverter === NONE ? null : draft.inverter,
        batteryId: draft.battery === NONE ? null : draft.battery,
        ...(draft.battery === NONE ? {} : { defaultBatteryQty: qty }),
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

          {draft.battery !== NONE && (
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
          disabled={qtyBad}
          blockedReason={qtyBad ? "Batteries per system must be between 1 and 20." : undefined}
        />
      )}
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
