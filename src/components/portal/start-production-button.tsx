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

  async function start() {
    setBusy(true);
    const res = await ensureProjectForLeadAction(leadId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Production started");
    router.refresh();
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
