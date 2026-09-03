"use client";

import * as React from "react";
import { toast } from "sonner";
import { ExternalLink, Send, ShieldAlert, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  amosSubmissionStatusAction,
  submitDealToLenderAction,
} from "@/server/modules/solar/amos-actions";

/**
 * Sending a priced deal straight into the lender's system.
 *
 * REP-FACING, deliberately, and nowhere near the customer's proposal. The
 * proposal is a frozen record of what was offered and says in as many words
 * that nothing is submitted from it; submitting from there would make that
 * sentence false and would let a homeowner open a credit file by tapping a
 * button in a PDF-like page.
 *
 * The card renders NOTHING when the deal's lender has no integration. That is
 * the common case, and a partner without one keeps the proposal's Qualify link
 * exactly as it was.
 */

type Status =
  | { mode: "loading" }
  | { mode: "link" }
  | { mode: "api"; lenderName: string; ready: true }
  | { mode: "api"; lenderName: string; ready: false; problems: string[] };

type Sent = { referenceNumber: string; customerUrl: string | null; sentTo: string };

export function SolarSendToLender({
  leadId,
  canEdit,
  customerName,
  propertyLine,
  systemLine,
  amountLine,
}: {
  leadId: string;
  canEdit: boolean;
  /** Shown back to the rep so they can see what is about to be sent. */
  customerName: string;
  propertyLine: string;
  systemLine: string;
  amountLine: string;
}) {
  const [status, setStatus] = React.useState<Status>({ mode: "loading" });
  const [open, setOpen] = React.useState(false);
  const [ownerOccupied, setOwnerOccupied] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<Sent | null>(null);
  const [copied, setCopied] = React.useState(false);

  const refresh = React.useCallback(() => {
    void amosSubmissionStatusAction(leadId).then((s) => setStatus(s as Status));
  }, [leadId]);

  React.useEffect(refresh, [refresh]);

  if (status.mode === "loading" || status.mode === "link") return null;

  async function send() {
    if (ownerOccupied === null) return;
    setBusy(true);
    const res = await submitDealToLenderAction({ leadId, ownerOccupied, delivery: "in_person" });
    setBusy(false);

    if (!res.ok) {
      // The rep is standing with a customer. Say what to do, not just what broke.
      if (res.kind === "config") {
        toast.error(res.error, { description: "An administrator has to fix this in Settings → Lenders." });
      } else if (res.kind === "transient") {
        toast.error(res.error, { description: "Try again — re-sending the same deal is safe." });
      } else {
        toast.error(res.error, {
          description: res.problems?.join(" ") ?? "Fix the deal and send again.",
        });
      }
      // The deal may have changed underneath; re-read what is blocking.
      refresh();
      return;
    }

    setSent({
      referenceNumber: res.referenceNumber,
      customerUrl: res.customerUrl,
      sentTo: res.sentTo,
    });
    setOpen(false);
    toast.success(`Sent — reference ${res.referenceNumber}`);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Send to {status.lenderName}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Creates the application with everything on this deal already filled in. The customer
            still enters their SSN and date of birth and authorises the credit check themselves.
          </p>
        </div>

        {status.ready && canEdit && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Send className="size-4" /> Send deal
          </Button>
        )}
      </div>

      {/* Why the button is not there — never a disabled control with no reason. */}
      {!status.ready && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <ShieldAlert className="size-3.5" /> This deal is not ready to send
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
            {status.problems.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </div>
      )}

      {sent && (
        <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium">
            Sent · reference {sent.referenceNumber}
            {sent.sentTo ? ` · emailed to ${sent.sentTo}` : ""}
          </p>
          {sent.customerUrl && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="xs" asChild>
                <a href={sent.customerUrl} target="_blank" rel="noopener noreferrer">
                  Open application <ExternalLink className="size-3" />
                </a>
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(sent.customerUrl as string);
                  setCopied(true);
                  toast.success("Link copied");
                }}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />} Copy link
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this deal to {status.lenderName}?</DialogTitle>
            <DialogDescription>
              This creates a real application. Their name, address and system details are sent now;
              they enter their own SSN and authorise the credit check on the next screen.
            </DialogDescription>
          </DialogHeader>

          <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <Row k="Customer" v={customerName} />
            <Row k="Property" v={propertyLine} />
            <Row k="System" v={systemLine} />
            <Row k="Financing" v={amountLine} />
          </dl>

          {/* Anexa does not record this anywhere, and the lender requires it, so
              it is asked at send time rather than guessed. */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Does the customer live in this home?</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={ownerOccupied === true ? "default" : "outline"}
                onClick={() => setOwnerOccupied(true)}
              >
                Yes
              </Button>
              <Button
                type="button"
                size="sm"
                variant={ownerOccupied === false ? "default" : "outline"}
                onClick={() => setOwnerOccupied(false)}
              >
                No
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={send} disabled={busy || ownerOccupied === null}>
              {busy ? "Sending…" : "Send and open application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 text-right font-medium">{v}</dd>
    </div>
  );
}
