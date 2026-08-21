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
  /** Flat price, cents. Zero when the item is priced per watt. */
  priceCents: number;
  /** Tenths of a cent per installed watt, or null when the item is flat. */
  priceMillsPerWatt: number | null;
};

export type DealAdderLine = AdderLine & { equipmentId: string | null };

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
  const [custom, setCustom] = React.useState({ label: "", amount: "", basis: "custom" as AdderBasis, rate: "" });

  const totals = React.useMemo(() => adderTotals(lines, systemWatts), [lines, systemWatts]);

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
        qty: 1,
      })
    );
    setCustom({ label: "", amount: "", basis: "custom", rate: "" });
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
          {totals.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{l.label}</span>
              <span className="text-xs text-muted-foreground">{adderRateLabel(l)}</span>
              {l.basis === "perWatt" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  follows the array
                </span>
              )}
              {canEdit ? (
                <Input
                  type="number"
                  min={1}
                  max={99}
                  aria-label={`Quantity for ${l.label}`}
                  className="h-7 w-14 text-sm"
                  value={l.qty}
                  onChange={(e) => {
                    const qty = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                    void run(`qty:${l.id}`, () => updateDealAdderAction({ leadId, id: l.id, qty }));
                  }}
                />
              ) : (
                <span className="text-xs text-muted-foreground">x{l.qty}</span>
              )}
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
            </li>
          ))}
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
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
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
                    <option value="custom">as an amount</option>
                    <option value="perWatt">per watt</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="adder-amount">
                    {custom.basis === "perWatt" ? "$ per watt" : "Amount $"}
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
              </div>
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

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? catalogue.filter((o) => o.label.toLowerCase().includes(needle)) : catalogue;
  }, [catalogue, q]);

  const toggle = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** What one item comes to on THIS array — a rate is not an amount. */
  const amountOf = (o: AdderOption) =>
    o.priceMillsPerWatt ? Math.round((o.priceMillsPerWatt * systemWatts) / 10) : o.priceCents;

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
                    <span className="block text-[11px] text-muted-foreground">
                      {o.priceMillsPerWatt
                        ? `$${millsPerWattToDollars(o.priceMillsPerWatt).toFixed(3).replace(/0$/, "")}/W · follows the array`
                        : "flat"}
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
              Nothing in the catalogue matches &ldquo;{q}&rdquo;.
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
