"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, FilePlus2, Receipt, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormat } from "@/components/portal/branding-provider";
import { computeDealCommission } from "@/lib/commission";
import { generateDealCommissionAction, setDealAdjustmentAction, setDealLeadProvidedAction, setDealRepGetsAction } from "@/server/modules/costs/actions";
import type { DealFinancials } from "@/server/modules/costs/queries";

type AdjField = "supplement" | "deductible";

export function DealFinancialsCard({
  financials,
  projectId,
  canManage,
  commissionEligible = true,
  gateLabel = "Depreciation Requested",
}: {
  financials: DealFinancials;
  projectId: string;
  canManage: boolean;
  commissionEligible?: boolean;
  gateLabel?: string;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  // Inline editor for supplement / deductible amounts.
  const [editing, setEditing] = React.useState<null | AdjField>(null);
  const [adjAmount, setAdjAmount] = React.useState("");


  // Live breakdown: revenue − cost − overhead − PA fee = pool, split with the rep.
  const dc = computeDealCommission({
    baseCents: financials.contractValue,
    supplementCents: financials.supplementCents,
    deductibleCents: financials.deductibleCents,
    costCents: financials.jobCostCents,
    overheadPct: financials.overheadPct,
    paFeePct: financials.paFeePct,
    repSplitPct: financials.rep?.splitPct ?? 0,
    repDeductiblePct: financials.rep?.deductiblePct ?? 0,
    repWaivesSupplement: !financials.repGetsSupplement,
  });
  const ADJ_AMOUNT: Record<AdjField, number> = {
    supplement: financials.supplementCents,
    deductible: financials.deductibleCents,
  };
  const ADJ_LABEL: Record<AdjField, string> = {
    supplement: "Approved supplement",
    deductible: "Customer-paid deductible",
  };

  function openAdj(field: AdjField) {
    setEditing(field);
    setAdjAmount(String((ADJ_AMOUNT[field] || 0) / 100 || ""));
  }
  async function saveAdj() {
    if (!editing) return;
    const amountCents = Math.round((Number(adjAmount) || 0) * 100);
    if (amountCents < 0) return toast.error("Enter a valid amount.");
    setBusy(true);
    const res = await setDealAdjustmentAction({ projectId, field: editing, amountCents });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${ADJ_LABEL[editing]} updated`);
    setEditing(null);
    router.refresh();
  }
  async function generate() {
    setBusy(true);
    const res = await generateDealCommissionAction(projectId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Rep commission set: ${fmt.money(res.amount)}`);
    router.refresh();
  }
  async function toggleLeadProvided() {
    setBusy(true);
    const res = await setDealLeadProvidedAction({ projectId, provided: !financials.companyProvidedLead });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(financials.companyProvidedLead ? "Switched to self-gen split" : "Using company-provided-lead split");
    router.refresh();
  }
  async function toggleRepWaives() {
    setBusy(true);
    const res = await setDealRepGetsAction({ projectId, field: "supplement", value: !financials.repGetsSupplement });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(financials.repGetsSupplement ? "Rep waived the supplement — paid on base only" : "Rep gets the supplement in their split");
    router.refresh();
  }

  const Row = ({ label, value, strong, sub }: { label: string; value: string; strong?: boolean; sub?: boolean }) => (
    <div className={cn("flex items-center justify-between py-1 text-sm", strong && "border-t border-border pt-2 font-semibold", sub && "pl-3 text-muted-foreground")}>
      <span className={cn(!strong && !sub && "text-muted-foreground")}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Job cost — pulled from Bookkeeping (approved, deal-tagged expenses; contractor/sales payouts excluded). */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">
            Job cost <span className="text-xs font-normal text-muted-foreground">· from Bookkeeping</span>
          </span>
          <span className="text-sm font-semibold tabular-nums">{fmt.money(financials.jobCostCents)}</span>
        </div>
        {financials.jobCostExpenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved expenses tagged to this deal yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {financials.jobCostExpenses.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {new Date(e.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {e.description}
                  {e.vendor && <span className="text-muted-foreground"> · {e.vendor}</span>}
                  {e.category && <span className="text-muted-foreground"> · {e.category}</span>}
                </span>
                <span className="font-medium tabular-nums">{fmt.money(e.costCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Costs flow from <strong>Bookkeeping</strong>: tag a transaction to this deal, set its category &amp; vendor, then approve it. Contractor/sales payouts are excluded.{" "}
          <a href="/portal/bookkeeping" className="text-gold underline">Open Bookkeeping →</a>
        </p>
      </div>

      {/* Supplement / deductible — both increase the effective contract value */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openAdj("supplement")}>
            <FilePlus2 className="size-3.5" /> Supplement{financials.supplementCents > 0 ? `: ${fmt.money(financials.supplementCents)}` : ""}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openAdj("deductible")}>
            <Receipt className="size-3.5" /> Deductible{financials.deductibleCents > 0 ? `: ${fmt.money(financials.deductibleCents)}` : ""}
          </Button>
          {/* Rep waives the supplement — paid early on the base only; the company
              keeps the whole supplement (minus the PA fee). Only when supplemented. */}
          {financials.supplementCents > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={toggleRepWaives}
              disabled={busy}
              className={cn(!financials.repGetsSupplement && "border-amber-400 bg-amber-50 text-amber-700")}
              title="When waived, the rep is paid early without the supplement; the company keeps that supplement (minus the PA fee)."
            >
              {financials.repGetsSupplement ? "Rep gets supplement ✓" : "Rep waived supplement"}
            </Button>
          )}
          {/* Lead source toggle — picks the provided-lead vs self-gen split. */}
          <Button
            size="sm"
            variant="outline"
            onClick={toggleLeadProvided}
            disabled={busy}
            className={cn(financials.companyProvidedLead && "border-gold bg-gold/10 text-gold-muted")}
            title="Company-provided leads use the rep's provided-lead split; self-gen uses their standard split."
          >
            <Tag className="size-3.5" /> {financials.companyProvidedLead ? "Company-provided lead ✓" : "Company-provided lead?"}
          </Button>
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 rounded-lg border border-border p-3">
          <span className="text-sm font-medium">{ADJ_LABEL[editing]}</span>
          <Input
            className="ml-auto w-36"
            inputMode="decimal"
            placeholder="Amount ($)"
            value={adjAmount}
            autoFocus
            onChange={(e) => setAdjAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveAdj()}
          />
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button size="sm" onClick={saveAdj} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" />} Save</Button>
        </div>
      )}

      {/* Breakdown — pool on (contract + supplement); the deductible is split apart. */}
      <div className="rounded-lg border border-border p-3">
        <Row label="Contract value" value={fmt.money(financials.contractValue)} />
        {financials.supplementCents > 0 && <Row label="+ Supplement" value={fmt.money(financials.supplementCents)} sub />}
        <Row label="= Pool revenue" value={fmt.money(dc.poolBaseCents)} strong />
        <Row label="− Job cost" value={`−${fmt.money(financials.jobCostCents)}`} />
        <Row label={`− Company overhead (${financials.overheadPct}% of pool revenue)`} value={`−${fmt.money(dc.overheadCents)}`} />
        {dc.paFeeCents > 0 && (
          <Row label={`− PA fee (${financials.paFeePct}% of supplement)`} value={`−${fmt.money(dc.paFeeCents)}`} />
        )}
        <Row label="= Profit pool" value={fmt.money(dc.poolCents)} strong />
        {financials.supplementCents > 0 && !financials.repGetsSupplement && (
          <Row label="− Supplement kept by company (rep waived)" value={`−${fmt.money(dc.poolCents - dc.repPoolBasisCents)}`} sub />
        )}
        {financials.rep ? (
          financials.rep.splitPct == null ? (
            <p className="mt-2 text-xs text-amber-600">
              Set {financials.rep.name}&rsquo;s {financials.companyProvidedLead ? "provided-lead" : "self-gen"} split % in Team → member to compute the commission.
            </p>
          ) : (
            <>
              <Row
                label={`${financials.rep.name} — pool share (${financials.rep.splitPct}% · ${financials.companyProvidedLead ? "provided lead" : "self-gen"})`}
                value={fmt.money(dc.repPoolCommissionCents)}
                sub
              />
              {financials.deductibleCents > 0 && (financials.rep.deductiblePct ?? 0) > 0 && (
                <Row
                  label={`${financials.rep.name} — deductible share (${financials.rep.deductiblePct}% of ${fmt.money(financials.deductibleCents)})`}
                  value={fmt.money(dc.repDeductibleCommissionCents)}
                  sub
                />
              )}
              <Row label={`= ${financials.rep.name} total commission`} value={fmt.money(dc.repCommissionCents)} strong />
              <Row label="= Company profit" value={fmt.money(dc.companyProfitCents)} strong />
              {financials.deductibleCents > 0 && (
                <p className="mt-1 pl-3 text-[11px] text-muted-foreground">
                  Company keeps the rest of the pool, the {financials.overheadPct}% retained overhead, and the rest of the {fmt.money(financials.deductibleCents)} deductible.
                </p>
              )}
              {financials.companyProvidedLead && financials.rep.providedLeadSplitPct == null && (
                <p className="mt-1 pl-3 text-[11px] text-amber-600">
                  No provided-lead split set for {financials.rep.name} — using their self-gen split. Set it in Team → member.
                </p>
              )}
              {/* Effective rate: the rep's take as a % of the deal. */}
              {(() => {
                const repTotal = dc.repCommissionCents;
                const ofContract = financials.contractValue > 0 ? (repTotal / financials.contractValue) * 100 : 0;
                const ofRevenue = dc.revenueCents > 0 ? (repTotal / dc.revenueCents) * 100 : 0;
                const showAdj = financials.supplementCents > 0 || financials.deductibleCents > 0;
                return (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="font-medium">
                      Effective rep rate
                      <span className="ml-1 text-xs font-normal text-muted-foreground">{fmt.money(repTotal)} take</span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {ofContract.toFixed(1)}% of contract
                      {showAdj && <span className="font-normal text-muted-foreground"> · {ofRevenue.toFixed(1)}% of revenue</span>}
                    </span>
                  </div>
                );
              })()}
            </>
          )
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No sales rep assigned to this deal.</p>
        )}
      </div>

      {/* Generate */}
      {canManage && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {!commissionEligible
              ? `Commissions unlock at the “${gateLabel}” stage.`
              : financials.commission
                ? `Current commission: ${fmt.money(financials.commission.amount)} (${financials.commission.status})`
                : "No commission generated yet."}
          </span>
          <Button
            size="sm"
            onClick={generate}
            disabled={busy || !commissionEligible || !financials.rep || financials.rep.splitPct == null}
            title={!commissionEligible ? `Available once the job reaches ${gateLabel}` : undefined}
            className="bg-gold text-gold-foreground hover:bg-gold/90"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {financials.commission ? "Update commission" : "Generate commission"}
          </Button>
        </div>
      )}
    </div>
  );
}
