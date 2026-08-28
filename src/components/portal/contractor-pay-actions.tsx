"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, Loader2, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveAllPendingContractorPayAction,
  approveContractorPayAction,
  generateContractorPayAction,
  setContractorPayAmountAction,
  unapproveContractorPayAction,
  voidContractorPayAction,
} from "@/server/modules/contractor-pay/actions";

type Result = { ok: boolean; error?: string; created?: number; count?: number; message?: string };

function useAction() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function run(fn: () => Promise<Result>, msg?: string) {
    setPending(true);
    let res: Result;
    try {
      res = await fn();
    } catch {
      // A throwing action used to leave `pending` latched true, and a stuck
      // button reads as a dead one to whoever is trying to pay somebody.
      setPending(false);
      toast.error("Something went wrong. Try again.");
      return;
    }
    setPending(false);
    if (!res.ok) {
      toast.error(res.error ?? "Action failed");
      return;
    }
    // An action that produced nothing explains itself. A bare "0 generated"
    // reads as a bug rather than as "there was nothing new".
    const text =
      msg ??
      res.message ??
      (typeof res.created === "number"
        ? `${res.created} pay line(s) generated`
        : typeof res.count === "number"
          ? `${res.count} approved`
          : "Done");
    if (res.message && !res.created && !res.count) toast.info(text);
    else toast.success(text);
    router.refresh();
  }
  return { pending, run };
}

/**
 * The amount, typed off the invoice.
 *
 * An input rather than a dialog because this is the one number on the page and
 * somebody is reading a PDF in the next tab while they fill it in. It commits
 * on blur and on Enter, and only when the value actually changed — so tabbing
 * through a list of twenty does not fire twenty writes.
 *
 * Dollars in the box, cents on the wire. Everything downstream — the payroll
 * item, the ledger transaction, the pay stub — is integer cents, and a float
 * that survived to the ledger would be a rounding error in somebody's pay.
 */
export function ContractorPayAmount({
  id,
  amount,
  display,
  locked,
}: {
  id: string;
  amount: number;
  /**
   * The amount already formatted by the TENANT's formatter, for the read-only
   * state. Passed in rather than formatted here: this is a client component and
   * currency and locale are per-company settings — one tenant on this codebase
   * bills in EUR with de-DE formatting, and a hardcoded en-US/USD would print
   * the wrong number in the wrong shape on their payables screen.
   */
  display: string;
  locked: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const asDollars = (cents: number) => (cents ? (cents / 100).toFixed(2) : "");

  async function commit() {
    const raw = inputRef.current?.value ?? "";
    const dollars = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
    const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    if (cents === amount) return;
    setBusy(true);
    let res: Result;
    try {
      res = await setContractorPayAmountAction({ id, amount: cents });
    } catch {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = asDollars(amount);
      toast.error("Could not save that amount.");
      return;
    }
    setBusy(false);
    if (!res.ok) {
      // Put the last good value back rather than leaving a number on screen
      // that the database does not have.
      if (inputRef.current) inputRef.current.value = asDollars(amount);
      toast.error(res.error ?? "Could not save that amount.");
      return;
    }
    if (inputRef.current) inputRef.current.value = asDollars(cents);
    router.refresh();
  }

  if (locked) return <span className="tabular-nums">{display}</span>;

  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span className="text-muted-foreground">$</span>
      <input
        // Uncontrolled, keyed on the server's value. A refresh from anywhere
        // else — a payroll run, another tab — remounts the box with the truth,
        // which is what a controlled input plus a syncing effect was doing the
        // hard way and one render behind.
        key={amount}
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label="Invoice amount"
        defaultValue={asDollars(amount)}
        placeholder="0.00"
        disabled={busy}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums"
      />
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
    </span>
  );
}

export function ContractorPayRowActions({
  payId,
  status,
  amount,
  batched,
}: {
  payId: string | null;
  status: string | null;
  amount: number;
  batched: boolean;
}) {
  const { pending, run } = useAction();

  // No pay line yet — the invoice is submitted and waiting for Generate. The
  // toolbar does that for the whole list, so there is nothing to offer per row.
  if (!payId) return <span className="text-xs text-muted-foreground">Not generated</span>;
  // Paid and void are terminal; the Status column already says so.
  if (status === "paid" || status === "void") return null;
  // Once batched into a run, the run owns it. Deleting the run is the way back,
  // and that lives on the payroll page rather than being duplicated here.
  if (batched) return <span className="text-xs text-muted-foreground">In payroll run</span>;

  return (
    <div className="flex justify-end gap-1.5">
      {status === "pending" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending || amount <= 0}
          title={amount <= 0 ? "Type the invoice amount first" : undefined}
          onClick={() => run(() => approveContractorPayAction(payId), "Approved")}
        >
          <Check className="size-3.5" /> Approve
        </Button>
      )}
      {status === "approved" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => unapproveContractorPayAction(payId), "Sent back")}
        >
          <Undo2 className="size-3.5" /> Unapprove
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label="Void this pay line"
        onClick={() => run(() => voidContractorPayAction(payId), "Voided")}
        className="text-destructive"
      >
        <Ban className="size-3.5" />
      </Button>
    </div>
  );
}

export function ContractorPayToolbar({
  ungenerated,
  approvable,
}: {
  ungenerated: number;
  approvable: number;
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => generateContractorPayAction())}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Generate{ungenerated > 0 ? ` (${ungenerated})` : ""}
      </Button>
      <Button
        size="sm"
        // "Approve all" only ever approves lines that have an amount on them,
        // so with none priced there is genuinely nothing to press.
        disabled={pending || approvable === 0}
        title={approvable === 0 ? "No priced invoices waiting for approval" : undefined}
        onClick={() => run(() => approveAllPendingContractorPayAction())}
        className="bg-gold text-gold-foreground hover:bg-gold/90"
      >
        <Check className="size-4" /> Approve All{approvable > 0 ? ` (${approvable})` : ""}
      </Button>
    </div>
  );
}
