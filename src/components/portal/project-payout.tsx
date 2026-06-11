"use client";

import { useFormat } from "@/components/portal/branding-provider";
import { CommissionRowActions } from "./commission-actions";
import type { ProjectPayout } from "@/server/modules/costs/queries";

// Per-job commission payout breakdown: every recipient (sales rep, crew, manager
// override, …) with their amount + status, the job total, and what's still owed.
export function ProjectPayoutCard({ payout, canManage }: { payout: ProjectPayout; canManage: boolean }) {
  const fmt = useFormat();
  if (payout.lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No commissions for this job yet. Generate them from the Commissions page or the deal financials below.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {payout.lines.map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">{l.recipient}</div>
            <div className="text-xs text-muted-foreground">
              {l.label ?? "—"} · <span className="capitalize">{l.status}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-sm font-medium">{fmt.money(l.amount)}</span>
            {canManage && <CommissionRowActions id={l.id} status={l.status} />}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2 text-sm font-semibold">
        <span>Total payout</span>
        <span className="tabular-nums">{fmt.money(payout.total)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Paid</span>
        <span className="tabular-nums">{fmt.money(payout.paid)}</span>
      </div>
      {payout.outstanding > 0 && (
        <div className="flex items-center justify-between text-xs font-medium text-gold-muted">
          <span>Outstanding</span>
          <span className="tabular-nums">{fmt.money(payout.outstanding)}</span>
        </div>
      )}
    </div>
  );
}
