"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/components/portal/branding-provider";

export type JobProfitRow = {
  projectId: string;
  leadId: string | null;
  label: string;
  repName: string | null;
  repSplitPct: number | null;
  repDeductiblePct: number | null;
  repWaivesSupplement: boolean;
  supplementWaivedKeptCents: number;
  companyProvidedLead: boolean;
  contractCents: number;
  supplementCents: number;
  deductibleCents: number;
  collectibleCents: number;
  collectedCents: number;
  leftToCollectCents: number;
  estCostCents: number;
  actualCostCents: number;
  overheadCents: number;
  paFeeCents: number;
  repCommissionEstCents: number;
  repCommissionActualCents: number | null; // null until commissions generated
  overridesActualCents: number | null;
  totalCommissionActualCents: number | null;
  estProfitCents: number;
  actualProfitCents: number | null;
  hasActual: boolean;
  commissionLines: { recipient: string; label: string | null; amountCents: number }[];
};

/**
 * Per-customer estimated vs. actual: profit, rep commission, cost, and money to
 * collect. Each cell stacks the estimate over the actual. Expand a row for the
 * full Deal-Financials waterfall (incl. overrides/crew, which actual profit nets out).
 */
/**
 * "Profit comes last": collections first cover obligations (cost + commissions);
 * only the excess is realized company profit. Returns the company profit that is
 * still UNCOLLECTED for this job.
 */
function profitLeftToCollect(profitCents: number, collectibleCents: number, collectedCents: number): number {
  if (profitCents <= 0) return profitCents; // a loss isn't "collected"
  const obligationsCents = collectibleCents - profitCents; // cost + commissions
  const realized = Math.min(profitCents, Math.max(0, collectedCents - obligationsCents));
  return profitCents - realized;
}

