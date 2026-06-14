"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOverheadPctAction, setPaFeePctAction, setRepSplitAction } from "@/server/modules/costs/actions";

export function DealSplitSettings({
  overheadPct,
  paFeePct,
  reps,
}: {
  overheadPct: number;
  paFeePct: number;
  reps: { id: string; name: string; role: string; splitPct: number | null }[];
}) {
  const [oh, setOh] = React.useState(String(overheadPct));
  const [savingOh, setSavingOh] = React.useState(false);
  const [pa, setPa] = React.useState(String(paFeePct));
  const [savingPa, setSavingPa] = React.useState(false);
  const [splits, setSplits] = React.useState<Record<string, string>>(
    Object.fromEntries(reps.map((r) => [r.id, r.splitPct == null ? "" : String(r.splitPct)]))
  );
  const [savingId, setSavingId] = React.useState<string | null>(null);

  async function saveOverhead() {
    const pct = parseFloat(oh);
    setSavingOh(true);
    const res = await setOverheadPctAction(pct);
    setSavingOh(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Overhead saved");
  }
  async function savePaFee() {
    const pct = parseFloat(pa);
    setSavingPa(true);
    const res = await setPaFeePctAction(pct);
    setSavingPa(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("PA fee saved");
  }
  async function saveSplit(id: string) {
    const raw = splits[id];
    const pct = raw === "" ? null : parseFloat(raw);
    if (pct !== null && !(pct >= 0 && pct <= 100)) return toast.error("Split must be 0–100.");
    setSavingId(id);
    const res = await setRepSplitAction({ userId: id, pct });
    setSavingId(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Split saved");
  }

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">Margin-split commissions</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          For each deal: contract − job cost − company overhead − PA fee (on supplements) = profit pool, split between the company and the rep by each rep&rsquo;s %.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Company overhead (% of contract)</label>
          <Input type="number" value={oh} onChange={(e) => setOh(e.target.value)} className="w-28" />
        </div>
        <Button size="sm" onClick={saveOverhead} disabled={savingOh}>
          {savingOh && <Loader2 className="size-3.5 animate-spin" />} Save
        </Button>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Public-adjuster fee (% of supplement)</label>
          <Input type="number" value={pa} onChange={(e) => setPa(e.target.value)} className="w-28" />
        </div>
        <Button size="sm" onClick={savePaFee} disabled={savingPa}>
          {savingPa && <Loader2 className="size-3.5 animate-spin" />} Save
        </Button>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Rep splits (% of profit pool)</p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {reps.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No sales reps yet.</li>}
          {reps.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1">
                {r.name} <span className="text-xs capitalize text-muted-foreground">· {r.role.replace(/_/g, " ")}</span>
              </span>
              <Input
                type="number"
                value={splits[r.id] ?? ""}
                onChange={(e) => setSplits((s) => ({ ...s, [r.id]: e.target.value }))}
                placeholder="—"
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">%</span>
              <Button size="sm" variant="outline" onClick={() => saveSplit(r.id)} disabled={savingId === r.id}>
                {savingId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
