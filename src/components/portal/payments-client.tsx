"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, ShieldCheck, ShieldAlert, Clock, Send, Check, Ban, Plus, KeyRound, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatCents, formatDate } from "@/lib/format";
import type { PaymentsOverview, PaymentRow } from "@/server/modules/payments/queries";
import {
  createPaymentAction, submitPaymentAction, approvePaymentAction, sendPaymentAction,
  cancelPaymentAction, createPayeeAction, setPayeeActiveAction,
} from "@/server/modules/payments/actions";
import {
  beginMfaEnrollmentAction, confirmMfaEnrollmentAction, regenerateMfaRecoveryCodesAction,
} from "@/server/auth/mfa-actions";

/**
 * THE PAYMENTS SCREEN.
 *
 * Every control here mirrors a rule enforced in the module, and none of them
 * IS the rule — the server refuses regardless of what this renders. The reason
 * to show them anyway is that a disabled button with a sentence attached tells
 * someone why they cannot do a thing, where a button that fails on press just
 * looks broken.
 *
 * The four rules made visible:
 *   - a payment needs a second factor to approve, so enrolment is on this page;
 *   - the approver cannot be the person who raised it (maker-checker);
 *   - a new payee's bank details sit in a cooling-off period;
 *   - the amount is the bill's amount, which is why it is not typeable.
 */

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  approved: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  sent: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  settled: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  returned: "bg-red-500/15 text-red-600 dark:text-red-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function PaymentsClient({
  data,
  canCreate,
  canApprove,
  canUpdate,
  provider,
}: {
  data: PaymentsOverview;
  canCreate: boolean;
  canApprove: boolean;
  canUpdate: boolean;
  provider: string;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="space-y-5">
      <SecondFactorPanel mfa={data.mfa} onChanged={refresh} />

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span className="font-semibold">{data.counts.submitted} awaiting approval</span>
        <span className="text-muted-foreground">{data.counts.approved} ready to send</span>
        <span className="text-muted-foreground">{data.counts.settled} settled</span>
        {data.counts.returned > 0 && (
          <span className="text-red-600 dark:text-red-400">{data.counts.returned} returned</span>
        )}
        <span className="ml-auto text-muted-foreground">
          {formatCents(data.sentTodayCents)} sent today of {formatCents(data.limits.dailyCents)} ·
          {" "}max {formatCents(data.limits.singleCents)} each · via {provider}
        </span>
      </div>

      {canCreate && <RaisePayment data={data} onChanged={refresh} />}

      <PaymentsTable
        data={data}
        canApprove={canApprove}
        canUpdate={canUpdate}
        onChanged={refresh}
      />

      <PayeesPanel data={data} canCreate={canCreate} canUpdate={canUpdate} onChanged={refresh} />
    </div>
  );
}

/**
 * ENROLLING A SECOND FACTOR.
 *
 * On this page because, in this codebase, a second factor exists for exactly
 * one purpose: approving a payment. Nothing could enrol one until now, which
 * meant no payment could ever be approved — so the dependency is shown where it
 * actually bites rather than buried in a settings screen.
 */
