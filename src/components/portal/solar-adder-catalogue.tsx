"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wrench,
  Zap,
  Home,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ADDER_BASES,
  ADDER_BASIS_ORDER,
  type AdderBasis,
} from "@/lib/solar-adders";
import {
  deleteSolarEquipmentAction,
  reorderSolarAddersAction,
  setSolarEquipmentActiveAction,
  upsertSolarEquipmentAction,
} from "@/server/modules/solar/actions";

/**
 * The adders a company sells, as a rate sheet somebody maintains.
 *
 * SPLIT OUT of the equipment manager because an adder stopped being a piece of
 * equipment with a price. It is a priced RULE: how the money is worked out, the
 * words a homeowner reads, and the system size that puts it on a deal by
 * itself. Those fields on the three-column grid the modules share turned that
 * grid into a form where half the boxes are greyed out whichever kind you are
 * adding.
 *
 * The order is the selling order — the picker a rep opens shows them exactly
 * like this — so it is edited here rather than by typing rank numbers.
 */

export type AdderItem = {
  id: string;
  label: string;
  description: string | null;
  basis: AdderBasis;
  priceCents: number;
  priceMillsPerWatt: number | null;
  costCents: number;
  autoApplyMinKw: number | null;
  autoApplyMaxKw: number | null;
  crossoverKind: string | null;
  rank: number;
  isActive: boolean;
};

