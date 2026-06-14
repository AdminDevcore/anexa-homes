"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setRepVendorAction } from "@/server/modules/team/actions";

export function RepVendorLink({
  userId,
  vendors,
  currentVendorId,
}: {
  userId: string;
  vendors: { id: string; name: string; is1099: boolean }[];
  currentVendorId: string | null;
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = React.useState(currentVendorId ?? "none");
  const [busy, setBusy] = React.useState(false);
  const dirty = vendorId !== (currentVendorId ?? "none");

  async function save() {
    setBusy(true);
    const res = await setRepVendorAction(userId, vendorId === "none" ? null : vendorId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Contractor vendor updated");
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Receipt className="size-4 text-muted-foreground" />
        <h3 className="font-semibold">Contractor (1099 vendor)</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Sales reps are paid as 1099 contractors. A vendor was created automatically so their payouts track to a 1099. Reassign to a different vendor if they invoice under a company / LLC.
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Linked vendor</Label>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
          <option value="none">— None —</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}{v.is1099 ? " · 1099" : ""}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={save} disabled={!dirty || busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </Button>
        <Link href="/portal/bookkeeping" className="text-xs text-muted-foreground underline-offset-2 hover:underline">Edit vendor details →</Link>
      </div>
    </div>
  );
}
