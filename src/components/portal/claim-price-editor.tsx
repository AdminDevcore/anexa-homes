"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormat } from "@/components/portal/branding-provider";
import { setClaimPriceAction } from "@/server/modules/leads/manage";

// Inline editor for the deal's CLAIM PRICE — the contract price from the
// insurance scope (entered at Scope Received). Drives the deal's contract value.
export function ClaimPriceEditor({
  leadId,
  claimPrice,
  canEdit,
}: {
  leadId: string;
  claimPrice: number | null;
  canEdit: boolean;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [amount, setAmount] = React.useState(claimPrice != null ? String(claimPrice / 100) : "");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const cents = Math.round((Number(amount) || 0) * 100);
    if (cents < 0) return toast.error("Enter a valid amount.");
    setBusy(true);
    const res = await setClaimPriceAction({ leadId, amountCents: cents });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Claim price saved");
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 w-28"
          type="number"
          inputMode="decimal"
          placeholder="$0"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <Button size="sm" className="h-7" onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className={claimPrice == null ? "text-muted-foreground" : "font-medium tabular-nums"}>
        {claimPrice != null ? fmt.money(claimPrice) : "Not set"}
      </span>
      {canEdit && (
        <button onClick={() => setEditing(true)} className="inline-flex items-center gap-0.5 text-xs text-gold-muted hover:underline">
          <Pencil className="size-3" /> {claimPrice != null ? "Edit" : "Set"}
        </button>
      )}
    </span>
  );
}
