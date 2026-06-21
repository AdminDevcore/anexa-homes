"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setDealTypeAction } from "@/server/modules/leads/manage";

type DealType = "cash" | "insurance";

/** Inline Insurance/Cash switch shown in the deal Summary. Read-only users see a
 *  static badge; editors can flip the deal type (drives claim/scope/proposal). */
export function DealTypeToggle({ leadId, value, canEdit }: { leadId: string; value: DealType; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function pick(next: DealType) {
    if (next === value || busy) return;
    setBusy(true);
    const res = await setDealTypeAction({ leadId, dealType: next });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(next === "cash" ? "Switched to cash deal" : "Switched to insurance claim");
    router.refresh();
  }

  if (!canEdit) {
    return <span className="text-sm font-medium capitalize">{value === "cash" ? "Cash / financed" : "Insurance claim"}</span>;
  }

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs font-medium">
      {(["insurance", "cash"] as const).map((t) => (
        <button
          key={t}
          type="button"
          disabled={busy}
          onClick={() => pick(t)}
          className={cn(
            "px-2.5 py-1 transition-colors disabled:opacity-60",
            value === t ? "bg-foreground text-background" : "hover:bg-muted",
          )}
        >
          {t === "insurance" ? "Insurance" : "Cash"}
        </button>
      ))}
    </div>
  );
}
