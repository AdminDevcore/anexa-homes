"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileDownloadLink } from "@/components/portal/file-download";
import { ResendButton } from "@/components/esign/resend-button";
import { cn } from "@/lib/utils";
import {
  finalDocsLabel,
  isAwaitingSignature,
  type FinalDocsState,
  type FinalDocsTemplate,
} from "@/lib/final-docs";
import { sendFinalDocsAction } from "@/server/modules/esign/actions";

/**
 * "Send final docs to customer", on the finished job.
 *
 * One tap, one envelope, and a status the person who did the install can read
 * without opening anything: the packet is decided once in the template editor,
 * not on the roof. The status is deliberately blind to who sent it — a rule in
 * Settings → Automations firing `send_for_signature` on a packet document
 * fills this same line, so the job shows one answer to "did they sign?" rather
 * than two that can disagree.
 *
 * Nothing here gates on photos or QC. Whoever is standing on the job decides
 * the install is done; the CRM does not second-guess them.
 */
export function FinalDocsPanel({
  leadId,
  templates,
  state,
  customerEmail,
  canSend,
}: {
  leadId: string;
  /** The packet, in the order it will print. Empty when nothing is ticked. */
  templates: FinalDocsTemplate[];
  state: FinalDocsState;
  customerEmail: string | null;
  canSend: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const email = customerEmail?.trim() || null;
  // Every reason the button cannot send, in the order the person reading it can
  // do something about. A disabled button that does not say why is the thing
  // this replaces.
  const blocked = !canSend
    ? "You do not have permission to send documents."
    : templates.length === 0
      ? "No documents are marked as final documents yet."
      : !email
        ? "This deal has no email address on file."
        : null;

  async function send() {
    setPending(true);
    const res = await sendFinalDocsAction(leadId);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setOpen(false);
    toast.success("Final documents sent for signature.");
    router.refresh();
  }

  const sentOnce = state.kind !== "none";

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant={sentOnce ? "outline" : "default"}
            disabled={!!blocked || pending}
            onClick={() => setOpen(true)}
          >
            <Send className="size-4" />
            {sentOnce ? "Send again" : "Send final docs to customer"}
          </Button>
          <StatusChip state={state} />
        </div>

        <div className="flex items-center gap-2">
          {state.kind !== "none" && isAwaitingSignature(state.kind) && canSend && (
            <ResendButton packageId={state.packageId} />
          )}
          {state.kind === "signed" && state.signedFileId && (
            <FileDownloadLink
              id={state.signedFileId}
              name="Signed final documents"
              label="Download signed PDF"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:border-solar/40"
            />
          )}
        </div>
      </div>

      {blocked ? (
        <p className="text-xs text-muted-foreground">
          {blocked}{" "}
          {templates.length === 0 && canSend && (
            <Link href="/portal/documents" className="underline hover:text-foreground">
              Mark them in Documents → Templates
            </Link>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {templates.map((t) => t.name).join(" · ")} — one signing link to {email}.
        </p>
      )}

      {state.kind !== "none" && (
        <p className="text-xs text-muted-foreground">
          <Link
            href={`/portal/documents/${state.packageId}`}
            className="underline hover:text-foreground"
          >
            Open the signature record
          </Link>
        </p>
      )}

      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send final documents?</DialogTitle>
            <DialogDescription>
              {/* Named in full before anything leaves: this emails a homeowner,
                  and the packet was chosen by somebody else, somewhere else. */}
              These go to {email} as one signing link, in this order.
            </DialogDescription>
          </DialogHeader>

          <ol className="space-y-1.5 text-sm">
            {templates.map((t, i) => (
              <li key={t.id} className="flex gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="font-medium">{t.name}</span>
              </li>
            ))}
          </ol>

          {sentOnce && (
            <p className="text-xs text-muted-foreground">
              A packet has already gone out on this deal. Sending again creates a new signature
              request; the previous one stays on the deal as it is.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={send} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send for signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The status the installer reads. Three tones, because there are only three
 * things worth knowing at a glance: it is done, it is out, or it went wrong.
 */
function StatusChip({ state }: { state: FinalDocsState }) {
  const label = finalDocsLabel(state.kind);
  const at = state.kind === "none" ? null : state.at;
  const when = at ? new Date(at).toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) : null;

  const signed = state.kind === "signed";
  const bad = state.kind === "declined" || state.kind === "voided" || state.kind === "expired";
  const Icon = signed ? CheckCircle2 : bad ? XCircle : Clock;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        signed && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
        bad && "border-red-500/40 bg-red-500/10 text-red-600",
        !signed && !bad && "border-border text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
      {when && ` ${when}`}
    </span>
  );
}
