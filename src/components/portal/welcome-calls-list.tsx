"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendWelcomeCallAction, voidWelcomeCallAction } from "@/server/modules/welcome-call/actions";
import { CALL_KIND_LABELS, type CallKind } from "@/server/modules/welcome-call/types";

type Status = "sent" | "viewed" | "completed" | "voided";
type Row = { id: string; customerName: string; kind: CallKind; templateName: string; status: Status; when: string; leadId: string };

const KIND_BADGE: Record<CallKind, string> = {
  welcome: "bg-sky-100 text-sky-700",
  completion: "bg-violet-100 text-violet-700",
};

const STATUS: Record<Status, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-700" },
  viewed: { label: "Viewed", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-700" },
  voided: { label: "Voided", cls: "bg-neutral-100 text-neutral-500" },
};

export function WelcomeCallsList({ rows, canSend }: { rows: Row[]; canSend: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function resend(id: string) {
    setBusy(id);
    const res = await resendWelcomeCallAction(id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.emailed ? "Re-sent to the customer" : "New link generated");
    router.refresh();
  }
  async function voidCall(id: string) {
    if (!confirm("Turn off this call link? The customer won't be able to use it.")) return;
    setBusy(id);
    const res = await voidWelcomeCallAction(id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Link turned off");
    router.refresh();
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r) => {
        const s = STATUS[r.status];
        const canAct = canSend && r.status !== "completed" && r.status !== "voided";
        return (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link href={`/portal/leads/${r.leadId}`} className="font-medium hover:text-gold-muted">{r.customerName}</Link>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_BADGE[r.kind]}`}>{CALL_KIND_LABELS[r.kind]}</span>
              </div>
              <div className="text-xs text-muted-foreground">{r.templateName} · {r.when}</div>
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-end">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
              {canAct && (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => resend(r.id)}>
                    {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : null} Resend
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => voidCall(r.id)}>Void</Button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
