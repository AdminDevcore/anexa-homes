"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, LayoutGrid, ArrowRightCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { computeEstimate, formatEstimateDollars, ESTIMATE_UNITS } from "@/lib/estimate";
import type { EstimateDTO, EstimateLineDTO, EstimateCatalogOption } from "@/server/modules/estimates/queries";
import {
  addEstimateLineAction,
  addCatalogItemsAction,
  updateEstimateLineAction,
  deleteEstimateLineAction,
  updateEstimateAction,
  applyEstimateAsPriceAction,
} from "@/server/modules/estimates/actions";

type Props = {
  leadId: string;
  estimate: EstimateDTO | null;
  /** Offered in the picker before an estimate row exists. */
  catalog: EstimateCatalogOption[];
  canEdit: boolean;
  dealType: "cash" | "insurance";
  /** Insurance deals write the total to the job's deal value, which needs a job. */
  hasProject: boolean;
};

const cell =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none disabled:opacity-60";

export function EstimatePanel({ leadId, estimate, catalog, canEdit, dealType, hasProject }: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const lines = estimate?.lines ?? [];
  const canSeeCosts = estimate?.canSeeCosts ?? false;
  const discountCents = estimate?.discountCents ?? 0;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    router.refresh();
  }

  const calc = computeEstimate(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      costPerUnitCents: l.catalogItemId ? (estimate?.costPrices[l.catalogItemId] ?? 0) : 0,
      category: l.category,
    })),
    { discountCents }
  );

  async function pushPrice() {
    setBusy("price");
    const res = await applyEstimateAsPriceAction(leadId);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(
      res.target === "proposal"
        ? `Proposal price set to ${formatEstimateDollars(res.totalCents)}.`
        : `Deal value set to ${formatEstimateDollars(res.totalCents)}.`
    );
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        What we would <strong>charge</strong> for this job, priced line by line.{" "}
        {dealType === "cash"
          ? "Send the total to the proposal when it's ready and the customer's price is already filled in."
          : "Useful before the carrier's scope arrives — it's our number, not theirs."}
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <CatalogPicker
            leadId={leadId}
            catalog={catalog}
            alreadyAdded={new Set(lines.map((l) => l.catalogItemId).filter(Boolean) as string[])}
            onDone={() => router.refresh()}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "add"}
            onClick={() => run("add", () => addEstimateLineAction({ leadId }))}
          >
            {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add line
          </Button>
          {canSeeCosts && estimate && estimate.costTemplates.length > 0 && (
            <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Cost prices
              <select
                value={estimate.costTemplateId ?? ""}
                onChange={(e) =>
                  run("tpl", () => updateEstimateAction({ leadId, costTemplateId: e.target.value || null }))
                }
                className="min-w-[10rem] rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="">No cost template</option>
                {estimate.costTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground shadow-[inset_0_-1px_0_0_var(--border)]">
              <th className="bg-card px-3 py-2 font-medium">Category</th>
              <th className="bg-card px-3 py-2 font-medium">Description</th>
              <th className="bg-card px-3 py-2 text-right font-medium">Qty</th>
              <th className="bg-card px-3 py-2 font-medium">Unit</th>
              <th className="bg-card px-3 py-2 text-right font-medium">Price $/u</th>
              <th className="bg-card px-3 py-2 text-right font-medium">Line total</th>
              {canSeeCosts && <th className="bg-card px-3 py-2 text-right font-medium">Cost</th>}
              {canEdit && <th className="w-8 bg-card px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {lines.length === 0 && (
              <tr>
                <td colSpan={canSeeCosts ? 8 : 7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nothing priced yet.{" "}
                  {canEdit && "“Add from catalog” to pull the items you use, then set Qty and Price."}
                </td>
              </tr>
            )}
            {lines.map((line) => (
              <EstimateRow
                key={line.id}
                leadId={leadId}
                line={line}
                costPerUnit={line.catalogItemId ? (estimate?.costPrices[line.catalogItemId] ?? 0) : 0}
                canEdit={canEdit}
                canSeeCosts={canSeeCosts}
                onChanged={() => router.refresh()}
              />
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3" colSpan={5}>
                  Subtotal
                </td>
                <td className="px-3 py-3 text-right">{formatEstimateDollars(calc.subtotalCents)}</td>
                {canSeeCosts && <td className="px-3 py-3 text-right">{formatEstimateDollars(calc.costCents)}</td>}
                {canEdit && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {lines.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold">Discount</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              $
              <input
                type="number"
                step="0.01"
                min={0}
                defaultValue={discountCents ? discountCents / 100 : ""}
                disabled={!canEdit}
                placeholder="0.00"
                aria-label="Discount"
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  const cents = Number.isFinite(v) ? Math.round(v * 100) : 0;
                  if (cents === discountCents) return;
                  updateEstimateAction({ leadId, discountCents: cents }).then((r) =>
                    r.ok ? router.refresh() : toast.error(r.error)
                  );
                }}
                className="w-32 rounded-md border border-border bg-background px-2 py-1 text-right text-sm disabled:opacity-60"
              />
            </label>
          </div>

          <div className={cn("grid gap-3", canSeeCosts ? "sm:grid-cols-4" : "sm:grid-cols-1")}>
            <Stat label="Customer total" value={formatEstimateDollars(calc.totalCents)} strong />
            {canSeeCosts && <Stat label="Our cost" value={formatEstimateDollars(calc.costCents)} />}
            {canSeeCosts && (
              <Stat
                label="Gross profit"
                value={formatEstimateDollars(calc.grossProfitCents)}
                accent={calc.grossProfitCents >= 0 ? "good" : "bad"}
              />
            )}
            {canSeeCosts && (
              <Stat
                label="Margin"
                value={`${calc.marginPct.toFixed(1)}%`}
                accent={calc.grossProfitCents >= 0 ? "good" : "bad"}
              />
            )}
          </div>

          {canSeeCosts && calc.costCents === 0 && (
            <p className="text-xs text-muted-foreground">
              No cost template selected, so margin reads as pure profit. Pick one above to cost these lines.
            </p>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <Button
                size="sm"
                disabled={busy === "price" || (dealType !== "cash" && !hasProject)}
                onClick={pushPrice}
                className="bg-[#F4631E] text-white hover:bg-[#F4631E]/90"
              >
                {busy === "price" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRightCircle className="size-4" />
                )}
                {dealType === "cash" ? "Use as proposal price" : "Use as deal value"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {dealType === "cash"
                  ? "Sets the price the proposal quotes. Nothing moves until you press it."
                  : hasProject
                    ? "Sets this job's deal value. The insurance proposal still quotes the deductible and RCV."
                    : "This deal has no job yet, so there's no deal value to set."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EstimateRow({
  leadId,
  line,
  costPerUnit,
  canEdit,
  canSeeCosts,
  onChanged,
}: {
  leadId: string;
  line: EstimateLineDTO;
  costPerUnit: number;
  canEdit: boolean;
  canSeeCosts: boolean;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);

  function save(patch: Parameters<typeof updateEstimateLineAction>[0]) {
    updateEstimateLineAction(patch).then((r) => (r.ok ? onChanged() : toast.error(r.error)));
  }

  const lineTotal = Math.round(line.quantity * line.unitPriceCents);
  const lineCost = Math.round(line.quantity * costPerUnit);

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-3 py-1.5">
        <input
          className={cell}
          defaultValue={line.category}
          disabled={!canEdit}
          aria-label="Category"
          onBlur={(e) => e.target.value !== line.category && save({ id: line.id, leadId, category: e.target.value })}
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          className={cell}
          defaultValue={line.description}
          disabled={!canEdit}
          placeholder="What the work is"
          aria-label="Description"
          onBlur={(e) =>
            e.target.value !== line.description && save({ id: line.id, leadId, description: e.target.value })
          }
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          step="0.01"
          min={0}
          className={cn(cell, "text-right tabular-nums")}
          defaultValue={line.quantity || ""}
          disabled={!canEdit}
          aria-label="Quantity"
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            const q = Number.isFinite(v) ? v : 0;
            if (q !== line.quantity) save({ id: line.id, leadId, quantity: q });
          }}
        />
      </td>
      <td className="px-3 py-1.5">
        <select
          className={cn(cell, "bg-transparent")}
          defaultValue={line.unit ?? ""}
          disabled={!canEdit}
          aria-label="Unit"
          onChange={(e) => save({ id: line.id, leadId, unit: e.target.value || null })}
        >
          <option value="">—</option>
          {ESTIMATE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <input
          type="number"
          step="0.01"
          min={0}
          className={cn(cell, "text-right tabular-nums")}
          defaultValue={line.unitPriceCents ? line.unitPriceCents / 100 : ""}
          disabled={!canEdit}
          aria-label="Price per unit"
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            const cents = Number.isFinite(v) ? Math.round(v * 100) : 0;
            if (cents !== line.unitPriceCents) save({ id: line.id, leadId, unitPriceCents: cents });
          }}
        />
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatEstimateDollars(lineTotal)}</td>
      {canSeeCosts && (
        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
          {formatEstimateDollars(lineCost)}
        </td>
      )}
      {canEdit && (
        <td className="px-2 py-1.5">
          <button
            type="button"
            aria-label="Delete line"
            disabled={deleting}
            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
            onClick={() => {
              setDeleting(true);
              deleteEstimateLineAction({ id: line.id, leadId }).then((r) => {
                setDeleting(false);
                if (!r.ok) return toast.error(r.error);
                onChanged();
              });
            }}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </td>
      )}
    </tr>
  );
}

/** Search the catalog and drop the checked items onto the estimate. */
function CatalogPicker({
  leadId,
  catalog,
  alreadyAdded,
  onDone,
}: {
  leadId: string;
  catalog: EstimateCatalogOption[];
  alreadyAdded: Set<string>;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);

  const available = catalog.filter((c) => !alreadyAdded.has(c.id));
  const q = query.trim().toLowerCase();
  const shown = q
    ? available.filter((c) => `${c.category} ${c.description}`.toLowerCase().includes(q))
    : available;

  async function add() {
    if (picked.length === 0) return;
    setPending(true);
    const res = await addCatalogItemsAction({ leadId, catalogItemIds: picked });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(picked.length === 1 ? "Line added." : `${picked.length} lines added.`);
    setOpen(false);
    setPicked([]);
    setQuery("");
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPicked([]);
          setQuery("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <LayoutGrid className="size-4" /> Add from catalog
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add from catalog</DialogTitle>
          <DialogDescription>
            Pick the work this job needs. Set quantities and prices on the sheet after adding.
          </DialogDescription>
        </DialogHeader>

        {catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The Scope of Work catalog is empty. Add items in Settings → Scope of Work Catalog, or use{" "}
            <strong>Add line</strong> to type one in by hand.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the catalog…"
                aria-label="Search the catalog"
                className="pl-8"
              />
            </div>
            <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {shown.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {available.length === 0 ? "Every catalog item is already on this estimate." : "Nothing matches that."}
                </li>
              )}
              {shown.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={picked.includes(c.id)}
                      onCheckedChange={() =>
                        setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.description || "Untitled item"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.category} · {c.unit}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <DialogFooter>
          <Button onClick={add} disabled={pending || picked.length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {picked.length <= 1 ? "Add line" : `Add ${picked.length} lines`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  accent,
  strong,
}: {
  label: string;
  value: string;
  accent?: "good" | "bad";
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        accent === "good" && "border-emerald-300/60 bg-emerald-50",
        accent === "bad" && "border-destructive/40 bg-destructive/5",
        !accent && "border-border bg-card"
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-semibold tracking-tight tabular-nums", strong ? "text-2xl" : "text-xl")}>
        {value}
      </div>
    </div>
  );
}
