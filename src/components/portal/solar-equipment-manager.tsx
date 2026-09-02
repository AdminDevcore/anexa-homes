"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PanelsTopLeft, Plus, Star, Wrench } from "lucide-react";
import type { SolarEquipmentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/portal/ui";
import {
  ChoiceCards,
  Hint,
  ItemRail,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
} from "@/components/portal/settings-kit";
import {
  reorderSolarAddersAction,
  upsertSolarEquipmentAction,
} from "@/server/modules/solar/actions";
import { HardwarePanel, HARDWARE_TABS, type HardwareTab } from "./solar-equipment/hardware-panel";
import { AdderPanel, ADDER_TABS, type AdderTab } from "./solar-equipment/adder-panel";
import {
  KINDS,
  catalogueRateLabel,
  itemName,
  money,
  type AdderItem,
  type Item,
  type Lender,
} from "./solar-equipment/types";

export type { Item, AdderItem, Lender } from "./solar-equipment/types";

/**
 * The whole solar catalogue — hardware and adders — behind one rail.
 *
 * Two screens' worth of content used to sit stacked on this page: a grid of
 * modules, inverters and batteries in dense rows of icon buttons, and an adder
 * rate sheet below it whose rows opened a dialog. Neither could EDIT anything:
 * a price typed wrong meant deleting the row and adding it again, which the
 * delete refuses the moment one deal has used it.
 *
 * One rail, four groups, and the panel gets the window — so every field a
 * catalogue item has is reachable, and the adder rules that quietly put money
 * on a deal get the width of the sentence that explains them.
 */
export function SolarEquipmentManager({
  items,
  adders,
  lenders,
  canEdit,
  initialItemId,
  initialTab,
}: {
  items: Item[];
  adders: AdderItem[];
  lenders: Lender[];
  canEdit: boolean;
  /** Read on the SERVER — see the note on the page. */
  initialItemId?: string | null;
  initialTab?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const everything = React.useMemo(
    () => [
      ...items.map((i) => ({ id: i.id, kind: i.kind, active: i.isActive })),
      ...adders.map((a) => ({ id: a.id, kind: "adder" as const, active: a.isActive })),
    ],
    [items, adders]
  );

  const firstLive = everything.find((e) => e.active) ?? everything[0] ?? null;
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialItemId ?? firstLive?.id ?? null
  );

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  const selectedAdder = adders.find((a) => a.id === selectedId) ?? null;
  const fallback = selectedItem || selectedAdder ? null : firstLive;
  const openItem = selectedItem ?? items.find((i) => i.id === fallback?.id) ?? null;
  const openAdder = selectedAdder ?? adders.find((a) => a.id === fallback?.id) ?? null;

  // Tabs differ between the two kinds of panel, so the URL carries one string
  // and each panel takes the one it recognises.
  const [tab, setTab] = React.useState<string>(() => initialTab ?? "details");
  const hardwareTab: HardwareTab = (HARDWARE_TABS as readonly string[]).includes(tab)
    ? (tab as HardwareTab)
    : "details";
  const adderTab: AdderTab = (ADDER_TABS as readonly string[]).includes(tab)
    ? (tab as AdderTab)
    : "details";

  const idInUrl = openItem?.id ?? openAdder?.id ?? null;
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (idInUrl) p.set("item", idInUrl);
    else p.delete("item");
    p.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [idInUrl, tab]);

  /**
   * Move one adder a place up or down the selling order.
   *
   * Sends the WHOLE order rather than the one row's new rank — rank is a number
   * per row, and nudging one means rewriting its neighbour too.
   */
  const liveAdders = adders.filter((a) => a.isActive);
  async function moveAdder(id: string, delta: number) {
    const index = liveAdders.findIndex((a) => a.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= liveAdders.length) return;
    const next = [...liveAdders];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try {
      const res = await reorderSolarAddersAction(next.map((a) => a.id));
      if (!res.ok) return toast.error(res.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0 && adders.length === 0) {
    return (
      <EmptyState
        icon={PanelsTopLeft}
        title="Nothing in the catalogue yet"
        description="Add the modules, inverters and batteries your reps build systems from, and the extra work you sell alongside them. Until there is at least one module, the layout designer has nothing to place and a system cannot be sized."
        action={canEdit ? <AddItemDialog onAdded={setSelectedId} /> : undefined}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const hit = (s: string) => q === "" || s.toLowerCase().includes(q);

  const shownAdders = adders.filter((a) => hit(a.label));
  const liveShownAdders = shownAdders.filter((a) => a.isActive);
  const retiredHardware = items.filter((i) => !i.isActive && hit(itemName(i)));
  const retiredAdders = shownAdders.filter((a) => !a.isActive);
  const anyShown =
    KINDS.some((k) => items.some((i) => i.kind === k.value && i.isActive && hit(itemName(i)))) ||
    liveShownAdders.length > 0 ||
    retiredHardware.length > 0 ||
    retiredAdders.length > 0;

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Solar catalogue"
          add={canEdit ? <AddItemDialog onAdded={setSelectedId} full /> : undefined}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Find equipment or an adder"
          showSearch={items.length + adders.length > 6}
        >
          {KINDS.map((k) => {
            const mine = items.filter((i) => i.kind === k.value && i.isActive && hit(itemName(i)));
            if (mine.length === 0) return null;
            return (
              <React.Fragment key={k.value}>
                <RailGroup>
                  {k.label} ({mine.length})
                </RailGroup>
                {mine.map((i) => (
                  <HardwareRailRow
                    key={i.id}
                    item={i}
                    lenders={lenders}
                    selected={i.id === idInUrl}
                    onSelect={() => setSelectedId(i.id)}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {liveShownAdders.length > 0 && (
            <>
              <RailGroup>Adders ({liveShownAdders.length}) · selling order</RailGroup>
              {liveShownAdders.map((a) => (
                <AdderRailRow
                  key={a.id}
                  adder={a}
                  selected={a.id === idInUrl}
                  onSelect={() => setSelectedId(a.id)}
                />
              ))}
            </>
          )}

          {/* Retired items stay listed, and stay readable. They are what last
              year's deals point at, so hiding them would make those deals
              harder to explain, not tidier. */}
          {(retiredHardware.length > 0 || retiredAdders.length > 0) && (
            <>
              <RailGroup>Retired ({retiredHardware.length + retiredAdders.length})</RailGroup>
              {retiredHardware.map((i) => (
                <HardwareRailRow
                  key={i.id}
                  item={i}
                  lenders={lenders}
                  selected={i.id === idInUrl}
                  onSelect={() => setSelectedId(i.id)}
                />
              ))}
              {retiredAdders.map((a) => (
                <AdderRailRow
                  key={a.id}
                  adder={a}
                  selected={a.id === idInUrl}
                  onSelect={() => setSelectedId(a.id)}
                />
              ))}
            </>
          )}

          {!anyShown && <RailNoMatch query={query} />}
        </ItemRail>
      }
    >
      <div className="min-w-0 space-y-4">
        {lenders.length === 0 && (
          <Hint className="rounded-lg border border-dashed border-border p-3">
            No lenders set up yet. Add them under{" "}
            <Link href="/portal/settings/solar-lenders" className="underline underline-offset-2">
              Lenders
            </Link>{" "}
            to tag which approved-vendor lists each item appears on.
          </Hint>
        )}

        {openItem && (
          <HardwarePanel
            // Keyed so switching items remounts the panel: a draft belongs to
            // the item it was seeded from.
            key={openItem.id}
            item={openItem}
            lenders={lenders}
            canEdit={canEdit}
            tab={hardwareTab}
            onTabChange={setTab}
            onDeleted={() => setSelectedId(null)}
          />
        )}

        {openAdder && (
          <AdderPanel
            key={openAdder.id}
            adder={openAdder}
            canEdit={canEdit && !busy}
            rank={
              openAdder.isActive ? liveAdders.findIndex((a) => a.id === openAdder.id) + 1 : null
            }
            of={liveAdders.length}
            onMove={openAdder.isActive ? (d) => void moveAdder(openAdder.id, d) : null}
            tab={adderTab}
            onTabChange={setTab}
            onDeleted={() => setSelectedId(null)}
          />
        )}
      </div>
    </RailLayout>
  );
}

/**
 * One piece of hardware in the rail.
 *
 * The second line is what the old grid could not say at a glance: an item on
 * nobody's approved-vendor list is hidden from every financed deal, and that
 * was only discoverable by counting the chips on its row.
 */
function HardwareRailRow({
  item,
  lenders,
  selected,
  onSelect,
}: {
  item: Item;
  lenders: Lender[];
  selected: boolean;
  onSelect: () => void;
}) {
  const approved = item.lenderIds.length;
  const needsWork = item.isActive && (lenders.length > 0 ? approved === 0 : !item.priceCents);

  return (
    <RailRow
      title={itemName(item)}
      subtitle={
        needsWork
          ? lenders.length > 0 && approved === 0
            ? "no lender approves it"
            : "no price"
          : [item.ratingW ? `${item.ratingW}W` : null, item.priceCents ? money(item.priceCents) : null]
              .filter(Boolean)
              .join(" · ")
      }
      mark={
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white">
          {item.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photoUrl} alt="" className="size-full object-contain p-0.5" />
          ) : (
            <PanelsTopLeft className="size-3.5 text-muted-foreground/50" aria-hidden />
          )}
        </span>
      }
      selected={selected}
      onSelect={onSelect}
      needsWork={needsWork}
      muted={!item.isActive}
      trailing={
        item.isDefault ? (
          <Star className="size-3 shrink-0 fill-gold text-gold" aria-label="Default" />
        ) : undefined
      }
    />
  );
}

function AdderRailRow({
  adder,
  selected,
  onSelect,
}: {
  adder: AdderItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <RailRow
      title={adder.label}
      subtitle={`${adder.basis === "discount" ? "" : "+ "}${catalogueRateLabel(adder)}`}
      mark={
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Wrench className="size-3.5" />
        </span>
      }
      selected={selected}
      onSelect={onSelect}
      muted={!adder.isActive}
    />
  );
}

/** Adding to the catalogue: which kind, and enough to open it on. */
function AddItemDialog({ onAdded, full }: { onAdded: (id: string) => void; full?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<SolarEquipmentKind | "adder">("module");
  const [manufacturer, setManufacturer] = React.useState("");
  const [model, setModel] = React.useState("");
  const [ratingW, setRatingW] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const isAdder = kind === "adder";
  const meta = KINDS.find((k) => k.value === kind);

  async function add() {
    if (!model.trim()) return toast.error(isAdder ? "Give the adder a name." : "Model is required.");
    setBusy(true);
    try {
      const res = await upsertSolarEquipmentAction(
        null,
        isAdder
          ? {
              kind: "adder",
              manufacturer: null,
              model: model.trim(),
              // A flat adder with a price of zero is the one shape the action
              // takes without a price — its rate is filled in on the panel next.
              adderBasis: "custom",
            }
          : {
              kind: kind as SolarEquipmentKind,
              manufacturer: manufacturer.trim() || null,
              model: model.trim(),
              ratingW: ratingW.trim() === "" ? null : Number(ratingW),
            }
      );
      if (!res.ok) return toast.error(res.error, { duration: 9000 });
      if (res.id) onAdded(res.id);
      toast.success(`${model.trim()} added`);
      setManufacturer("");
      setModel("");
      setRatingW("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={full ? "w-full" : undefined}>
          <Plus className="size-4" /> New item
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to the catalogue</DialogTitle>
          <DialogDescription>
            Enough to open it on. Its price, dimensions, photo and approved-vendor lists are filled
            in on the panel next.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ChoiceCards
            name="new-equipment-kind"
            legend="What is it?"
            value={kind}
            onChange={(v) => setKind(v)}
            columns={2}
            options={[
              ...KINDS.map((k) => ({
                value: k.value as SolarEquipmentKind | "adder",
                label: k.label,
                detail:
                  k.value === "module"
                    ? "Sized and laid out on the roof. Needs a wattage."
                    : k.value === "inverter"
                      ? "Converts the array's output."
                      : "Storage. Priced per battery on a storage-only deal.",
              })),
              {
                value: "adder" as SolarEquipmentKind | "adder",
                label: "Adder",
                detail: "Extra work sold alongside the system — a priced rule, not a product.",
              },
            ]}
          />

          {!isAdder && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="new-eq-manufacturer">
                  Manufacturer
                </Label>
                <Input
                  id="new-eq-manufacturer"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="new-eq-rating">
                  {meta?.ratingLabel}
                </Label>
                <Input
                  id="new-eq-rating"
                  type="number"
                  value={ratingW}
                  onChange={(e) => setRatingW(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-eq-model">
              {isAdder ? "Name" : "Model"}
            </Label>
            <Input
              id="new-eq-model"
              value={model}
              placeholder={isAdder ? "e.g. Trenching Adder" : "e.g. Powerwall 3"}
              onChange={(e) => setModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
            />
          </div>

          {kind === "module" && (
            <Hint>
              A module needs a wattage above zero — every downstream figure, from system size to
              price, is derived from it.
            </Hint>
          )}
          {isAdder && (
            <Hint>
              It starts as a custom adder — priced by the rep on the day — so it can be created with
              no amount. Pick how it is really priced on the Pricing tab.
            </Hint>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={add} disabled={busy || !model.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
