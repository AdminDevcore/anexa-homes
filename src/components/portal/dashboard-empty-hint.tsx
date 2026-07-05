"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Layers, ArrowRight } from "lucide-react";
import type { Industry } from "@prisma/client";
import { setActiveIndustryAction } from "@/server/modules/industry/actions";

/**
 * Shown on the dashboard when the ACTIVE workspace has no deal flow but the user
 * has other workspaces — so a super admin doesn't mistake an empty workspace for
 * "I can't see anything". Offers a one-click switch.
 */
export function DashboardEmptyHint({
  activeLabel,
  others,
}: {
  activeLabel: string;
  others: { ind: Industry; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function switchTo(ind: Industry) {
    if (busy) return;
    setBusy(true);
    const res = await setActiveIndustryAction(ind);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    router.push("/portal/dashboard");
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/[0.06] to-transparent p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
          <Layers className="size-[18px]" />
        </span>
        <div className="flex-1">
          <p className="font-medium">
            Your <span className="font-semibold">{activeLabel}</span> workspace has no deals yet.
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Each workspace is a separate business with its own deals. Your data is likely in another workspace —
            switch below, or from the menu at the top-right.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {others.map((o) => (
              <button
                key={o.ind}
                onClick={() => switchTo(o.ind)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gold/90 disabled:opacity-60"
              >
                Switch to {o.label} <ArrowRight className="size-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
