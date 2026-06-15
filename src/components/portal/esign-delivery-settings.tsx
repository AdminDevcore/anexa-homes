"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setEmailSignedCopyToSignersAction } from "@/server/modules/settings/actions";

/** Document delivery — what gets sent to signers when an envelope completes. */
export function EsignDeliverySettings({ emailSignedCopyToSigners }: { emailSignedCopyToSigners: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(emailSignedCopyToSigners);
  const [pending, setPending] = React.useState(false);

  async function toggle(next: boolean) {
    setEnabled(next); // optimistic
    setPending(true);
    const res = await setEmailSignedCopyToSignersAction(next);
    setPending(false);
    if (res.ok) {
      toast.success(next ? "Signers will receive a signed copy" : "Signed-copy email turned off");
      router.refresh();
    } else {
      setEnabled(!next); // revert
      toast.error(res.error);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <FileCheck2 className="size-4 text-gold" /> Document delivery
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What signers receive once every party has signed.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div className="pr-4">
          <Label className="font-normal">Email signers a copy of the signed document</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When a document is fully executed, email each signer the completed PDF — including the
            signature audit trail — as an attachment for their records.
          </p>
        </div>
        <Switch checked={enabled} disabled={pending} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
