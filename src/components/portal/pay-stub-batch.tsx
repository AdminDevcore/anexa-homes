"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mail, FileStack, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { emailAllPayStubsAction } from "@/server/modules/payroll/actions";

type Result = { name: string; email: string | null; sent: boolean; error?: string };

export function PayStubBatchActions({ runId }: { runId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<Result[] | null>(null);
  const [dev, setDev] = React.useState(false);

  async function emailAll() {
    setBusy(true);
    const res = await emailAllPayStubsAction(runId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setResults(res.results);
    setDev(res.dev);
    toast.success(`${res.sent}/${res.total} pay stub${res.total === 1 ? "" : "s"} ${res.dev ? "generated (dev)" : "emailed"}`);
  }

  return (
    <>
      <Button asChild variant="outline" size="sm">
        <a href={`/portal/payroll/${runId}/paystubs`} target="_blank" rel="noreferrer">
          <FileStack className="size-4" /> Download all stubs
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={emailAll} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Email all stubs
      </Button>

      <Dialog open={!!results} onOpenChange={(o) => !o && setResults(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay stubs {dev ? "generated (dev)" : "emailed"}</DialogTitle></DialogHeader>
          {dev && <p className="text-xs text-muted-foreground">No email provider configured — stubs were generated and logged. Set RESEND_API_KEY to actually send.</p>}
          <ul className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
            {results?.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">{r.email ?? "no email on file"}</span>
                </span>
                {r.sent ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-600"><Check className="size-3.5" /> {dev ? "ready" : "sent"}</span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive"><X className="size-3.5" /> {r.error ?? "failed"}</span>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
