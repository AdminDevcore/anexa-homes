"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setCompanyEinAction } from "@/server/modules/bookkeeping/tax1099-actions";

export function Tax1099Controls({
  year,
  years,
  payerEin,
  canEdit,
}: {
  year: number;
  years: number[];
  payerEin: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [ein, setEin] = React.useState(payerEin ?? "");
  const [busy, setBusy] = React.useState(false);

  async function saveEin() {
    setBusy(true);
    const res = await setCompanyEinAction(ein);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Company EIN saved");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Tax year
          <select
            value={year}
            onChange={(e) => router.push(`/portal/bookkeeping/1099?year=${e.target.value}`)}
            className="block h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        {canEdit && (
          <div className="space-y-1 text-xs text-muted-foreground">
            Company EIN (payer TIN)
            <div className="flex items-center gap-1.5">
              <Input className="h-9 w-44" value={ein} onChange={(e) => setEin(e.target.value)} placeholder="XX-XXXXXXX" />
              <Button size="sm" variant="outline" onClick={saveEin} disabled={busy || ein.trim() === (payerEin ?? "")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={`/portal/bookkeeping/1099/export?year=${year}`}>
            <Download className="size-4" /> Export 1099 CSV (≥$600)
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={`/portal/bookkeeping/1099/export?year=${year}&all=1`}>All vendors</a>
        </Button>
      </div>
    </div>
  );
}
