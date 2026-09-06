"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Undo2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  requestChargebackAction,
  approveChargebackAction,
  rejectChargebackAction,
} from "@/server/modules/payroll/ledger-actions";

/**
 * Raising a chargeback against ONE commission line.
 *
 * ── WHY IT HANGS OFF A COMMISSION ROW ──────────────────────────────────────
 * A manager's override is its own commission row, with the manager as its
 * recipient. Putting the control here rather than on the deal means an override
 * can be charged back exactly as a rep's line can — separately, at its own
 * amount, with its own reason — without any special case, and without a single
 * button that silently claws back three people's money at once.
 *
 * ── THE REASON LIST IS THE POLICY ──────────────────────────────────────────
 * Only rep-caused reasons appear, because only rep conduct may take a rep's
 * pay. An installation failure, a permit refusal, a utility that would not
 * interconnect, a lender problem, a customer who stopped answering — none of
 * those are on this list and none can be selected. They are the company's risk.
 * The `ChargebackReason` enum on the server is the real whitelist; these are its
 * labels.
 */
const REASONS: { value: string; label: string }[] = [
  { value: "fraud", label: "Fraud" },
  { value: "fabricated_deal", label: "Fabricated deal" },
  { value: "misrepresentation", label: "Material misrepresentation" },
  { value: "rep_misconduct", label: "Rep misconduct causing the loss" },
  { value: "other_rep_caused", label: "Other documented rep-caused loss" },
];

export function RaiseChargeback({
  commissionId,
  userId,
  recipientName,
  amountCents,
  isOverride,
}: {
  commissionId: string;
  userId: string;
  recipientName: string;
  amountCents: number;
  isOverride: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [amount, setAmount] = React.useState((amountCents / 100).toString());
  const [notes, setNotes] = React.useState("");

  async function save() {
    const n = Number(amount);
    if (!reason) return toast.error("Pick a documented rep-caused reason.");
    if (!(n > 0)) return toast.error("Enter an amount above 0.");
    setBusy(true);
    try {
      const res = await requestChargebackAction({
        userId,
        commissionId,
        amountCents: Math.round(n * 100),
        reason,
        notes: notes.trim() || null,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Chargeback raised — it needs approval before anything can be recovered");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
          <Undo2 className="size-3.5" /> Charge back
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Charge back {recipientName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
            {isOverride
              ? "This is a manager override line. It is charged back on its own, separately from the rep's commission on the same deal."
              : "This is the rep's own commission line."}{" "}
            The original commission record is never edited — this creates a separate balance that an
            admin draws down on a payroll run.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick a reason" /></SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Only rep-caused losses qualify. An install, permitting, utility, lender or customer
              problem outside the rep&rsquo;s control is not a chargeback.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Amount (USD)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Raise chargeback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Approve or reject a pending chargeback. The second pair of eyes. */
export function ChargebackDecision({ chargebackId }: { chargebackId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(msg);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => run(() => approveChargebackAction(chargebackId), "Chargeback approved")}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => run(() => rejectChargebackAction(chargebackId), "Chargeback rejected")}
      >
        <X className="size-3.5" /> Reject
      </Button>
    </div>
  );
}
