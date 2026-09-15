"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Lock, Undo2, Pencil } from "lucide-react";
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
  addPayrollAdjustmentAction,
  deletePayrollAdjustmentAction,
  finalizePayrollRunAction,
  recordChargebackRecoveryAction,
  updatePayrollAdjustmentAction,
} from "@/server/modules/payroll/ledger-actions";

/**
 * The manual half of a payroll run: bonuses, deductions, chargeback
 * instalments, and the lock.
 *
 * ── AN ADJUSTMENT CHANGES THE CHEQUE, NOT THE DEAL ─────────────────────────
 * Said on the panel itself, because it is the thing people get wrong. A $1,000
 * trenching deduction does not mean the rep sold a smaller system: the deal
 * goes on reading $10,000 and the cheque reads $9,500, and both are correct.
 *
 * ── RECOVERY IS A CHOICE, EVERY TIME ───────────────────────────────────────
 * An approved chargeback shows as a BALANCE with an amount box beside it,
 * pre-filled with nothing. Taking the whole balance, taking part of it, or
 * taking none this period are all just what somebody types. Nothing here
 * consumes a cheque on its own.
 */

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export type LedgerPayee = { id: string; name: string };

export type LedgerAdjustment = {
  id: string;
  kind: string;
  reason: string;
  amountCents: number;
  payeeName: string;
  createdByName: string;
  createdAt: string;
  /** Who last edited the line, or null when nobody has. */
  editedByName: string | null;
};

export type OpenChargeback = {
  chargebackId: string;
  userId: string;
  payeeName: string;
  reason: string;
  originalCents: number;
  recoveredCents: number;
  remainingCents: number;
};

