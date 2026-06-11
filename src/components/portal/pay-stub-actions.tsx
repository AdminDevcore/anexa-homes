"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileText, Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emailPayStubAction } from "@/server/modules/payroll/actions";

export function PayStubActions({ runId, userId, canEmail }: { runId: string; userId: string; canEmail: boolean }) {
  const [busy, setBusy] = React.useState(false);

  async function email() {
    setBusy(true);
    const res = await emailPayStubAction({ runId, userId });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.dev ? `Pay stub generated (dev — logged for ${res.email})` : `Pay stub emailed to ${res.email}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`/portal/payroll/${runId}/paystub/${userId}`} target="_blank" rel="noreferrer">
          <FileText className="size-3.5" /> Pay stub PDF
        </a>
      </Button>
      {canEmail && (
        <Button variant="outline" size="sm" onClick={email} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Email
        </Button>
      )}
    </div>
  );
}
