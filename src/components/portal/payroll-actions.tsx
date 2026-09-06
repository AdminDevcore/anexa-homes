"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, Check, DollarSign, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createPayrollRunAction,
  approvePayrollRunAction,
  markPayrollRunPaidAction,
  deletePayrollRunAction,
} from "@/server/modules/payroll/actions";
import { currentPayrollPeriod, toDateInputValue } from "@/server/modules/payroll/schedule";

export function NewPayrollRunDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [pending, setPending] = React.useState(false);

  /* The schedule fills the form in: Thursday pays the prior Monday-to-FRIDAY
   * workweek. Computed on OPEN rather than at mount, so a browser left open
   * overnight does not offer last week's dates.
   *
   * Every field stays editable. The default is the ordinary week; an off-cycle
   * run is still a run somebody may need to cut. */
  function onOpenChange(next: boolean) {
    if (next) {
      const period = currentPayrollPeriod();
      setLabel(period.label);
      setStart(toDateInputValue(period.periodStart));
      setEnd(toDateInputValue(period.periodEnd));
    }
    setOpen(next);
  }

  async function create() {
    if (!label || !start || !end) {
      toast.error("Fill in all fields.");
      return;
    }
    setPending(true);
    const res = await createPayrollRunAction({ label, periodStart: start, periodEnd: end });
    setPending(false);
    if (res.ok) {
      toast.success(`Payroll run created with ${res.items} item(s)`);
      setOpen(false);
      router.push(`/portal/payroll/${res.runId}`);
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-gold text-gold-foreground hover:bg-gold/90">
          <Plus className="size-4" /> New Payroll Run
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Payroll Run</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. June 2026 — 1st half" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Period start</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Period end</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Payroll runs Thursday for the prior Monday&ndash;Friday workweek. Pulls in everything approved and still
            unpaid as of the period end &mdash; commissions and contractor invoices alike &mdash; including anything
            approved too late for an earlier run, so a weekend funding or a late M1 never misses a payroll.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayrollRunActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (res.ok) {
      toast.success(msg);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function remove() {
    setPending(true);
    const res = await deletePayrollRunAction(id);
    setPending(false);
    if (res.ok) {
      toast.success("Payroll run deleted");
      setConfirmDelete(false);
      router.push("/portal/payroll");
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="flex gap-2">
      {status === "draft" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => approvePayrollRunAction(id), "Run approved")}>
          <Check className="size-4" /> Approve Run
        </Button>
      )}
      {status === "approved" && (
        <Button size="sm" disabled={pending} onClick={() => run(() => markPayrollRunPaidAction(id), "Marked paid")} className="bg-gold text-gold-foreground hover:bg-gold/90">
          <DollarSign className="size-4" /> Mark All Paid
        </Button>
      )}
      {status === "paid" && <span className="text-sm text-emerald-600">Paid</span>}

      {/* Unpaid runs (draft/approved) can be deleted; their lines return to the pool. */}
      {status !== "paid" && (
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending} className="text-destructive hover:text-destructive">
              <Trash2 className="size-4" /> Delete
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this payroll run?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This deletes the run and its lines. What was in it stays approved and returns to the
              unpaid pool, so you can create a corrected run. This can&rsquo;t be undone.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={pending}>Cancel</Button>
              <Button variant="destructive" onClick={remove} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete run
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
