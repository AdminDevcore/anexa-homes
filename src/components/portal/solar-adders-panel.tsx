"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Check, ListPlus, Loader2, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ADDER_BASES,
  ADDER_BASIS_ORDER,
  adderAmountCents,
  adderCountLabel,
  adderPriceUnit,
  adderRateLabel,
  adderTotals,
  dollarsToMillsPerWatt,
  millsPerWattToDollars,
  type AdderBasis,
  type AdderLine,
} from "@/lib/solar-adders";
import {
  addDealAdderAction,
  removeDealAdderAction,
  syncDealCatalogueAddersAction,
  updateDealAdderAction,
} from "@/server/modules/solar/adder-actions";

/** One adder the company sells, as offered to a rep on a deal. */
export type AdderOption = {
  id: string;
  label: string;
  description: string | null;
  /** How the price is worked out — see `ADDER_BASES`. */
  basis: AdderBasis;
  /** The money column: whole amount, per unit, or per foot. Zero on per-watt. */
  priceCents: number;
  /** Tenths of a cent per installed watt, or null when the item is not per-watt. */
  priceMillsPerWatt: number | null;
  /** Pinned to the "Very common" tab in the picker. */
  isVeryCommon: boolean;
  /** This adder changes what the house uses, so the line takes a kWh figure. */
  consumptionAdjustable: boolean;
  /**
   * Added to the loan on top of a fixed-price partner's $/W, at its own price.
   * Shown at PICK time as well as on the line, because it is the difference
   * between a $7,000 roof the customer borrows and a $7,000 roof that comes out
   * of the company's margin.
   */
  financedOnTop: boolean;
};

export type DealAdderLine = AdderLine & {
  equipmentId: string | null;
  description: string | null;
  showOnProposal: boolean;
  consumptionKwhPerYear: number | null;
  autoApplied: boolean;
};

/**
 * `financedOnTop` rides in on `AdderLine`, and it is worth saying here why the
 * chip below matters: it is COPIED off the catalogue when the line is added.
 * Ticking the box in Settings therefore changes nothing on a line already on a
 * deal — deliberately, exactly like a price change — so a rep who needs an
 * existing roof line to ride on top has to remove it and add it again. The chip
 * is how they can tell which state a line is in without opening Settings.
 */

/**
 * The extra work on a deal, itemised.
 *
 * This replaced a single box labelled "Adders $". That box could not say what
 * the money was for, could not be checked against the catalogue, and went stale
 * the moment the array changed — a $0.05/W steep-roof charge is right for the
 * 8 kW system it was typed on and wrong for the 12 kW one the roof turned out
 * to hold, silently, on a number that feeds the contract price.
 *
 * Nothing here sends a total. The lines go to the server, the server prices
 * them against the system it has on file, and the figure that comes back is the
 * one the proposal will use — the same discipline as the panel count.
 */
