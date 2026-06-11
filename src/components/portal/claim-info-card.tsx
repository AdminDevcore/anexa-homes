"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, Plus, Trash2, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/format";
import { ClaimPriceEditor } from "@/components/portal/claim-price-editor";
import {
  updateClaimInfoAction,
  addClaimLineItemAction,
  updateClaimLineItemAction,
  deleteClaimLineItemAction,
} from "@/server/modules/leads/actions";

export type LineItem = { id: string; code: string | null; description: string; quantity: number; unit: string | null; unitPrice: number };
export type ClaimFull = {
  carrier: string | null; claimNumber: string | null; lossDate: string | null; policyNumber: string | null;
  adjusterName: string | null; adjusterPhone: string | null; adjusterEmail: string | null; adjusterMeetingAt: string | null;
  roofSquares: number | null; wasteFactorPct: number | null; pitch: string | null; storyCount: number | null;
  deductible: number; rcv: number; acv: number; depreciation: number;
  supplementOpportunities: string[];
  lineItems: LineItem[];
};

const SUPPLEMENT_OPPS: [string, string][] = [
  ["starter", "Starter"], ["drip_edge", "Drip Edge"], ["ridge_cap", "Ridge Cap"], ["ice_water", "Ice & Water"],
  ["high_profile_ridge", "High Profile Ridge"], ["steep_charges", "Steep Charges"], ["high_charges", "High Charges"],
  ["detach_reset", "Detach & Reset Items"], ["flashings", "Flashings"], ["chimney", "Chimney"], ["gutters", "Gutters"],
  ["window_screens", "Window Screens"], ["paint", "Paint"], ["code_upgrades", "Code Upgrades"],
];

