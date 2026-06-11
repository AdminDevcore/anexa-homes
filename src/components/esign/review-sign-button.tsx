"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openSigningForOwnerAction } from "@/server/modules/esign/actions";

export function ReviewSignButton({ packageId }: { packageId: string }) {
  const [pending, setPending] = React.useState(false);

  async function open() {
    setPending(true);
    const res = await openSigningForOwnerAction(packageId);
    if (res.ok) {
      window.location.href = res.url;
    } else {
      setPending(false);
      toast.error(res.error);
    }
  }

  return (
    <Button
      onClick={open}
      disabled={pending}
      size="sm"
      className="bg-gold text-gold-foreground hover:bg-gold/90"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
      Review &amp; Sign
    </Button>
  );
}