function SecondFactorPanel({
  mfa,
  onChanged,
}: {
  mfa: PaymentsOverview["mfa"];
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [setup, setSetup] = React.useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [codes, setCodes] = React.useState<string[] | null>(null);

  const begin = async () => {
    setBusy(true);
    try {
      const res = await beginMfaEnrollmentAction();
      if (!res.ok) return void toast.error(res.error);
      setSetup({ secret: res.secret, uri: res.uri });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await confirmMfaEnrollmentAction({ code });
      if (!res.ok) return void toast.error(res.error);
      // Shown ONCE. They are not retrievable afterwards, only regenerable.
      setCodes(res.recoveryCodes);
      setSetup(null);
      setCode("");
      toast.success("Authenticator set up.");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await regenerateMfaRecoveryCodesAction({ code });
      if (!res.ok) return void toast.error(res.error);
      setCodes(res.recoveryCodes);
      setCode("");
      toast.success("New recovery codes issued. The old ones no longer work.");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "rounded-lg border px-4 py-3",
          mfa.enrolled ? "border-border bg-card" : "border-amber-500/40 bg-amber-500/5"
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          {mfa.enrolled ? (
            <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {mfa.enrolled ? "Authenticator active" : "Approving a payment needs a second factor"}
            </p>
            <p className="text-sm text-muted-foreground">
              {mfa.enrolled
                ? `${mfa.recoveryCodesRemaining} recovery ${mfa.recoveryCodesRemaining === 1 ? "code" : "codes"} left.`
                : mfa.pending
                  ? "Setup was started but never finished — enter a code to complete it."
                  : "Set one up to approve payments. Nothing can be released without it."}
            </p>
          </div>
          {!mfa.enrolled && !setup && (
            <Button onClick={begin} disabled={busy} size="sm">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {mfa.pending ? "Start again" : "Set up"}
            </Button>
          )}
        </div>

        {setup && (
          <div className="mt-4 space-y-3 border-t border-border pt-3">
            <p className="text-sm">
              Open your authenticator and add this account. On a phone,{" "}
              <a href={setup.uri} className="font-medium text-gold underline">
                tap here to add it directly
              </a>
              , or enter the key by hand:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
                {setup.secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(setup.secret);
                  toast.success("Key copied.");
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="mfa-confirm">Code from the app</Label>
                <Input
                  id="mfa-confirm"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="w-32 font-mono"
                />
              </div>
              <Button onClick={confirm} disabled={busy || code.trim().length < 6}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Confirm
              </Button>
            </div>
          </div>
        )}

        {mfa.enrolled && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="space-y-1">
              <Label htmlFor="mfa-regen">New recovery codes</Label>
              <Input
                id="mfa-regen"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Current code"
                className="w-40 font-mono"
              />
            </div>
            <Button variant="outline" onClick={regenerate} disabled={busy || code.trim().length < 6}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Replace codes
            </Button>
            <p className="text-xs text-muted-foreground">
              A current code is required, so a borrowed session cannot lock you out.
            </p>
          </div>
        )}
      </div>

      <Dialog open={codes !== null} onOpenChange={(o) => !o && setCodes(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save these recovery codes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This is the only time they are shown. They cannot be read again — only replaced. Each
            one works once, if you lose the phone.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(codes ?? []).map((c) => (
              <code key={c} className="rounded-md bg-muted px-2 py-1.5 text-center font-mono text-sm">
                {c}
              </code>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText((codes ?? []).join("\n"));
                toast.success("Codes copied.");
              }}
            >
              <Copy className="size-4" />
              Copy all
            </Button>
            <Button onClick={() => setCodes(null)}>I have saved them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * RAISING A PAYMENT.
 *
 * The amount is NOT typeable. `createPayment` requires it to equal the bill
 * exactly — a payment settles a bill in full — so an editable box would be a
 * field whose only possible wrong value is refused after the form is filled in.
 * Picking the bill picks the amount.
 */
function RaisePayment({ data, onChanged }: { data: PaymentsOverview; onChanged: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [billId, setBillId] = React.useState("");
  const [payeeId, setPayeeId] = React.useState("");
  const [bankAccountId, setBankAccountId] = React.useState("");
  const [memo, setMemo] = React.useState("");

  const bill = data.payableBills.find((b) => b.id === billId) ?? null;
  const payable = data.payees.filter((p) => p.active && p.accountLast4 && !p.cooling);
  const overLimit = bill ? bill.amountCents > data.limits.singleCents : false;

  const submit = async () => {
    if (!bill) return;
    setBusy(true);
    try {
      const res = await createPaymentAction({
        payeeId,
        billId: bill.id,
        bankAccountId,
        // Cents in the module, dollars at the action's edge.
        amount: bill.amountCents / 100,
        memo: memo.trim() || null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Payment raised as a draft.");
      setOpen(false);
      setBillId(""); setPayeeId(""); setBankAccountId(""); setMemo("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={data.payableBills.length === 0}>
        <Plus className="size-4" />
        Raise a payment
      </Button>
      {data.payableBills.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No bill is payable right now. A bill must be posted to the books, unpaid, and not already
          have a payment against it.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pay-bill">Bill</Label>
              <select
                id="pay-bill"
                value={billId}
                onChange={(e) => setBillId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a bill…</option>
                {data.payableBills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.billNumber} · {b.vendorName} · {formatCents(b.amountCents)}
                    {b.dueAt ? ` · due ${formatDate(b.dueAt)}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-payee">Payee</Label>
              <select
                id="pay-payee"
                value={payeeId}
                onChange={(e) => setPayeeId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a payee…</option>
                {payable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · ••••{p.accountLast4}
                  </option>
                ))}
              </select>
              {payable.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No payee is payable yet — each needs bank details and must be past its
                  cooling-off period.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-account">From</Label>
              <select
                id="pay-account"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose an account…</option>
                {data.bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.mask ? ` ••••${a.mask}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-memo">Memo</Label>
              <Input id="pay-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} />
            </div>

            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              Amount:{" "}
              <span className="font-semibold">{bill ? formatCents(bill.amountCents) : "—"}</span>
              <span className="text-muted-foreground"> — a payment settles the bill in full.</span>
            </div>
            {overLimit && (
              <p className="text-sm text-red-600 dark:text-red-400">
                That bill is above the {formatCents(data.limits.singleCents)} single-payment limit.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={busy || !bill || !payeeId || !bankAccountId || overLimit}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Raise as draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaymentsTable({
  data,
  canApprove,
  canUpdate,
  onChanged,
}: {
  data: PaymentsOverview;
  canApprove: boolean;
  canUpdate: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [approving, setApproving] = React.useState<PaymentRow | null>(null);
  const [code, setCode] = React.useState("");

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusyId(id);
    try {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "That did not work.");
      toast.success(done);
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const approve = async () => {
    if (!approving) return;
    setBusyId(approving.id);
    try {
      const res = await approvePaymentAction({ paymentId: approving.id, mfaCode: code });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Approved. It still has to be sent.");
      setApproving(null);
      setCode("");
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  if (data.payments.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No payments yet.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Payee</th>
              <th className="px-3 py-2 font-medium">Bill</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Raised by</th>
              <th className="px-3 py-2 font-medium">Approved by</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p) => {
              const busy = busyId === p.id;
              // MAKER-CHECKER, made visible. The module refuses this regardless;
              // saying why is the only thing this line does.
              const ownWork = p.raisedByViewer;
              const approveBlocked = ownWork || !data.mfa.enrolled;
              return (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    {p.payeeName}
                    {p.accountLast4 && (
                      <span className="text-muted-foreground"> ••••{p.accountLast4}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {p.billNumber ?? "—"}
                    {p.vendorName ? ` · ${p.vendorName}` : ""}
                  </td>
                  <td className="px-3 py-2 font-medium">{formatCents(p.amountCents)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_TONE[p.status] ?? "bg-muted text-muted-foreground"
                      )}
                    >
                      {p.status}
                    </span>
                    {p.returnReason && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {p.returnCode ? `${p.returnCode}: ` : ""}{p.returnReason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.createdByName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.approvedByName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {p.status === "draft" && canUpdate && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            run(p.id, () => submitPaymentAction({ paymentId: p.id }), "Sent for approval.")
                          }
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />}
                          Submit
                        </Button>
                      )}
                      {p.status === "submitted" && canApprove && (
                        <Button
                          size="sm"
                          disabled={busy || approveBlocked}
                          title={
                            ownWork
                              ? "You raised this one. Someone else has to approve it."
                              : !data.mfa.enrolled
                                ? "Set up a second factor first."
                                : undefined
                          }
                          onClick={() => setApproving(p)}
                        >
                          <Check className="size-4" />
                          Approve
                        </Button>
                      )}
                      {p.status === "approved" && canApprove && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(p.id, () => sendPaymentAction({ paymentId: p.id }), "Payment sent.")
                          }
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                          Send
                        </Button>
                      )}
                      {["draft", "submitted", "approved"].includes(p.status) && canUpdate && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(p.id, () => cancelPaymentAction({ paymentId: p.id }), "Cancelled.")
                          }
                        >
                          <Ban className="size-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={approving !== null} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {approving ? formatCents(approving.amountCents) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            To {approving?.payeeName}
            {approving?.accountLast4 ? ` ••••${approving.accountLast4}` : ""}. Approving does not
            send it.
          </p>
          <div className="space-y-1">
            <Label htmlFor="approve-code">Code from your authenticator</Label>
            <Input
              id="approve-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-40 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
            <Button onClick={approve} disabled={busyId !== null || code.trim().length < 6}>
              {busyId !== null && <Loader2 className="size-4 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * PAYEES.
 *
 * The masked tail is all that is ever shown, because it is all the server
 * loads — the encrypted columns are never selected. The cooling-off period is
 * surfaced per row: new bank details cannot be paid for a day, which is the
 * control that makes a stolen session an inconvenience rather than a theft.
 */
function PayeesPanel({
  data,
  canCreate,
  canUpdate,
  onChanged,
}: {
  data: PaymentsOverview;
  canCreate: boolean;
  canUpdate: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [routingNumber, setRouting] = React.useState("");
  const [accountNumber, setAccount] = React.useState("");
  const [accountType, setAccountType] = React.useState<"checking" | "savings">("checking");

  const add = async () => {
    setBusy(true);
    try {
      const hasBank = routingNumber.trim() !== "" && accountNumber.trim() !== "";
      const res = await createPayeeAction({
        name: name.trim(),
        email: email.trim() || null,
        vendorId: null,
        bank: hasBank ? { routingNumber: routingNumber.trim(), accountNumber: accountNumber.trim(), accountType } : null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Payee added. Bank details begin their cooling-off period now.");
      setOpen(false);
      setName(""); setEmail(""); setRouting(""); setAccount("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Payees</h2>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Add a payee
          </Button>
        )}
      </div>

      {data.payees.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No payees yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Payable</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.payees.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    {p.name}
                    {!p.active && <span className="text-muted-foreground"> · inactive</span>}
                    {p.vendorName && <span className="text-muted-foreground"> · {p.vendorName}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {p.accountLast4 ? `••••${p.accountLast4} ${p.accountType ?? ""}` : "No bank details"}
                  </td>
                  <td className="px-3 py-2">
                    {!p.accountLast4 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : p.cooling ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        Cooling off{p.payableAt ? ` until ${formatDate(p.payableAt)}` : ""}
                      </span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canUpdate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const res = await setPayeeActiveAction({ payeeId: p.id, active: !p.active });
                          if (!res.ok) return void toast.error(res.error);
                          onChanged();
                        }}
                      >
                        {p.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a payee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="payee-name">Name</Label>
              <Input id="payee-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="payee-email">Email</Label>
              <Input id="payee-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="payee-routing">Routing number</Label>
                <Input
                  id="payee-routing"
                  value={routingNumber}
                  onChange={(e) => setRouting(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="payee-account">Account number</Label>
                <Input
                  id="payee-account"
                  value={accountNumber}
                  onChange={(e) => setAccount(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="payee-type">Account type</Label>
              <select
                id="payee-type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as "checking" | "savings")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Bank details are encrypted, and a new set cannot be paid for 24 hours. Only the last
              four digits are ever shown again.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={busy || name.trim() === ""}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Add payee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
