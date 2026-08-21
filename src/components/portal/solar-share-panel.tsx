"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Link2, Loader2, Mail, MessageSquare, Send, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  sendSolarProposalAction,
  setProposalComparisonAction,
} from "@/server/modules/solar/proposal-actions";

/**
 * Getting the proposal to the customer, and choosing what they see when it
 * arrives.
 *
 * The two halves are separate on purpose. SHARE does something irreversible —
 * a homeowner reads it — and is a button you press once you mean it. SETTINGS
 * changes what the same document renders and can be flipped all evening
 * without reissuing anything, because it does not touch a single number in the
 * snapshot.
 *
 * "Mark sent" used to be the whole of this: a rep pasted the link into their
 * own mail client, came back and ticked a box. The deal then recorded the tick,
 * not the send.
 */
export function SolarSharePanel({
  proposalId,
  leadId,
  version,
  customerEmail,
  customerPhone,
  publicToken,
  sentAt,
  viewedAt,
  showComparison,
  canEdit,
}: {
  proposalId: string;
  leadId: string;
  version: number;
  customerEmail: string | null;
  customerPhone: string | null;
  /** NULL until the first real send — an unsent proposal has no public link. */
  publicToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  showComparison: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [email, setEmail] = React.useState(Boolean(customerEmail));
  const [sms, setSms] = React.useState(false);
  const [note, setNote] = React.useState("");

  async function send() {
    setBusy(true);
    const res = await sendSolarProposalAction({ proposalId, email, sms, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Sent by ${res.delivered.join(" and ")}`);
    router.refresh();
  }

  async function toggleComparison(next: boolean) {
    setBusy(true);
    const res = await setProposalComparisonAction(proposalId, next);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(next ? "Comparison shown" : "Comparison hidden");
    router.refresh();
  }

  /**
   * The customer's link, assembled at the moment it is copied.
   *
   * A "use client" component still renders once on the server, where there is
   * no `window` — so reading `window.location.origin` in the body threw
   * "window is not defined" on every solar deal that already had a sent
   * proposal, and the builder page had to fall back to a client render to come
   * back from it. Nothing needs the origin until a rep asks for the link, and
   * by then there is a browser under it.
   */
  async function copyLink() {
    if (!publicToken) return;
    await navigator.clipboard.writeText(`${window.location.origin}/proposal/${publicToken}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl space-y-5 rounded-xl border border-border p-4">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Share v{version}
          </h4>
          {sentAt && (
            <span className="rounded-full border chip-info px-2 py-0.5 text-[11px] font-medium">
              sent {new Date(sentAt).toLocaleDateString()}
              {viewedAt ? " · opened" : " · not opened yet"}
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          What goes out is the live document, not an attachment — it records when they open it, it
          cannot go stale in an inbox, and they can still print it from the page.
        </p>

        <fieldset className="flex flex-wrap gap-4" disabled={!canEdit || busy}>
          <legend className="sr-only">How to send it</legend>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={email}
              disabled={!customerEmail}
              onChange={(e) => setEmail(e.target.checked)}
            />
            <Mail className="size-4 text-muted-foreground" />
            Email
            <span className="text-xs text-muted-foreground">
              {customerEmail ?? "none on the deal"}
            </span>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={sms}
              disabled={!customerPhone}
              onChange={(e) => setSms(e.target.checked)}
            />
            <MessageSquare className="size-4 text-muted-foreground" />
            Text
            <span className="text-xs text-muted-foreground">
              {customerPhone ?? "none on the deal"}
            </span>
          </label>
        </fieldset>

        {canEdit && (
          <div className="space-y-1">
            <Label htmlFor="share-note" className="text-xs">
              Add a line (optional)
            </Label>
            <Textarea
              id="share-note"
              rows={2}
              value={note}
              placeholder="Great meeting you today — here's the system we talked about."
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button size="sm" onClick={send} disabled={busy || (!email && !sms)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sentAt ? "Send again" : "Send to the customer"}
            </Button>
          )}
          {/* The link is offered only once it exists, which is after the first
              real send — an unsent proposal has no public surface. */}
          {publicToken && (
            <Button size="sm" variant="outline" onClick={copyLink}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          )}
          {!publicToken && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="size-3.5" /> The customer link is created by the first send.
            </span>
          )}
        </div>

        {!customerEmail && !customerPhone && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            This deal has no email address and no phone number, so there is nobody to send it to.
            Add one on the Customer step.
          </p>
        )}
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What they see
        </h4>
        <label
          className={cn(
            "flex items-start gap-2.5 text-sm",
            (!canEdit || busy) && "pointer-events-none opacity-60"
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={showComparison}
            disabled={!canEdit || busy}
            onChange={(e) => void toggleComparison(e.target.checked)}
          />
          <span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Table2 className="size-4 text-muted-foreground" />
              The 25-year comparison
            </span>
            <span className="block text-xs text-muted-foreground">
              Utility against solar, year by year. Changing this does not reissue the proposal or
              move a single figure in it — it only decides whether that section is on the page.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
