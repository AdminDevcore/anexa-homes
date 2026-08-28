"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openInPersonProposalSigningAction } from "@/server/modules/solar/proposal-inperson-action";

/**
 * "Sign on this device" — the rep presses it at the table and hands their phone
 * or tablet to the homeowner.
 *
 * It navigates THIS browser to the customer's own proposal link, so what gets
 * signed is exactly the document that would have been emailed. What the press
 * adds is a witness token in the URL, minted server-side, which is the only way
 * a signature is recorded as taken in person rather than remotely.
 *
 * Deliberately a full navigation rather than a dialog: the device is about to
 * change hands, and a modal over the rep's CRM is a customer one stray tap away
 * from a pipeline they should never see.
 */
export function SolarInPersonSignButton({
  proposalId,
  className,
}: {
  proposalId: string;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await openInPersonProposalSigningAction(proposalId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      window.location.href = res.url;
    } catch {
      toast.error("The signing page could not be opened.");
    } finally {
      // Released even on the success path: the navigation may be slow, and a
      // button stuck spinning is the same failure as a button stuck disabled.
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={open} disabled={busy} className={className}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
      Sign on this device
    </Button>
  );
}
