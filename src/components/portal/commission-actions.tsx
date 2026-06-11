"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, DollarSign, Ban, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveCommissionAction,
  markCommissionPaidAction,
  voidCommissionAction,
  generateCommissionsAction,
  approveAllPendingCommissionsAction,
} from "@/server/modules/payroll/actions";

function useAction() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function run(fn: () => Promise<{ ok: boolean; error?: string; created?: number; count?: number }>, msg?: string) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (res.ok) {
      toast.success(
        msg ??
          (typeof res.created === "number"
            ? `${res.created} commission(s) generated`
            : typeof res.count === "number"
              ? `${res.count} approved`
              : "Done")
      );
      router.refresh();
    } else {
      toast.error(res.error ?? "Action failed");
    }
  }
  return { pending, run };
}

export function CommissionRowActions({ id, status }: { id: string; status: string }) {
  const { pending, run } = useAction();
  // Terminal states have no actions; the Status column already shows "paid"/"void",
  // so render nothing here rather than a redundant label that looks clickable.
  if (status === "paid" || status === "void") return null;

  return (
    <div className="flex justify-end gap-1.5">
      {status === "pending" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => approveCommissionAction(id), "Approved")}>
          <Check className="size-3.5" /> Approve
        </Button>
      )}
      {status === "approved" && (
        <Button size="sm" disabled={pending} onClick={() => run(() => markCommissionPaidAction(id), "Marked paid")} className="bg-gold text-gold-foreground hover:bg-gold/90">
          <DollarSign className="size-3.5" /> Mark Paid
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => voidCommissionAction(id), "Voided")} className="text-destructive">
        <Ban className="size-3.5" />
      </Button>
    </div>
  );
}

export function CommissionsToolbar({ pendingCount = 0 }: { pendingCount?: number }) {
  const { pending, run } = useAction();
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => generateCommissionsAction())}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Generate
      </Button>
      <Button
        size="sm"
        // Nothing to approve when there are no pending commissions.
        disabled={pending || pendingCount === 0}
        title={pendingCount === 0 ? "No pending commissions to approve" : undefined}
        onClick={() => run(() => approveAllPendingCommissionsAction())}
        className="bg-gold text-gold-foreground hover:bg-gold/90"
      >
        <Check className="size-4" /> Approve All Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}
      </Button>
    </div>
  );
}