/** What the rate sheet says this one costs: "$2,700", "$10.00/ft", "−$500". */
export function catalogueRateLabel(item: {
  basis: AdderBasis;
  priceCents: number;
  priceMillsPerWatt: number | null;
}): string {
  if (item.basis === "perWatt") {
    const dollars = (item.priceMillsPerWatt ?? 0) / 1000;
    return `$${dollars.toFixed(3).replace(/0$/, "")}/W`;
  }
  const money = `$${(item.priceCents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
  if (item.basis === "perFoot") return `${money}/ft`;
  if (item.basis === "perUnit") return `${money} each`;
  if (item.basis === "discount") return `−${money}`;
  return money;
}

/** "under 5 kW", "5–8 kW", "8 kW and up" — the band, as a person would say it. */
export function bandLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null) return `under ${max} kW`;
  if (max == null) return `${min} kW and up`;
  return `${min}–${max} kW`;
}

export function SolarAdderCatalogue({
  items,
  canEdit,
}: {
  items: AdderItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<AdderItem | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const live = items.filter((i) => i.isActive);
  const retired = items.filter((i) => !i.isActive);

  /**
   * Move one adder a place up or down the selling order.
   *
   * Sends the WHOLE order rather than the one row's new rank — see
   * `reorderSolarAddersAction`. Only the live list is reordered: a retired adder
   * is not being sold, so where it sits in the order is not a question.
   */
  async function move(index: number, delta: number) {
    const next = [...live];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    const res = await reorderSolarAddersAction(next.map((i) => i.id));
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Adders</h3>
          <p className="text-xs text-muted-foreground">
            The extra work this company sells, in the order a rep is offered it. The top item is
            ranked #1.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New Adder
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Tagging an adder as <strong>Re-roof</strong> or <strong>MPU</strong> ties it to the
        crossover: picking it on a design raises the flag on the deal and offers the linked
        Roofing job, instead of quietly becoming a line item nobody follows up.
      </p>

      {items.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>
      )}

      {live.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {live.map((item, i) => (
            <AdderRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              busy={busy}
              onEdit={() => setEditing(item)}
              onMoveUp={i > 0 ? () => void move(i, -1) : null}
              onMoveDown={i < live.length - 1 ? () => void move(i, 1) : null}
            />
          ))}
        </ul>
      )}

      {items.length > 0 && live.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">
          Nothing sellable — everything here is retired.
        </p>
      )}

      {/* Retired adders stay listed, and stay readable. They are what last
          year's deals point at, so hiding them would make those deals harder to
          explain, not tidier. */}
      {retired.length > 0 && (
        <details className="rounded-lg border border-dashed border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            {retired.length} retired — still shown on the deals that already use{" "}
            {retired.length === 1 ? "it" : "them"}
          </summary>
          <ul className="divide-y divide-border px-3 pb-2">
            {retired.map((item) => (
              <AdderRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                busy={busy}
                onEdit={() => setEditing(item)}
                onMoveUp={null}
                onMoveDown={null}
              />
            ))}
          </ul>
        </details>
      )}

      {(creating || editing) && (
        <AdderDialog
          item={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function AdderRow({
  item,
  canEdit,
  busy,
  onEdit,
  onMoveUp,
  onMoveDown,
}: {
  item: AdderItem;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}) {
  const router = useRouter();
  const [working, setWorking] = React.useState(false);
  const band = bandLabel(item.autoApplyMinKw, item.autoApplyMaxKw);
  const disabled = busy || working;

  async function setActive(next: boolean) {
    setWorking(true);
    const res = await setSolarEquipmentActiveAction(item.id, next);
    setWorking(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.message ?? (next ? "Restored" : "Retired"));
    router.refresh();
  }

  async function remove() {
    setWorking(true);
    const res = await deleteSolarEquipmentAction(item.id);
    setWorking(false);
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success("Deleted");
    router.refresh();
  }

  return (
    <li
      className={`flex items-start gap-3 px-3 py-2.5 text-sm ${item.isActive ? "" : "opacity-60"}`}
    >
      {/* Up/down rather than a drag handle: the same reorder, but it works from
          a keyboard, on a trackpad in somebody's kitchen, and on a phone. */}
      {canEdit && (onMoveUp || onMoveDown) && (
        <div className="flex flex-col pt-0.5">
          <button
            type="button"
            aria-label={`Move ${item.label} up`}
            disabled={!onMoveUp || disabled}
            onClick={() => onMoveUp?.()}
            className="rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move ${item.label} down`}
            disabled={!onMoveDown || disabled}
            onClick={() => onMoveDown?.()}
            className="rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}

      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Wrench className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{item.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {ADDER_BASES[item.basis].label}
          </span>
          {band && (
            <span className="rounded-full border chip-violet px-2 py-0.5 text-[11px] font-medium">
              auto · {band}
            </span>
          )}
          {item.crossoverKind === "reroof" && (
            <span className="inline-flex items-center gap-1 rounded-full border chip-warning px-2 py-0.5 text-[11px] font-medium">
              <Home className="size-3" /> crossover
            </span>
          )}
          {item.crossoverKind === "mpu" && (
            <span className="inline-flex items-center gap-1 rounded-full border chip-warning px-2 py-0.5 text-[11px] font-medium">
              <Zap className="size-3" /> crossover
            </span>
          )}
          {!item.isActive && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              retired
            </span>
          )}
        </div>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="text-right">
          <span className="block font-medium tabular-nums">
            {item.basis === "discount" ? "" : "+ "}
            {catalogueRateLabel(item)}
          </span>
          {item.costCents > 0 && (
            <span className="block text-[11px] text-muted-foreground tabular-nums">
              cost ${(item.costCents / 100).toLocaleString()}
            </span>
          )}
        </span>
        {canEdit && (
          <>
            <Button variant="ghost" size="sm" onClick={onEdit} disabled={disabled} title="Edit">
              <Pencil className="size-4" />
            </Button>
            {/* Retiring sits before delete on purpose: it stops new designs
                picking the adder while leaving every existing quote intact. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              title={
                item.isActive
                  ? "Retire — hide from new designs, keep it on existing deals"
                  : "Make sellable again"
              }
              onClick={() => void setActive(!item.isActive)}
            >
              {item.isActive ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              title="Delete permanently"
              onClick={() => void remove()}
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** A tick with its sentence beside it, and the whole thing clickable. */
function Flag({
  id,
  checked,
  onChange,
  children,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        <Label htmlFor={id} className="text-sm font-normal">
          {children}
        </Label>
      </div>
      {hint && <p className="pl-6 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const EMPTY = {
  label: "",
  description: "",
  basis: "flat" as AdderBasis,
  price: "",
  cost: "",
  perWatt: "",
  minKw: "",
  maxKw: "",
  autoApply: false,
  crossoverKind: "",
};

/**
 * The one form an adder is created and edited through.
 *
 * A dialog rather than an inline row, because one of these fields is a rule
 * with consequences — an auto-apply band silently puts money on somebody's
 * deal — and a rule is worth the full width of a sentence explaining it.
 */
function AdderDialog({ item, onClose }: { item: AdderItem | null; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState(() =>
    item
      ? {
          label: item.label,
          description: item.description ?? "",
          basis: item.basis,
          price: item.priceCents ? String(item.priceCents / 100) : "",
          cost: item.costCents ? String(item.costCents / 100) : "",
          perWatt:
            item.priceMillsPerWatt != null ? String(item.priceMillsPerWatt / 1000) : "",
          minKw: item.autoApplyMinKw != null ? String(item.autoApplyMinKw) : "",
          maxKw: item.autoApplyMaxKw != null ? String(item.autoApplyMaxKw) : "",
          autoApply: item.autoApplyMinKw != null || item.autoApplyMaxKw != null,
          crossoverKind: item.crossoverKind ?? "",
        }
      : EMPTY
  );
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const meta = ADDER_BASES[f.basis];
  const isRate = f.basis === "perWatt";

  async function save() {
    if (!f.label.trim()) return toast.error("Give the adder a name.");
    setBusy(true);
    /**
     * The busy flag is cleared in `finally`, not after the await.
     *
     * A server action that THROWS — rather than returning `{ ok: false }` —
     * skips every line after it, and the flag latches on: the dialog is left
     * with a spinning button and every field disabled, and the only way out is
     * a page reload. Which is not a hypothetical: it is what this form did the
     * first time it was pointed at a server holding a stale Prisma client.
     */
    try {
      const res = await upsertSolarEquipmentAction(item?.id ?? null, {
        kind: "adder",
        manufacturer: null,
        model: f.label.trim(),
        description: f.description.trim() || null,
        adderBasis: f.basis,
        costCents: f.cost ? Math.round(Number(f.cost) * 100) : 0,
        priceCents: isRate ? 0 : f.price ? Math.round(Number(f.price) * 100) : 0,
        // Dollars per watt on screen, mills per watt on the wire. $0.05 → 50.
        priceMillsPerWatt: isRate && f.perWatt.trim() !== "" ? Math.round(Number(f.perWatt) * 1000) : null,
        // Both cleared when the rule is switched off, so an unticked box cannot
        // leave a band behind that keeps firing.
        autoApplyMinKw: f.autoApply && f.minKw.trim() !== "" ? Number(f.minKw) : null,
        autoApplyMaxKw: f.autoApply && f.maxKw.trim() !== "" ? Number(f.maxKw) : null,
        crossoverKind: (f.crossoverKind || null) as "reroof" | "mpu" | null,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success(item ? "Saved" : "Adder created");
      onClose();
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Adder" : "New Adder"}</DialogTitle>
          <DialogDescription>
            What the extra work is called, how it is priced, and when it lands on a deal.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
          <div className="space-y-1">
            <Label htmlFor="adder-name">Name</Label>
            <Input
              id="adder-name"
              autoFocus
              value={f.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="e.g. Trenching Adder"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="adder-type">Type</Label>
            <select
              id="adder-type"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={f.basis}
              onChange={(e) => set("basis", e.target.value as AdderBasis)}
            >
              {ADDER_BASIS_ORDER.map((b) => (
                <option key={b} value={b}>
                  {ADDER_BASES[b].label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {f.basis === "perFoot" && "A rate per foot. The rep enters the run length on the deal."}
              {f.basis === "perWatt" && "Follows the array — the charge moves when the design does."}
              {f.basis === "perUnit" && "An amount for one. The rep enters how many on the deal."}
              {f.basis === "flat" && "One amount, whatever the system size."}
              {f.basis === "custom" && "Priced on the day. The rep types the amount on the deal."}
              {f.basis === "discount" && "Comes off the price. Enter it as a positive number."}
            </p>
          </div>

          <Flag
            id="adder-auto"
            checked={f.autoApply}
            onChange={(v) => set("autoApply", v)}
            hint="Lands on a deal by itself whenever the drawn array falls in this band, and comes back off when it does not."
          >
            Auto-apply by system size?
          </Flag>
          {f.autoApply && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="adder-min-kw">
                  From (kW DC)
                </Label>
                <Input
                  id="adder-min-kw"
                  type="number"
                  step="0.1"
                  placeholder="any"
                  value={f.minKw}
                  onChange={(e) => set("minKw", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="adder-max-kw">
                  Up to (kW DC)
                </Label>
                <Input
                  id="adder-max-kw"
                  type="number"
                  step="0.1"
                  placeholder="any"
                  value={f.maxKw}
                  onChange={(e) => set("maxKw", e.target.value)}
                />
              </div>
              <p className="col-span-2 text-[11px] text-muted-foreground">
                Leave one blank for an open end — blank &ldquo;from&rdquo; and 5 in
                &ldquo;up to&rdquo; is a small-system charge under 5 kW. The lower figure counts,
                the upper one does not, so bands written back to back never both fire.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="adder-description">Description</Label>
            <Textarea
              id="adder-description"
              rows={2}
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What the work actually is, in your own words."
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="adder-price">
                {isRate ? "Price ($ per watt)" : meta.unit ? `Price ($ per ${meta.unit})` : "Price"}
              </Label>
              {isRate ? (
                <Input
                  id="adder-price"
                  type="number"
                  step="0.001"
                  placeholder="0.05"
                  value={f.perWatt}
                  onChange={(e) => set("perWatt", e.target.value)}
                />
              ) : (
                <Input
                  id="adder-price"
                  type="number"
                  step="0.01"
                  value={f.price}
                  onChange={(e) => set("price", e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="adder-cost">Cost to us</Label>
              <Input
                id="adder-cost"
                type="number"
                step="0.01"
                value={f.cost}
                onChange={(e) => set("cost", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="adder-crossover">Crossover</Label>
            <select
              id="adder-crossover"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={f.crossoverKind}
              onChange={(e) => set("crossoverKind", e.target.value)}
            >
              <option value="">— none —</option>
              <option value="reroof">Re-roof</option>
              <option value="mpu">MPU / derate</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {item ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
