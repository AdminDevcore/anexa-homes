"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Hammer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureProjectForLeadAction } from "@/server/modules/projects/actions";

export function StartProductionButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  /**
   * The `finally` is the point.
   *
   * Without it, a server action that THROWS — rather than returning
   * `{ok:false}` — skips the rest of this function, so `busy` stays true and
   * the button sits disabled with a spinner on it and no message, forever.
   * That is exactly what a unique-constraint failure looked like from the
   * outside: a dead button and nothing to go on.
   */
  async function start() {
    setBusy(true);
    try {
      const res = await ensureProjectForLeadAction(leadId);
      if (!res.ok) return toast.error(res.error);
      toast.success("Production started");
      router.refresh();
    } catch {
      toast.error("Could not start production. Try again, and tell us if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">
        Move this deal into production to track crew, QC, daily reports, and install photos.
      </p>
      <Button onClick={start} disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
        Start production
      </Button>
    </div>
  );
}
