"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCents } from "@/lib/format";
import { setCommissionOverrideAction, deleteCommissionOverrideAction } from "@/server/modules/team/actions";

export type OverrideRow = {
  id: string;
  sourceId: string;
  sourceName: string;
  type: "percentage" | "flat";
  percent: number;
  flatAmount: number;
};
export type OverrideCandidate = { id: string; name: string };

// Lists & edits the overrides THIS member earns off other people's deals.
export function CommissionOverrides({
  beneficiaryId,
  beneficiaryName,
  overrides,
  candidates,
  canEdit,
}: {
  beneficiaryId: string;
  beneficiaryName: string;
  overrides: OverrideRow[];
  candidates: OverrideCandidate[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [sourceId, setSourceId] = React.useState("");
  const [type, setType] = React.useState<"percentage" | "flat">("percentage");
  const [amount, setAmount] = React.useState("");

  const taken = new Set(overrides.map((o) => o.sourceId));
  const available = candidates.filter((c) => c.id !== beneficiaryId && !taken.has(c.id));

  async function add() {
    if (!sourceId) return toast.error("Pick whose deals this is off of.");
    const n = Number(amount);
    if (!(n > 0)) return toast.error("Enter an amount above 0.");
    setBusy(true);
    const res = await setCommissionOverrideAction({
      beneficiaryId,
      sourceId,
      type,
      percent: type === "percentage" ? n : 0,
      flatAmount: type === "flat" ? Math.round(n * 100) : 0,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Override saved");
    setAdding(false);
    setSourceId("");
    setAmount("");
    setType("percentage");
    router.refresh();
  }

  async function remove(id: string) {
    const res = await deleteCommissionOverrideAction(id);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <Layers className="size-4 text-gold" /> Overrides earned
        </h3>
        {canEdit && available.length > 0 && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {beneficiaryName} earns these off other people&rsquo;s deals (% of contract or a flat amount per deal).
      </p>

      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">No overrides configured.</p>
      ) : (
        <ul className="divide-y divide-border">
          {overrides.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium">{o.type === "percentage" ? `${o.percent}%` : formatCents(o.flatAmount)}</span>
                <span className="text-muted-foreground"> off {o.sourceName}&rsquo;s deals</span>
              </span>
              {canEdit && (
                <button onClick={() => remove(o.id)} aria-label="Remove override" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && adding && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Off whose deals</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select person" /></SelectTrigger>
              <SelectContent>
                {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "percentage" | "flat")}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">% of contract</SelectItem>
                  <SelectItem value="flat">Flat $ / deal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">{type === "percentage" ? "Percent" : "Amount (USD)"}</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={type === "percentage" ? "e.g. 3" : "e.g. 500"}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={add} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
              {busy && <Loader2 className="size-4 animate-spin" />} Save override
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
