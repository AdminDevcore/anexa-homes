"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const addFromCatalogue = (o: AdderOption) =>
    run(`add:${o.id}`, () =>
      addDealAdderAction({
        leadId,
        equipmentId: o.id,
        label: o.label,
        basis: o.priceMillsPerWatt ? "perWatt" : "flat",
        flatCents: o.priceMillsPerWatt ? null : o.priceCents,
        millsPerWatt: o.priceMillsPerWatt,
        qty: 1,
      })
    );

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

  /** Which catalogue items are not already on the deal. */
  const unused = catalogue.filter((o) => !lines.some((l) => l.equipmentId === o.id));

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
          {unused.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {unused.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void addFromCatalogue(o)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium",
                    "hover:bg-muted disabled:opacity-50"
                  )}
                >
                  {busy === `add:${o.id}` ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  {o.label}
                  <span className="text-muted-foreground">
                    {o.priceMillsPerWatt
                      ? `$${millsPerWattToDollars(o.priceMillsPerWatt).toFixed(3).replace(/0$/, "")}/W`
                      : usd(o.priceCents)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {catalogue.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No adders in the catalogue yet.{" "}
              <Link href="/portal/settings/solar-equipment" className="font-medium underline">
                Add them in Settings
              </Link>{" "}
              so a rep picks rather than types.
            </p>
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
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> One-off adder
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** Cents → "$2,700". Whole dollars: nobody quotes an adder to the cent. */
function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}
