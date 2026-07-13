"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openInPersonSigningAction } from "@/server/modules/esign/actions";

/**
 * "Sign on this device" — the rep taps this on their own phone/tablet, then hands
 * it to the customer to sign in person (no email). It mints a fresh signing link
 * for the given signer and navigates THIS device to it. Enforces signing order
 * server-side, so it only appears for the signer who can sign next.
 */
export function InPersonSignButton({
  packageId,
  signerId,
  label = "Sign on this device",
  primary = false,
  className,
}: {
  packageId: string;
  signerId?: string;
  label?: string;
  primary?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  async function open() {
    setBusy(true);
    const res = await openInPersonSigningAction(packageId, signerId);
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error);
      return;
    }
    // Hand the device over: take this browser straight to the signing page.
    window.location.href = res.url;
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={primary ? "default" : "outline"}
      onClick={open}
      disabled={busy}
      className={primary ? `bg-gold text-gold-foreground hover:bg-gold/90 ${className ?? ""}` : className}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
      {label}
    </Button>
  );
}