export function ClaimInfoCard({
  leadId,
  claim,
  canEdit,
  claimPrice,
  canEditClaimPrice,
}: {
  leadId: string;
  claim: ClaimFull;
  canEdit: boolean;
  // The deal's claim/contract price (set at Scope Received) — lives with the claim info.
  claimPrice: number | null;
  canEditClaimPrice: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  // Controlled form state for ALL claim fields. Using one state object with
  // controlled inputs (not uncontrolled defaultValue) means re-renders from
  // saving / router.refresh() never wipe in-progress edits.
  const moneyToStr = (c: number) => (c ? (c / 100).toString() : "");
  const [f, setF] = React.useState({
    carrier: claim.carrier ?? "",
    claimNumber: claim.claimNumber ?? "",
    policyNumber: claim.policyNumber ?? "",
    adjusterName: claim.adjusterName ?? "",
    adjusterPhone: claim.adjusterPhone ?? "",
    adjusterEmail: claim.adjusterEmail ?? "",
    lossDate: claim.lossDate ? claim.lossDate.slice(0, 10) : "",
    adjusterMeetingAt: claim.adjusterMeetingAt ? claim.adjusterMeetingAt.slice(0, 10) : "",
    roofSquares: claim.roofSquares?.toString() ?? "",
    wasteFactorPct: claim.wasteFactorPct?.toString() ?? "",
    pitch: claim.pitch ?? "",
    storyCount: claim.storyCount?.toString() ?? "",
    deductible: moneyToStr(claim.deductible),
    rcv: moneyToStr(claim.rcv),
    acv: moneyToStr(claim.acv),
    depreciation: moneyToStr(claim.depreciation),
  });
  const upd = (k: keyof typeof f) => (val: string) => setF((s) => ({ ...s, [k]: val }));

  // Build the FULL payload from current state — every field, every save.
  function buildPayload() {
    const num = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
    const int = (s: string) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : null; };
    const cents = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? Math.round(v * 100) : 0; };
    return {
      leadId,
      carrier: f.carrier || null,
      claimNumber: f.claimNumber || null,
      policyNumber: f.policyNumber || null,
      adjusterName: f.adjusterName || null,
      adjusterPhone: f.adjusterPhone || null,
      adjusterEmail: f.adjusterEmail || null,
      lossDate: f.lossDate || null,
      adjusterMeetingAt: f.adjusterMeetingAt || null,
      deductibleCents: cents(f.deductible),
      rcvCents: cents(f.rcv),
      acvCents: cents(f.acv),
      depreciationCents: cents(f.depreciation),
      roofSquares: num(f.roofSquares),
      wasteFactorPct: num(f.wasteFactorPct),
      pitch: f.pitch || null,
      storyCount: int(f.storyCount),
    };
  }

  // Persist the whole form. Used by per-field blur (autosave) and the Save button.
  async function commit(opts?: { toastOk?: boolean }) {
    setSaving(true);
    const res = await updateClaimInfoAction(buildPayload());
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    if (opts?.toastOk) toast.success("Claim saved");
    router.refresh();
  }

  async function toggleOpp(key: string) {
    const next = claim.supplementOpportunities.includes(key)
      ? claim.supplementOpportunities.filter((k) => k !== key)
      : [...claim.supplementOpportunities, key];
    setSaving(true);
    const res = await updateClaimInfoAction({ leadId, supplementOpportunities: next });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  const onBlur = () => { if (canEdit) commit(); };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold" />
          <h2 className="font-display text-lg font-semibold">Claim Information</h2>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> saving</span>}
          {canEdit && (
            <Button size="sm" onClick={() => commit({ toastOk: true })} className="bg-gold text-gold-foreground hover:bg-gold/90">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save claim
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-6 p-5">
        {/* Claim Price — the contract price from the insurance scope (Scope Received). */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Claim Price
            </span>
            <span className="text-[11px] text-muted-foreground/70">Contract · set at Scope Received</span>
          </div>
          <ClaimPriceEditor leadId={leadId} claimPrice={claimPrice} canEdit={canEditClaimPrice} />
        </div>

        {/* Claim Information */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ClaimField label="Carrier" value={f.carrier} onChange={upd("carrier")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Claim Number" value={f.claimNumber} onChange={upd("claimNumber")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Date of Loss" type="date" value={f.lossDate} onChange={upd("lossDate")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Policy Number" value={f.policyNumber} onChange={upd("policyNumber")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Adjuster Name" value={f.adjusterName} onChange={upd("adjusterName")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Adjuster Phone" value={f.adjusterPhone} onChange={upd("adjusterPhone")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Adjuster Email" value={f.adjusterEmail} onChange={upd("adjusterEmail")} onBlur={onBlur} disabled={!canEdit} />
          <ClaimField label="Adjuster Meeting Date" type="date" value={f.adjusterMeetingAt} onChange={upd("adjusterMeetingAt")} onBlur={onBlur} disabled={!canEdit} />
        </div>

        {/* Roof Information */}
        <Section title="Roof Information">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ClaimField label="Total Squares" type="number" value={f.roofSquares} onChange={upd("roofSquares")} onBlur={onBlur} disabled={!canEdit} />
            <ClaimField label="Waste Factor (%)" type="number" value={f.wasteFactorPct} onChange={upd("wasteFactorPct")} onBlur={onBlur} disabled={!canEdit} />
            <ClaimField label="Pitch" value={f.pitch} onChange={upd("pitch")} onBlur={onBlur} disabled={!canEdit} />
            <ClaimField label="Story Count" type="number" value={f.storyCount} onChange={upd("storyCount")} onBlur={onBlur} disabled={!canEdit} />
          </div>
        </Section>

        {/* Amounts */}
        <Section title="Amounts">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ClaimField label="Deductible ($)" type="number" value={f.deductible} onChange={upd("deductible")} onBlur={onBlur} disabled={!canEdit} />
            <ClaimField label="RCV ($)" type="number" value={f.rcv} onChange={upd("rcv")} onBlur={onBlur} disabled={!canEdit} />
            <ClaimField label="ACV ($)" type="number" value={f.acv} onChange={upd("acv")} onBlur={onBlur} disabled={!canEdit} />
            <ClaimField label="Depreciation ($)" type="number" value={f.depreciation} onChange={upd("depreciation")} onBlur={onBlur} disabled={!canEdit} />
          </div>
        </Section>

        {/* Line Items */}
        <Section title="Line Item Information" action={canEdit ? <AddLineItem leadId={leadId} /> : undefined}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Xactimate Code</th>
                  <th className="px-2 py-2 text-left font-semibold">Description</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 text-left font-semibold">Unit</th>
                  <th className="px-2 py-2 text-right font-semibold">Unit Price</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  {canEdit && <th className="px-1 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claim.lineItems.length === 0 && (
                  <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">No line items yet.</td></tr>
                )}
                {claim.lineItems.map((li) => <LineRow key={li.id} leadId={leadId} item={li} canEdit={canEdit} />)}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Supplement Opportunities */}
        <Section title="Supplement Opportunities">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {SUPPLEMENT_OPPS.map(([key, label]) => {
              const on = claim.supplementOpportunities.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => toggleOpp(key)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors disabled:opacity-60",
                    on ? "border-gold/50 bg-gold/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-gold bg-gold text-gold-foreground" : "border-border")}>
                    {on && <Check className="size-3" />}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

// Stable, module-level field component. Defining it OUTSIDE the card is critical:
// an inline component is a new type every render, which remounts the inputs and
// (with uncontrolled inputs) wipes in-progress edits.
function ClaimField({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="h-8 text-sm"
      />
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function AddLineItem({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      const res = await addClaimLineItemAction(leadId);
      setBusy(false);
      if (!res.ok) return toast.error(res.error);
      router.refresh();
    }}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add line item
    </Button>
  );
}

function LineRow({ leadId, item, canEdit }: { leadId: string; item: LineItem; canEdit: boolean }) {
  const router = useRouter();
  const total = Math.round(item.quantity * item.unitPrice);
  async function save(patch: Record<string, unknown>) {
    const res = await updateClaimLineItemAction({ id: item.id, leadId, ...patch });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }
  const cell = "h-8 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-border focus:border-border focus:bg-background outline-none";
  return (
    <tr>
      <td className="px-1 py-1"><input defaultValue={item.code ?? ""} disabled={!canEdit} onBlur={(e) => save({ code: e.target.value || null })} className={cn(cell, "w-24")} placeholder="RFG…" /></td>
      <td className="px-1 py-1"><input defaultValue={item.description} disabled={!canEdit} onBlur={(e) => save({ description: e.target.value })} className={cn(cell, "w-full min-w-[160px]")} /></td>
      <td className="px-1 py-1 text-right"><input type="number" defaultValue={item.quantity} disabled={!canEdit} onBlur={(e) => save({ quantity: parseFloat(e.target.value) || 0 })} className={cn(cell, "w-16 text-right")} /></td>
      <td className="px-1 py-1"><input defaultValue={item.unit ?? ""} disabled={!canEdit} onBlur={(e) => save({ unit: e.target.value || null })} className={cn(cell, "w-16")} placeholder="SQ/LF" /></td>
      <td className="px-1 py-1 text-right"><input type="number" defaultValue={item.unitPrice ? item.unitPrice / 100 : ""} disabled={!canEdit} onBlur={(e) => { const v = parseFloat(e.target.value); save({ unitPriceCents: Number.isFinite(v) ? Math.round(v * 100) : 0 }); }} className={cn(cell, "w-20 text-right")} placeholder="0.00" /></td>
      <td className="px-2 py-1 text-right font-medium tabular-nums">{formatCents(total)}</td>
      {canEdit && (
        <td className="px-1 py-1">
          <button onClick={() => deleteClaimLineItemAction({ id: item.id, leadId }).then((r) => r.ok ? router.refresh() : toast.error(r.error))} className="text-muted-foreground hover:text-destructive" aria-label="Delete">
            <Trash2 className="size-3.5" />
          </button>
        </td>
      )}
    </tr>
  );
}