export function JobProfitabilityTable({ rows }: { rows: JobProfitRow[] }) {
  const fmt = useFormat();
  const [open, setOpen] = React.useState<string | null>(null);
  const m = (c: number) => fmt.money(c);
  const est = true; // estimated-only view (Actual toggle retired per owner)

  const t = rows.reduce(
    (a, r) => ({
      collectible: a.collectible + r.collectibleCents,
      collected: a.collected + r.collectedCents,
      left: a.left + r.leftToCollectCents,
      repEst: a.repEst + r.repCommissionEstCents,
      repAct: a.repAct + (r.repCommissionActualCents ?? 0),
      costEst: a.costEst + r.estCostCents,
      costAct: a.costAct + r.actualCostCents,
      profEst: a.profEst + r.estProfitCents,
      profAct: a.profAct + (r.actualProfitCents ?? 0),
      profLeftEst: a.profLeftEst + profitLeftToCollect(r.estProfitCents, r.collectibleCents, r.collectedCents),
      profLeftAct: a.profLeftAct + (r.actualProfitCents != null ? profitLeftToCollect(r.actualProfitCents, r.collectibleCents, r.collectedCents) : 0),
    }),
    { collectible: 0, collected: 0, left: 0, repEst: 0, repAct: 0, costEst: 0, costAct: 0, profEst: 0, profAct: 0, profLeftEst: 0, profLeftAct: 0 }
  );
  return (
    <div className="space-y-6">
      {/* Summary cards (estimated — projected from scope cost + split rules) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Company profit" value={m(t.profEst)} tone={t.profEst >= 0 ? "pos" : "neg"} hint={`${rows.length} jobs`} />
        <SummaryCard label="Profit left to collect" value={m(t.profLeftEst)} tone={t.profLeftEst > 0 ? "neg" : "pos"} hint="not yet realized" />
        <SummaryCard label="Rep commission" value={m(t.repEst)} tone="neutral" hint="estimated" />
        <SummaryCard label="Left to collect" value={m(t.left)} tone="neutral" hint="all money owed" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Customer</th>
              <th className="px-4 py-3 text-right font-medium">To collect / collected</th>
              <th className="px-4 py-3 text-right font-medium">Rep commission</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 text-right font-medium">Company profit / left to collect</th>
              <th className="px-4 py-3 text-right font-medium">Left</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No jobs with financials yet.</td></tr>
            )}
            {rows.map((r) => {
              const isOpen = open === r.projectId;
              return (
                <React.Fragment key={r.projectId}>
                  <tr className="cursor-pointer align-top hover:bg-muted/40" onClick={() => setOpen(isOpen ? null : r.projectId)}>
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-1.5">
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                        {r.label}
                      </span>
                    </td>
                    <Pair top={m(r.collectibleCents)} bottom={`${m(r.collectedCents)} in`} />
                    {(() => {
                      const rep = est ? r.repCommissionEstCents : r.repCommissionActualCents;
                      const cost = est ? r.estCostCents : r.actualCostCents;
                      const profit = est ? r.estProfitCents : r.actualProfitCents;
                      const profLeft = profit != null ? profitLeftToCollect(profit, r.collectibleCents, r.collectedCents) : null;
                      return (
                        <>
                          <NumCell value={rep == null ? "—" : m(rep)} />
                          <NumCell value={m(cost)} />
                          {profit == null ? (
                            <NumCell value="est. only" />
                          ) : (
                            <Pair top={m(profit)} bottom={`${m(profLeft ?? 0)} left`} topTone={profit >= 0 ? "pos" : "neg"} bottomTone="mute" />
                          )}
                        </>
                      );
                    })()}
                    <td className="px-4 py-3 text-right align-middle tabular-nums font-medium">{m(r.leftToCollectCents)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="px-4 py-4">
                        <Waterfall row={r} money={m} est={est} leadHref={r.leadId ? `/portal/leads/${r.leadId}` : null} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border align-top font-semibold">
                <td className="px-4 py-3">Totals</td>
                <Pair top={m(t.collectible)} bottom={`${m(t.collected)} in`} />
                <NumCell value={m(t.repEst)} />
                <NumCell value={m(t.costEst)} />
                <Pair top={m(t.profEst)} bottom={`${m(t.profLeftEst)} left`} topTone={t.profEst >= 0 ? "pos" : "neg"} bottomTone="mute" />
                <td className="px-4 py-3 text-right align-middle tabular-nums">{m(t.left)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Profit is projected from the scope cost template and nets out the rep&rsquo;s commission. &ldquo;Profit left to collect&rdquo;
        is the company profit not yet realized (collections cover cost + commissions first). Figures match each deal&rsquo;s Financials.
        Click a row for the full waterfall.
      </p>
    </div>
  );
}

function NumCell({ value, tone }: { value: string; tone?: "pos" | "neg" }) {
  return (
    <td className={cn("px-4 py-3 text-right align-middle tabular-nums", tone === "pos" && "text-emerald-600", tone === "neg" && "text-red-600")}>
      {value}
    </td>
  );
}

function Pair({ top, bottom, topTone, bottomTone }: { top: string; bottom: string; topTone?: "pos" | "neg"; bottomTone?: "pos" | "neg" | "mute" }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums">
      <div className={cn(topTone === "pos" && "text-emerald-600", topTone === "neg" && "text-red-600")}>{top}</div>
      <div className={cn("text-xs", bottomTone === "pos" ? "text-emerald-600" : bottomTone === "neg" ? "text-red-600" : "text-muted-foreground")}>{bottom}</div>
    </td>
  );
}

/** Deal-financials waterfall for one job. Right column adapts to the est/actual view. */
function Waterfall({ row, money, est, leadHref }: { row: JobProfitRow; money: (c: number) => string; est: boolean; leadHref: string | null }) {
  const costCents = est ? row.estCostCents : row.actualCostCents;
  const poolRevenueCents = row.contractCents + row.supplementCents; // deductible excluded
  // Pool = (contract + supplement) − cost − overhead − PA fee.
  const poolCents = poolRevenueCents - costCents - row.overheadCents - row.paFeeCents;
  const lead = row.companyProvidedLead ? "provided lead" : "self-gen";
  const pct = row.repSplitPct;
  const dedPct = row.repDeductiblePct; // separate % for the deductible
  const pctLabel = pct != null ? `${pct}%` : "rep split";
  // Rep total → split into pool share + deductible share for display.
  const repTotal = est ? row.repCommissionEstCents : row.repCommissionActualCents;
  const dedShareCents = dedPct != null ? Math.round((row.deductibleCents * dedPct) / 100) : 0;
  const poolShareCents = repTotal != null ? repTotal - dedShareCents : null;
  const profit = est ? row.estProfitCents : row.actualProfitCents;

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {/* Build-up to the pool (contract + supplement only) */}
      <div className="grid max-w-sm gap-1 text-sm">
        <Line label="Contract" value={money(row.contractCents)} />
        {row.supplementCents > 0 && <Line label="+ Supplement" value={money(row.supplementCents)} muted />}
        <div className="my-1 border-t border-border/60" />
        <Line label="= Pool revenue" value={money(poolRevenueCents)} strong />
        <Line label={`− Job cost ${est ? "(estimated)" : "(actual)"}`} value={`−${money(costCents)}`} tone="out" />
        {row.overheadCents > 0 && <Line label="− Company overhead" value={`−${money(row.overheadCents)}`} tone="out" />}
        {row.paFeeCents > 0 && <Line label="− PA fee (supplement)" value={`−${money(row.paFeeCents)}`} tone="out" />}
        <div className="my-1 border-t-2 border-border" />
        <Line label="= Profit pool" value={money(poolCents)} strong />
        {row.repWaivesSupplement && row.supplementWaivedKeptCents > 0 && (
          <Line label="− Supplement kept by company (rep waived)" value={`−${money(row.supplementWaivedKeptCents)}`} tone="out" small />
        )}
        {row.deductibleCents > 0 && (
          <Line label="+ Deductible (collected separately)" value={money(row.deductibleCents)} muted small />
        )}
      </div>

      {/* Rep commission + company profit */}
      <div className="grid max-w-sm gap-1 text-sm">
        {repTotal == null ? (
          <p className="text-sm text-muted-foreground">Commissions not generated yet — switch to Estimated, or generate this deal&rsquo;s commission to see the actual split.</p>
        ) : (
          <>
            <Line label={`Rep commission — ${row.repName ?? "rep"} (${pctLabel} · ${lead})`} value={money(repTotal)} strong />
            {poolShareCents != null && <Line label="· pool share" value={money(poolShareCents)} muted small />}
            {row.deductibleCents > 0 && dedPct != null && dedPct > 0 && (
              <Line label={`· deductible share (${dedPct}% of ${money(row.deductibleCents)})`} value={money(dedShareCents)} muted small />
            )}
            <div className="my-1 border-t-2 border-border" />
            <Line label={`= ${est ? "Estimated" : "Actual"} company profit`} value={money(profit ?? 0)} strong bigTone={(profit ?? 0) >= 0 ? "pos" : "neg"} />
            {profit != null && (
              <Line
                label="· still to collect (profit comes last)"
                value={money(profitLeftToCollect(profit, row.collectibleCents, row.collectedCents))}
                muted
                small
              />
            )}
          </>
        )}
        <p className="pt-0.5 text-[11px] text-muted-foreground">
          Company keeps the rest of the pool, {money(row.overheadCents)} retained overhead, and the rest of the deductible
          {!est && (row.overridesActualCents ?? 0) > 0 ? `, after ${money(row.overridesActualCents ?? 0)} in manager overrides & crew` : ""}.
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Collected {money(row.collectedCents)} · Left {money(row.leftToCollectCents)}</span>
          {leadHref && <Link href={leadHref} className="text-gold-muted hover:underline">Open deal →</Link>}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, tone, strong, muted, small, bigTone }: { label: string; value: string; tone?: "out"; strong?: boolean; muted?: boolean; small?: boolean; bigTone?: "pos" | "neg" }) {
  return (
    <div className={cn("flex items-center justify-between py-0.5", strong && "font-semibold", small && "text-xs")}>
      <span className={cn(strong ? "text-foreground" : "text-muted-foreground", muted && "text-muted-foreground")}>{label}</span>
      <span className={cn("tabular-nums", tone === "out" ? "text-red-600" : bigTone === "pos" ? "text-emerald-600" : bigTone === "neg" ? "text-red-600" : "")}>{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, tone, hint, small }: { label: string; value: string; tone: "pos" | "neg" | "neutral"; hint: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{hint}</span>
      </div>
      <div className={cn("mt-2 font-display font-semibold tracking-tight", small ? "text-lg" : "text-2xl", tone === "pos" && "text-emerald-600", tone === "neg" && "text-red-600")}>{value}</div>
    </div>
  );
}
