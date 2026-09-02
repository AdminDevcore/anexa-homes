"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Hint, Panel } from "@/components/portal/settings-kit";
import { SCOPE_UNITS } from "@/lib/scope-catalog";
import {
  createCatalogItemAction,
  updateCatalogItemAction,
  deleteCatalogItemAction,
} from "@/server/modules/scope/catalog-actions";

export type CatalogItem = {
  id: string;
  category: string;
  subcategory: string;
  description: string;
  unit: string;
  trade: string;
  isCommonInsuranceItem: boolean;
  isSupplementEligible: boolean;
  isActive: boolean;
};

const cell = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none";

export function ScopeCatalogManager({ items }: { items: CatalogItem[] }) {
  const [query, setQuery] = React.useState("");
  const [trade, setTrade] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<"all" | "active" | "inactive">("all");
  const [addOpen, setAddOpen] = React.useState(false);

  const trades = React.useMemo(() => [...new Set(items.map((i) => i.trade))].sort(), [items]);
  const categories = React.useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);

  const q = query.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (trade && i.trade !== trade) return false;
    if (category && i.category !== category) return false;
    if (activeFilter === "active" && !i.isActive) return false;
    if (activeFilter === "inactive" && i.isActive) return false;
    if (q && !`${i.description} ${i.category} ${i.subcategory} ${i.trade}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // Group by category → subcategory (preserving the query's ordering).
  const grouped = new Map<string, Map<string, CatalogItem[]>>();
  for (const i of filtered) {
    const cat = grouped.get(i.category) ?? new Map<string, CatalogItem[]>();
    const sub = cat.get(i.subcategory || "—") ?? [];
    sub.push(i);
    cat.set(i.subcategory || "—", sub);
    grouped.set(i.category, cat);
  }

  return (
    <Panel
      title="Line items"
      description="The master list every estimate is built from. No pricing here — a cost or supplement template prices it, and insurance pricing is entered on the job."
      action={
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add item
        </Button>
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search line items…" className="pl-9" />
        </div>
        <select value={trade} onChange={(e) => setTrade(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="">All trades</option>
          {trades.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="all">All</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <Hint className="ml-auto">
          {filtered.length} of {items.length}
        </Hint>
      </div>

      {/* Catalog */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Trade</th>
              <th className="px-3 py-2 text-center font-medium">Common</th>
              <th className="px-3 py-2 text-center font-medium">Supplement</th>
              <th className="px-3 py-2 text-center font-medium">Active</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No matching line items.</td></tr>
            )}
            {[...grouped.entries()].map(([cat, subs]) => (
              <React.Fragment key={cat}>
                <tr className="bg-muted/50">
                  <td colSpan={7} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-foreground">
                    {cat} <span className="text-muted-foreground">({[...subs.values()].reduce((s, a) => s + a.length, 0)})</span>
                  </td>
                </tr>
                {[...subs.entries()].map(([sub, rows]) => (
                  <React.Fragment key={`${cat}-${sub}`}>
                    {sub !== "—" && (
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-5 py-1.5 text-[11px] font-medium text-muted-foreground">{sub}</td>
                      </tr>
                    )}
                    {rows.map((item) => <Row key={item.id} item={item} />)}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <AddDialog open={addOpen} onOpenChange={setAddOpen} trades={trades} categories={categories} />
    </Panel>
  );
}

function Row({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function save(patch: Record<string, unknown>) {
    const res = await updateCatalogItemAction({ id: item.id, ...patch });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }
  async function remove() {
    if (!confirm(`Delete "${item.description}" from the catalog?`)) return;
    setBusy(true);
    const res = await deleteCatalogItemAction(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <tr className={cn("border-t border-border/60", !item.isActive && "opacity-50")}>
      <td className="px-2 py-1">
        <input defaultValue={item.description} onBlur={(e) => e.target.value !== item.description && save({ description: e.target.value })} className={cn(cell, "min-w-[16rem]")} />
      </td>
      <td className="px-2 py-1">
        <select defaultValue={item.unit} onChange={(e) => save({ unit: e.target.value })} className="rounded-md border border-border bg-background px-1.5 py-1 text-xs">
          {SCOPE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <input defaultValue={item.trade} onBlur={(e) => e.target.value !== item.trade && save({ trade: e.target.value })} className={cn(cell, "w-28")} />
      </td>
      <td className="px-3 py-1 text-center">
        <Checkbox checked={item.isCommonInsuranceItem} onCheckedChange={(v) => save({ isCommonInsuranceItem: !!v })} />
      </td>
      <td className="px-3 py-1 text-center">
        <Checkbox checked={item.isSupplementEligible} onCheckedChange={(v) => save({ isSupplementEligible: !!v })} />
      </td>
      <td className="px-3 py-1 text-center">
        <Checkbox checked={item.isActive} onCheckedChange={(v) => save({ isActive: !!v })} />
      </td>
      <td className="px-1 py-1 text-center">
        <button onClick={remove} disabled={busy} className="text-muted-foreground hover:text-destructive" aria-label="Delete">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      </td>
    </tr>
  );
}

function AddDialog({ open, onOpenChange, trades, categories }: { open: boolean; onOpenChange: (v: boolean) => void; trades: string[]; categories: string[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mount fresh each open so fields reset without a setState-in-effect. */}
        {open && <AddForm onClose={() => onOpenChange(false)} trades={trades} categories={categories} />}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ onClose, trades, categories }: { onClose: () => void; trades: string[]; categories: string[] }) {
  const router = useRouter();
  const [category, setCategory] = React.useState("");
  const [subcategory, setSubcategory] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [unit, setUnit] = React.useState<string>("EA");
  const [trade, setTrade] = React.useState("");
  const [common, setCommon] = React.useState(false);
  const [supplement, setSupplement] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!description.trim()) return toast.error("Description is required.");
    setBusy(true);
    const res = await createCatalogItemAction({ category, subcategory, description, unit, trade, isCommonInsuranceItem: common, isSupplementEligible: supplement });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onClose();
    router.refresh();
  }

  return (
    <>
      <DialogHeader><DialogTitle>New catalog line item</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Input list="cat-list" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Roofing" />
              <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Subcategory">
              <Input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="Asphalt Shingles" />
            </Field>
          </div>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Drip edge" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit">
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                {SCOPE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Trade">
              <Input list="trade-list" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Roofing" />
              <datalist id="trade-list">{trades.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
          </div>
          <div className="flex gap-4 pt-1 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={common} onCheckedChange={(v) => setCommon(!!v)} /> Common insurance item</label>
            <label className="flex items-center gap-2"><Checkbox checked={supplement} onCheckedChange={(v) => setSupplement(!!v)} /> Supplement eligible</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !description.trim()}>{busy && <Loader2 className="size-4 animate-spin" />} Add</Button>
        </DialogFooter>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-sm font-medium">{label}</label>{children}</div>;
}