export function PayrollLedger({
  runId,
  finalized,
  canManage,
  payees,
  adjustments,
  openChargebacks,
}: {
  runId: string;
  finalized: boolean;
  canManage: boolean;
  payees: LedgerPayee[];
  adjustments: LedgerAdjustment[];
  openChargebacks: OpenChargeback[];
}) {
  const editable = canManage && !finalized;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Adjustments &amp; recovery</h3>
        {editable && <AddAdjustment runId={runId} payees={payees} />}
      </div>

      {finalized ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-[11px] text-muted-foreground">
          <Lock className="mt-px size-3.5 shrink-0" />
          This run is finalised. Nothing on it can change — put a correction on the next run, or
          raise an explicit reversal.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          These change what is PAID on this run. They never rewrite a deal&rsquo;s commission or its
          estimate — a deal can read $10,000 while the cheque reads $9,500, and both are right.
        </p>
      )}

      {adjustments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No adjustments on this run.</p>
      ) : (
        <ul className="divide-y divide-border">
          {adjustments.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{a.payeeName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {`${a.reason} · ${a.createdByName} · ${new Date(a.createdAt).toLocaleDateString()}`}
                  {a.editedByName && ` · edited by ${a.editedByName}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`font-semibold tabular-nums ${a.amountCents < 0 ? "text-destructive" : "text-emerald-600"}`}
                >
                  {a.amountCents > 0 ? "+" : ""}
                  {money(a.amountCents)}
                </span>
                {/* Removing a recovery line takes the instalment back: the
                    amount is owed on the chargeback again — see
                    deletePayrollAdjustment. */}
                {/* A recovery's amount is drawn from its chargeback's balance,
                    so it has no Edit — see updatePayrollAdjustment. */}
                {editable && a.kind !== "chargeback_recovery" && (
                  <EditAdjustment adjustment={a} runId={runId} />
                )}
                {editable && <RemoveAdjustment id={a.id} runId={runId} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      {openChargebacks.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Open chargeback balances
          </h4>
          <ul className="divide-y divide-border">
            {openChargebacks.map((cb) => (
              <ChargebackRow key={cb.chargebackId} cb={cb} runId={runId} editable={editable} />
            ))}
          </ul>
        </div>
      )}

      {editable && <FinalizeRun runId={runId} />}
    </div>
  );
}

function AddAdjustment({ runId, payees }: { runId: string; payees: LedgerPayee[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [userId, setUserId] = React.useState("");
  const [kind, setKind] = React.useState<"bonus" | "deduction">("deduction");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");

  async function save() {
    const n = Number(amount);
    if (!userId) return toast.error("Pick who this is for.");
    if (!(n > 0)) return toast.error("Enter an amount above 0.");
    if (reason.trim().length < 3) return toast.error("Give a reason — it prints on the pay stub.");
    setBusy(true);
    try {
      // Always a positive magnitude; `kind` supplies the sign, server-side, so a
      // "deduction" of +$1,000 cannot pay somebody a bonus by mistake.
      const res = await addPayrollAdjustmentAction({
        payrollRunId: runId,
        userId,
        kind,
        amountCents: Math.round(n * 100),
        reason: reason.trim(),
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Adjustment added");
      setOpen(false);
      setAmount("");
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" /> Add adjustment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an adjustment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Who</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select payee" /></SelectTrigger>
              <SelectContent>
                {payees.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "bonus" | "deduction")}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deduction">Deduction (−)</SelectItem>
                  <SelectItem value="bonus">Bonus (+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Amount (USD)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1,000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Trenching — 100 ft @ $10/ft"
            />
            <p className="text-[11px] text-muted-foreground">Prints on the pay stub beside the amount.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {busy && <Loader2 className="size-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Correct a bonus or deduction in place: its amount and its reason.
 *
 * The payee and the kind stay fixed. A line paid to the wrong person, or entered
 * as a bonus when it was a deduction, is a different line — remove it and add
 * the right one, so the ledger shows both acts. The amount is typed as a
 * positive figure, exactly as on Add; the server keeps the sign the kind gives
 * it and logs the old values beside who changed them.
 */
function EditAdjustment({ adjustment, runId }: { adjustment: LedgerAdjustment; runId: string }) {
  const router = useRouter();
  const savedAmount = (Math.abs(adjustment.amountCents) / 100).toString();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState(savedAmount);
  const [reason, setReason] = React.useState(adjustment.reason);
  const amountId = `edit-adjustment-amount-${adjustment.id}`;
  const reasonId = `edit-adjustment-reason-${adjustment.id}`;

  function onOpenChange(next: boolean) {
    // Opening again starts from what is saved, not from an abandoned edit.
    if (next) {
      setAmount(savedAmount);
      setReason(adjustment.reason);
    }
    setOpen(next);
  }

  async function save() {
    const n = Number(amount);
    if (!(n > 0)) return toast.error("Enter an amount above 0.");
    if (reason.trim().length < 3) return toast.error("Give a reason — it prints on the pay stub.");
    const amountCents = Math.round(n * 100);
    const amountChanged = amountCents !== Math.abs(adjustment.amountCents);
    const reasonChanged = reason.trim() !== adjustment.reason;
    if (!amountChanged && !reasonChanged) return setOpen(false);

    setBusy(true);
    try {
      const res = await updatePayrollAdjustmentAction({
        adjustmentId: adjustment.id,
        payrollRunId: runId,
        ...(amountChanged ? { amountCents } : {}),
        ...(reasonChanged ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Adjustment updated");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("The change could not be saved. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button aria-label="Edit adjustment" className="text-muted-foreground hover:text-foreground">
          <Pencil className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit adjustment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{adjustment.payeeName}</span>
            <span className="text-muted-foreground">
              {` · ${adjustment.kind === "bonus" ? "Bonus (+)" : "Deduction (−)"}`}
            </span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={amountId} className="text-xs">Amount (USD)</Label>
            <Input
              id={amountId}
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={reasonId} className="text-xs">Reason</Label>
            <Input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Prints on the pay stub beside the amount.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {busy && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveAdjustment({ id, runId }: { id: string; runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      aria-label="Remove adjustment"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await deletePayrollAdjustmentAction(id, runId);
          if (!res.ok) return toast.error(res.error);
          router.refresh();
        } catch {
          toast.error("The line could not be removed. Refresh the page and try again.");
        } finally {
          setBusy(false);
        }
      }}
      className="text-muted-foreground hover:text-destructive"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}

function ChargebackRow({
  cb,
  runId,
  editable,
}: {
  cb: OpenChargeback;
  runId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function recover() {
    const n = Number(amount);
    if (!(n > 0)) return toast.error("Enter how much to recover this run.");
    setBusy(true);
    try {
      const res = await recordChargebackRecoveryAction({
        chargebackId: cb.chargebackId,
        payrollRunId: runId,
        amountCents: Math.round(n * 100),
      });
      if (!res.ok) return toast.error(res.error);
      toast.success(
        res.remainingCents > 0
          ? `Recovered ${money(res.recoveredCents)} — ${money(res.remainingCents)} still owed`
          : `Recovered ${money(res.recoveredCents)} — settled in full`
      );
      setAmount("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="font-medium">{cb.payeeName}</div>
        <div className="text-[11px] text-muted-foreground">
          {cb.reason.replace(/_/g, " ")} · {money(cb.originalCents)} original ·{" "}
          {money(cb.recoveredCents)} recovered
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-semibold tabular-nums">{money(cb.remainingCents)} owed</span>
        {editable && (
          <>
            {/* Deliberately blank, not pre-filled with the balance. Taking
                nothing this period is a legitimate answer and the form should
                not nudge toward emptying somebody's cheque. */}
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Recover…"
              className="w-28"
            />
            <Button size="sm" variant="outline" onClick={recover} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
              Take
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function FinalizeRun({ runId }: { runId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="mt-2">
          <Lock className="size-3.5" /> Finalise run
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Finalise this payroll run?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          After this, nothing on the run changes — no commission enters it, no amount moves, no
          adjustment is added or removed. Anything found later goes on the next run.{" "}
          <span className="font-medium text-foreground">There is no way to re-open it.</span>
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await finalizePayrollRunAction(runId);
              setBusy(false);
              if (!res.ok) return toast.error(res.error);
              toast.success(res.message ?? "Run finalised");
              setOpen(false);
              router.refresh();
            }}
            className="bg-gold text-gold-foreground hover:bg-gold/90"
          >
            {busy && <Loader2 className="size-4 animate-spin" />} Finalise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
