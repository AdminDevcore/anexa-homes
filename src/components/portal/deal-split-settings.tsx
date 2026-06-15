"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOverheadPctAction, setPaFeePctAction } from "@/server/modules/costs/actions";

export function DealSplitSettings({
  overheadPct,
  paFeePct,
}: {
  overheadPct: number;
  paFeePct: number;
}) {
  const [oh, setOh] = React.useState(String(overheadPct));
  const [savingOh, setSavingOh] = React.useState(false);
  const [pa, setPa] = React.useState(String(paFeePct));
  const [savingPa, setSavingPa] = React.useState(false);

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

      <p className="text-xs text-muted-foreground">
        Each rep&rsquo;s split % is set on their own profile under Team.
      </p>
    </div>
  );
}