export function SolarAddersPanel({
  leadId,
  canEdit,
  catalogue,
  lines,
  systemWatts,
  storedTotalCents,
}: {
  leadId: string;
  canEdit: boolean;
  catalogue: AdderOption[];
  lines: DealAdderLine[];
  /** DC watts as drawn. Per-watt adders are priced against this. */
  systemWatts: number;
  /** What `SolarFinance.adderTotalCents` currently holds, for the legacy case. */
  storedTotalCents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [custom, setCustom] = React.useState({
    label: "",
    amount: "",
    basis: "custom" as AdderBasis,
    rate: "",
    qty: "1",
    financedOnTop: false,
  });

  const totals = React.useMemo(() => adderTotals(lines, systemWatts), [lines, systemWatts]);

  /**
   * The catalogue adders that CHANGE what the house uses.
   *
   * Read off the catalogue rather than off the line, because whether an adder
   * takes a kWh figure is a property of what it is — an EV charger — not of
   * whether somebody has filled the box in yet. A line with no figure still has
   * to show the box, or it can never get one.
   */
  const consumptionIds = React.useMemo(
    () => new Set(catalogue.filter((o) => o.consumptionAdjustable).map((o) => o.id)),
    [catalogue]
  );

  /**
   * A deal priced before adders were itemised: a typed total, and nothing to
   * rebuild it from. It is shown as what it is rather than recomputed to zero,
   * and the first line added takes ownership of the figure.
   */
  const legacy = lines.length === 0 && storedTotalCents > 0;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast.error(res.error ?? "That did not save.");
    router.refresh();
  }

  async function addCustom() {
    const isRate = custom.basis === "perWatt";
    const amount = Number(custom.amount);
    const rate = Number(custom.rate);
    if (!custom.label.trim()) return toast.error("Give the line a name.");
    if (isRate ? !(rate > 0) : !(amount > 0)) return toast.error("Give it a price.");
    await run("add:custom", () =>
      addDealAdderAction({
        leadId,
        equipmentId: null,
        label: custom.label.trim(),
        basis: custom.basis,
        flatCents: isRate ? null : Math.round(amount * 100),
        millsPerWatt: isRate ? dollarsToMillsPerWatt(rate) : null,
        // Only a basis priced PER something carries a count; the server pins
        // the rest to one regardless, so this is the form agreeing with it.
        qty: ADDER_BASES[custom.basis].counted ? Math.max(1, Number(custom.qty) || 1) : 1,
        showOnProposal: false,
        // Only honoured on a ONE-OFF. A line picked off the catalogue takes the
        // catalogue's answer — see `addDealAdderAction`.
        financedOnTop: custom.basis === "discount" ? false : custom.financedOnTop,
      })
    );
    setCustom({
      label: "", amount: "", basis: "custom", rate: "", qty: "1", financedOnTop: false,
    });
    setAdding(false);
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Adders
        </h4>
        <span className="text-xs text-muted-foreground">
          {systemWatts > 0
            ? `priced against ${(systemWatts / 1000).toFixed(2)} kW`
            : "nothing drawn yet — per-watt adders price at zero"}
        </span>
      </div>

      {legacy && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <TriangleAlert className="mr-1 inline size-3.5 align-text-bottom" />
          This deal carries <strong>{usd(storedTotalCents)}</strong> of adders entered before they
          were itemised, so there is nothing here saying what it is for. Adding a line below
          replaces that figure with the lines.
        </p>
      )}

      {lines.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {totals.lines.map((l) => {
            const countLabel = adderCountLabel(l.basis);
            return (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{l.label}</span>
                {l.description && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {l.description}
                  </span>
                )}
              </span>
              {/* THE PRICE, and a rep can type it here.
                  It is copied off the catalogue when the line is added and then
                  belongs to this deal, which is the whole reason it is a copy —
                  a re-roof is a different number on every house, and a
                  catalogue row cannot hold a number that is different every
                  time. Without a box here the only prices reachable on a deal
                  were the ones somebody had already guessed in Settings, and an
                  adder priced at zero could not be priced at all.

                  What is being typed depends on the basis, exactly as the
                  stored column does: a per-watt line takes a RATE and every
                  other takes an amount. The resolved total stays on the right,
                  where it can disagree with the rate and show its working. */}
              {canEdit ? (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {l.basis === "discount" ? "−$" : "$"}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={l.basis === "perWatt" ? "0.001" : "1"}
                    aria-label={`Price for ${l.label}`}
                    className="h-7 w-24 text-sm"
                    defaultValue={
                      l.basis === "perWatt"
                        ? millsPerWattToDollars(l.millsPerWatt ?? 0)
                        : (l.flatCents ?? 0) / 100
                    }
                    onBlur={(e) => {
                      const typed = Number(e.target.value);
                      if (!Number.isFinite(typed) || typed < 0) return;
                      if (l.basis === "perWatt") {
                        const mills = Math.round(typed * 1000);
                        if (mills === (l.millsPerWatt ?? 0)) return;
                        void run(`price:${l.id}`, () =>
                          updateDealAdderAction({ leadId, id: l.id, millsPerWatt: mills })
                        );
                        return;
                      }
                      const cents = Math.round(typed * 100);
                      if (cents === (l.flatCents ?? 0)) return;
                      void run(`price:${l.id}`, () =>
                        updateDealAdderAction({ leadId, id: l.id, flatCents: cents })
                      );
                    }}
                  />
                  {adderPriceUnit(l.basis) && (
                    <span className="text-[11px] text-muted-foreground">
                      {adderPriceUnit(l.basis)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{adderRateLabel(l)}</span>
              )}
              {l.basis === "perWatt" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  follows the array
                </span>
              )}
              {/* Money the rep did not type has to say where it came from. An
                  unexplained line is the exact complaint itemised adders exist
                  to answer, and a size rule adding one silently reintroduces it. */}
              {l.autoApplied && (
                <span
                  className="rounded-full border chip-violet px-2 py-0.5 text-[11px] font-medium"
                  title="Added automatically because of the system size. Remove it and it stays off this deal."
                >
                  auto
                </span>
              )}
              {/* The one line whose money does NOT come out of a fixed-price
                  partner's rate. Two identical-looking roof lines can be priced
                  differently — one added before the box was ticked in Settings,
                  one after — and nothing else on this row would say so. */}
              {l.financedOnTop && (
                <span
                  className="rounded-full border chip-warning px-2 py-0.5 text-[11px] font-medium"
                  title="Financed on top of the lender's fixed or maximum $/W, at its own price, instead of coming out of the system price."
                >
                  on top
                </span>
              )}
              {l.consumptionKwhPerYear != null && l.consumptionKwhPerYear > 0 && (
                <span
                  className="rounded-full border chip-info px-2 py-0.5 text-[11px] font-medium"
                  title="Added to the household's yearly usage before offset is worked out"
                >
                  +{l.consumptionKwhPerYear.toLocaleString()} kWh/yr
                </span>
              )}
              {/* The count box only appears on a basis that HAS a count, and it
                  is labelled with what is being counted — "Qty" over a trenching
                  run is how 120 feet gets typed as 120 trenches. */}
              {countLabel ? (
                canEdit ? (
                  <span className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={10000}
                      aria-label={`${countLabel} for ${l.label}`}
                      className="h-7 w-20 text-sm"
                      defaultValue={l.qty}
                      onBlur={(e) => {
                        const qty = Math.max(1, Math.min(10_000, Number(e.target.value) || 1));
                        if (qty === l.qty) return;
                        void run(`qty:${l.id}`, () =>
                          updateDealAdderAction({ leadId, id: l.id, qty })
                        );
                      }}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {countLabel.toLowerCase()}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {l.qty} {countLabel.toLowerCase()}
                  </span>
                )
              ) : null}
              <span className="w-24 text-right font-medium tabular-nums">{usd(l.amountCents)}</span>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${l.label}`}
                  disabled={busy !== null}
                  onClick={() => void run(`rm:${l.id}`, () => removeDealAdderAction({ leadId, id: l.id }))}
                >
                  {busy === `rm:${l.id}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              )}
              {/* The kWh this adder adds to the year, on the line that sells it.
                  A charger quoted without it leaves the offset on the proposal
                  describing a house that never bought one. */}
              {canEdit && consumptionIds.has(l.equipmentId ?? "") && (
                <div className="flex w-full items-center gap-2 pl-1 text-[11px] text-muted-foreground">
                  <Label htmlFor={`kwh-${l.id}`} className="text-[11px] font-normal">
                    Extra usage
                  </Label>
                  <Input
                    id={`kwh-${l.id}`}
                    type="number"
                    min={0}
                    max={100000}
                    className="h-7 w-24 text-sm"
                    placeholder="e.g. 3000"
                    defaultValue={l.consumptionKwhPerYear ?? ""}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === "" ? null : Math.max(0, Math.min(100_000, Number(raw) || 0));
                      if ((l.consumptionKwhPerYear ?? null) === next) return;
                      void run(`kwh:${l.id}`, () =>
                        updateDealAdderAction({ leadId, id: l.id, consumptionKwhPerYear: next })
                      );
                    }}
                  />
                  <span>kWh a year, added to the home&rsquo;s usage before offset</span>
                </div>
              )}
            </li>
            );
          })}
          <li className="flex items-center gap-2 bg-muted/40 px-3 py-2 text-sm">
            <span className="flex-1 font-semibold">Total adders</span>
            <span className="text-xs text-muted-foreground">
              {systemWatts > 0 && `${(totals.ppwCents / 100).toFixed(2)} $/W`}
            </span>
            <span
              data-testid="adder-total"
              className="w-24 text-right font-semibold tabular-nums"
            >
              {usd(totals.totalCents)}
            </span>
            <span className="w-9" />
          </li>
        </ul>
      )}

      {canEdit && (
        <div className="space-y-2">
          {catalogue.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No adders in the catalogue yet.{" "}
              <Link href="/portal/settings/solar-equipment" className="font-medium underline">
                Add them in Settings
              </Link>{" "}
              so a rep picks rather than types.
            </p>
          ) : (
            /* ONE BUTTON, NOT A WALL OF CHIPS. Every catalogue adder used to be
               a chip laid out in this panel, which works at six of them and
               stops working at thirty: the price of the system ends up below a
               paragraph of pills a rep has to read all of to find the one they
               want. The picker holds the whole catalogue, searchable, and this
               panel goes back to listing what is actually on the quote. */
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setPicking(true)}
            >
              <ListPlus className="size-4" /> Choose adders
              <span className="text-muted-foreground">
                {catalogue.length} in the catalogue
              </span>
            </Button>
          )}

          {adding ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="adder-label">
                    What is it
                  </Label>
                  <Input
                    id="adder-label"
                    value={custom.label}
                    placeholder="e.g. Tree removal"
                    onChange={(e) => setCustom((c) => ({ ...c, label: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="adder-basis">
                    Priced
                  </Label>
                  <select
                    id="adder-basis"
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    value={custom.basis}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, basis: e.target.value as AdderBasis }))
                    }
                  >
                    {ADDER_BASIS_ORDER.map((b) => (
                      <option key={b} value={b}>
                        {ADDER_BASES[b].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="adder-amount">
                    {custom.basis === "perWatt"
                      ? "$ per watt"
                      : ADDER_BASES[custom.basis].unit
                        ? `$ per ${ADDER_BASES[custom.basis].unit}`
                        : "Amount $"}
                  </Label>
                  {custom.basis === "perWatt" ? (
                    <Input
                      id="adder-amount"
                      type="number"
                      step="0.001"
                      className="w-32"
                      value={custom.rate}
                      onChange={(e) => setCustom((c) => ({ ...c, rate: e.target.value }))}
                    />
                  ) : (
                    <Input
                      id="adder-amount"
                      type="number"
                      className="w-32"
                      value={custom.amount}
                      onChange={(e) => setCustom((c) => ({ ...c, amount: e.target.value }))}
                    />
                  )}
                </div>
                {/* Only shown on a basis that HAS a count, labelled with what is
                    being counted, so a 120-foot trench cannot be entered as 120
                    trenches. */}
                {adderCountLabel(custom.basis) && (
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor="adder-qty">
                      {adderCountLabel(custom.basis)}
                    </Label>
                    <Input
                      id="adder-qty"
                      type="number"
                      min={1}
                      className="w-24"
                      value={custom.qty}
                      onChange={(e) => setCustom((c) => ({ ...c, qty: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              {/* The one-off equivalent of the catalogue's own tick. A roof
                  priced on the day is still a roof, and on a fixed-price
                  partner it rides on the loan rather than out of the system
                  price — see `financedOnTop`. Hidden on a discount, which the
                  server refuses for the same reason. */}
              {custom.basis !== "discount" && (
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={custom.financedOnTop}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, financedOnTop: e.target.checked }))
                    }
                  />
                  <span>
                    Financed on top of the lender&rsquo;s fixed price — a roof. Added to the
                    loan at its own price instead of coming out of the system price.
                  </span>
                </label>
              )}
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => void addCustom()}>
                  {busy === "add:custom" && <Loader2 className="size-4 animate-spin" />} Add line
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> One-off adder
            </Button>
          )}

          {picking && (
            <AdderPicker
              leadId={leadId}
              catalogue={catalogue}
              lines={lines}
              systemWatts={systemWatts}
              onClose={() => setPicking(false)}
              onDone={() => {
                setPicking(false);
                router.refresh();
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The whole catalogue, in a window, with a box beside each one.
 *
 * A checkbox list is a STATE, not a stream of clicks: the rep ticks three,
 * unticks one, and presses Add once — so nothing is written until then, and
 * what is written is the difference between what the deal held and what the
 * ticks say. Closing without pressing Add changes nothing.
 *
 * Ticked-off means REMOVED. Unticking an adder that is on the deal takes the
 * line off it, which is the only reading of a checkbox that is not a lie; the
 * footer says how many are going each way before anything happens.
 *
 * One-off lines typed on this deal have no catalogue row behind them, so they
 * cannot appear here and are never touched by it — see
 * `syncDealCatalogueAddersAction`.
 */
function AdderPicker({
  leadId,
  catalogue,
  lines,
  systemWatts,
  onClose,
  onDone,
}: {
  leadId: string;
  catalogue: AdderOption[];
  lines: DealAdderLine[];
  systemWatts: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const onDealIds = React.useMemo(
    () => new Set(lines.map((l) => l.equipmentId).filter((id): id is string => id != null)),
    [lines]
  );
  const [ticked, setTicked] = React.useState<Set<string>>(() => new Set(onDealIds));
  const [q, setQ] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const commonCount = catalogue.filter((o) => o.isVeryCommon).length;
  /**
   * Which tab the picker opens on.
   *
   * "Very common" when the company has marked any, because six adders sell most
   * jobs and thirty is a list a rep reads all of to find one of them. Falls
   * straight to All when nothing is marked, rather than opening on an empty tab
   * that looks like an empty catalogue.
   */
  const [tab, setTab] = React.useState<"common" | "all">(commonCount > 0 ? "common" : "all");

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool =
      // A search is a search of the whole catalogue. Typing "trench" and being
      // told there is nothing, because trenching is not on the common tab, is
      // the worst answer this screen can give.
      needle || tab === "all" ? catalogue : catalogue.filter((o) => o.isVeryCommon);
    if (!needle) return pool;
    return pool.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.description ?? "").toLowerCase().includes(needle)
    );
  }, [catalogue, q, tab]);

  const toggle = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * What one item comes to on THIS array, at a count of one.
   *
   * Priced through the same function the deal lines are, so a per-foot adder
   * cannot come to one figure in the picker and another the moment it lands on
   * the quote. Feet and units are entered afterwards, on the line, so the
   * figure here is deliberately the price of one of them.
   */
  const amountOf = (o: AdderOption) =>
    adderAmountCents(
      {
        id: o.id,
        label: o.label,
        basis: o.basis,
        flatCents: o.basis === "perWatt" ? null : o.priceCents,
        millsPerWatt: o.basis === "perWatt" ? o.priceMillsPerWatt : null,
        qty: 1,
      },
      systemWatts
    );

  const tickedTotal = catalogue
    .filter((o) => ticked.has(o.id))
    .reduce((sum, o) => sum + amountOf(o), 0);

  const adding = [...ticked].filter((id) => !onDealIds.has(id)).length;
  const removing = [...onDealIds].filter((id) => !ticked.has(id)).length;

  async function apply() {
    setSaving(true);
    const res = await syncDealCatalogueAddersAction({ leadId, equipmentIds: [...ticked] });
    setSaving(false);
    if (!res.ok) return toast.error(res.error ?? "That did not save.");
    toast.success(
      adding === 0 && removing === 0
        ? "Nothing changed."
        : [
            adding > 0 ? `${adding} adder${adding === 1 ? "" : "s"} added` : null,
            removing > 0 ? `${removing} removed` : null,
          ]
            .filter(Boolean)
            .join(" · ")
    );
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose adders</DialogTitle>
          <DialogDescription>
            Tick the extra work this job carries. Prices come from the catalogue, and per-watt
            items are shown at{" "}
            {systemWatts > 0 ? `${(systemWatts / 1000).toFixed(2)} kW` : "no array yet"}.
          </DialogDescription>
        </DialogHeader>

        {commonCount > 0 && (
          <div className="flex gap-1 rounded-lg bg-muted/60 p-1 text-xs">
            {(["common", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 font-medium transition-colors",
                  tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "common" ? `Very common (${commonCount})` : `All (${catalogue.length})`}
              </button>
            ))}
          </div>
        )}

        {catalogue.length > 8 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search adders"
              aria-label="Search adders"
              className="pl-8"
            />
          </div>
        )}

        {/* Scrolls at a fixed height rather than growing the window: a
            catalogue of forty is a page-length dialog whose Add button is
            somewhere below the fold. */}
        <ul className="-mx-1 max-h-[45vh] space-y-0.5 overflow-y-auto px-1">
          {shown.map((o) => {
            const checked = ticked.has(o.id);
            return (
              <li key={o.id}>
                {/* The whole row is the control. A checkbox with a label beside
                    it gives a rep a 16px target on a laptop trackpad in
                    somebody's kitchen; the row is the same toggle, forty times
                    the area. `role=checkbox` on a button keeps Space, the
                    checked state and the announcement that a native box would
                    have had. */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    checked ? "border-foreground/25 bg-muted/60" : "border-transparent hover:bg-muted/40"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                    )}
                  >
                    {checked && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.label}</span>
                    {o.description && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                    <span className="block text-[11px] text-muted-foreground">
                      {o.basis === "perWatt"
                        ? `$${millsPerWattToDollars(o.priceMillsPerWatt ?? 0).toFixed(3).replace(/0$/, "")}/W · follows the array`
                        : ADDER_BASES[o.basis].label.toLowerCase()}
                      {ADDER_BASES[o.basis].counted &&
                        ` · enter ${adderCountLabel(o.basis)?.toLowerCase()} on the line`}
                      {o.consumptionAdjustable && " · changes usage"}
                      {o.financedOnTop && " · financed on top of a fixed price"}
                      {onDealIds.has(o.id) && " · already on the quote"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-medium tabular-nums">
                    {usd(amountOf(o))}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              {q
                ? `Nothing in the catalogue matches “${q}”.`
                : "Nothing marked as very common yet."}
            </li>
          )}
        </ul>

        <div className="flex items-baseline justify-between gap-3 border-t border-border/70 pt-3 text-sm">
          <span className="text-xs text-muted-foreground">
            {ticked.size === 0
              ? "Nothing ticked"
              : `${ticked.size} ticked${removing > 0 ? ` · ${removing} coming off` : ""}`}
          </span>
          <span className="font-display text-lg font-semibold tabular-nums">{usd(tickedTotal)}</span>
        </div>

        <DialogFooter>
          <Link
            href="/portal/settings/solar-equipment"
            className="mr-auto self-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Manage the catalogue
          </Link>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            size="sm"
            disabled={saving || (adding === 0 && removing === 0)}
            onClick={() => void apply()}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {removing > 0 && adding === 0 ? "Remove from the quote" : "Add to the quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cents → "$2,700". Whole dollars: nobody quotes an adder to the cent. */
function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}
