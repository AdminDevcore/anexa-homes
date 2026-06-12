"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SCOPE_UNITS } from "@/lib/scope";
import {
  addScopeTemplateItemAction,
  updateScopeTemplateItemAction,
  deleteScopeTemplateItemAction,
} from "@/server/modules/scope/actions";

type Item = {
  id: string;
  category: string;
  description: string;
  unit: string | null;
  defaultInsuranceUnitPrice: number; // cents
  defaultCostUnitPrice: number; // cents
  defaultSupplementUnitPrice: number; // cents
};

const cell =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-ring focus:outline-none";

export function ScopeTemplateManager({ items }: { items: Item[] }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);

  async function add() {
    setAdding(true);
    const res = await addScopeTemplateItemAction({ category: "General", description: "New item" });
    setAdding(false);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Default Ins $/u</th>
              <th className="px-3 py-2 text-right font-medium">Default Suppl $/u</th>
              <th className="px-3 py-2 text-right font-medium">Default Cost $/u</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No template items yet. Add common roofing lines with your standard cost rates.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <Row key={item.id} item={item} onChanged={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="outline" disabled={adding} onClick={add}>
        {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add line
      </Button>
    </div>
  );
}

function Row({ item, onChanged }: { item: Item; onChanged: () => void }) {
  async function save(patch: Record<string, unknown>) {
    const res = await updateScopeTemplateItemAction({ id: item.id, ...patch });
    if (!res.ok) toast.error(res.error);
    else onChanged();
  }

  return (
    <tr>
      <td className="px-2 py-1">
        <input
          defaultValue={item.category}
          onBlur={(e) => e.target.value !== item.category && save({ category: e.target.value })}
          className={cn(cell, "w-28")}
        />
      </td>
      <td className="px-2 py-1">
        <input
          defaultValue={item.description}
          onBlur={(e) => e.target.value !== item.description && save({ description: e.target.value })}
          className={cn(cell, "min-w-[12rem]")}
        />
      </td>
      <td className="px-2 py-1">
        <input
          list="tpl-units"
          defaultValue={item.unit ?? ""}
          onBlur={(e) => e.target.value !== (item.unit ?? "") && save({ unit: e.target.value })}
          className={cn(cell, "w-16")}
          placeholder="—"
        />
        <datalist id="tpl-units">
          {SCOPE_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="0.01"
          defaultValue={item.defaultInsuranceUnitPrice ? item.defaultInsuranceUnitPrice / 100 : ""}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            save({ defaultInsuranceUnitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
          }}
          className={cn(cell, "w-24 text-right")}
          placeholder="0.00"
        />
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="0.01"
          defaultValue={item.defaultSupplementUnitPrice ? item.defaultSupplementUnitPrice / 100 : ""}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            save({ defaultSupplementUnitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
          }}
          className={cn(cell, "w-24 text-right")}
          placeholder="—"
        />
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          step="0.01"
          defaultValue={item.defaultCostUnitPrice ? item.defaultCostUnitPrice / 100 : ""}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            save({ defaultCostUnitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
          }}
          className={cn(cell, "w-24 text-right")}
          placeholder="0.00"
        />
      </td>
      <td className="px-1 py-1 text-center">
        <button
          onClick={() => deleteScopeTemplateItemAction(item.id).then((r) => (r.ok ? onChanged() : toast.error(r.error)))}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  );
}
