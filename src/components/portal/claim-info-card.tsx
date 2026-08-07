"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, Loader2, Check, Pencil, X, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClaimPriceEditor } from "@/components/portal/claim-price-editor";
import { useFormat } from "@/components/portal/branding-provider";
import { updateClaimInfoAction } from "@/server/modules/leads/actions";
import { claimIsIncomplete } from "@/lib/claim-status";

// Roof info, line items, and supplement opportunities moved to Scope of Work.
export type ClaimFull = {
  carrier: string | null; claimNumber: string | null; lossDate: string | null; policyNumber: string | null;
  adjusterName: string | null; adjusterPhone: string | null; adjusterEmail: string | null; adjusterMeetingAt: string | null;
  deductible: number; rcv: number; acv: number; depreciation: number;
};

export function ClaimInfoCard({
  leadId,
  claim,
  canEdit,
  claimPrice,
  canEditClaimPrice,
  bare = false,
}: {
  leadId: string;
  claim: ClaimFull;
  canEdit: boolean;
  // The deal's claim/contract price (set at Scope Received) — lives with the claim info.
  claimPrice: number | null;
  canEditClaimPrice: boolean;
  /**
   * Drop this component's own card chrome. Set when it renders INSIDE another
   * card — the deal page's slide switcher — where a bordered header nested in a
   * bordered header reads as a mistake. The Save button moves inline instead of
   * disappearing: it is the only way to commit the form.
   */
  bare?: boolean;
}) {
  const router = useRouter();
  const fmt = useFormat();
  const [saving, setSaving] = React.useState(false);
  // The card used to render its inputs permanently, which made a reference
  // worksheet look like a form waiting to be filled in — and put twelve tab
  // stops between you and the next thing on the page. It reads by default now,
  // and edits on request, like every other card on the deal.
  const [editing, setEditing] = React.useState(false);

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
    deductible: moneyToStr(claim.deductible),
    rcv: moneyToStr(claim.rcv),
    acv: moneyToStr(claim.acv),
    depreciation: moneyToStr(claim.depreciation),
  });
  const upd = (k: keyof typeof f) => (val: string) => setF((s) => ({ ...s, [k]: val }));

  // Build the FULL payload from current state — every field, every save.
  function buildPayload() {
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

  // Autosave on blur, but only while the editor is open — otherwise tabbing
  // through a read-only card would fire writes.
  const onBlur = () => { if (canEdit && editing) commit(); };

  function openEditor() {
    setF({
      carrier: claim.carrier ?? "",
      claimNumber: claim.claimNumber ?? "",
      policyNumber: claim.policyNumber ?? "",
      adjusterName: claim.adjusterName ?? "",
      adjusterPhone: claim.adjusterPhone ?? "",
      adjusterEmail: claim.adjusterEmail ?? "",
      lossDate: claim.lossDate ? claim.lossDate.slice(0, 10) : "",
      adjusterMeetingAt: claim.adjusterMeetingAt ? claim.adjusterMeetingAt.slice(0, 10) : "",
      deductible: moneyToStr(claim.deductible),
      rcv: moneyToStr(claim.rcv),
      acv: moneyToStr(claim.acv),
      depreciation: moneyToStr(claim.depreciation),
    });
    setEditing(true);
  }

  // Blur-autosave means edits are already persisted by the time Cancel is
  // clicked, so this closes the editor and re-reads the server's copy rather
  // than pretending to roll anything back.
  function closeEditor() {
    setEditing(false);
    router.refresh();
  }

  const dateText = (iso: string | null) => (iso ? fmt.date(iso) : "—");

  // An amount nobody has entered is zero in the column, but "$0" on screen reads
  // as a claim someone priced at nothing. A real claim has no $0 deductible or
  // RCV, so zero is unambiguously "not entered yet" and shows as an em-dash —
  // matching the text fields above it.
  const moneyText = (cents: number) => (cents ? fmt.money(cents) : "—");

  const incomplete = claimIsIncomplete(claim);
  const missingLabel =
    !claim.carrier?.trim() && !claim.claimNumber?.trim()
      ? "carrier and claim number"
      : !claim.carrier?.trim()
        ? "carrier"
        : "claim number";

  // The content itself, defined once and rendered by both the bare and the
  // chromed branch below.
  const body = (
    <>
        {/* A claim with no carrier and no claim number can't be worked by anyone
            who didn't open it. The picker asks for both as it opens the claim;
            this catches the ones where that was skipped, so an empty worksheet
            never passes for a filed claim just because the status says so. */}
        {incomplete && !editing && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
            <TriangleAlert className="size-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">This claim is missing its {missingLabel}</p>
              <p className="text-[11px] text-muted-foreground">
                Nobody can call the adjuster or chase a supplement without them.
              </p>
            </div>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={openEditor} className="border-amber-500/50">
                Add claim info
              </Button>
            )}
          </div>
        )}

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
          {editing ? (
            <>
              <ClaimField label="Carrier" value={f.carrier} onChange={upd("carrier")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Claim Number" value={f.claimNumber} onChange={upd("claimNumber")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Date of Loss" type="date" value={f.lossDate} onChange={upd("lossDate")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Policy Number" value={f.policyNumber} onChange={upd("policyNumber")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Adjuster Name" value={f.adjusterName} onChange={upd("adjusterName")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Adjuster Phone" value={f.adjusterPhone} onChange={upd("adjusterPhone")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Adjuster Email" value={f.adjusterEmail} onChange={upd("adjusterEmail")} onBlur={onBlur} disabled={!canEdit} />
              <ClaimField label="Adjuster Meeting Date" type="date" value={f.adjusterMeetingAt} onChange={upd("adjusterMeetingAt")} onBlur={onBlur} disabled={!canEdit} />
            </>
          ) : (
            <>
              <ReadField label="Carrier" value={claim.carrier} />
              <ReadField label="Claim Number" value={claim.claimNumber} />
              <ReadField label="Date of Loss" value={dateText(claim.lossDate)} />
              <ReadField label="Policy Number" value={claim.policyNumber} />
              <ReadField label="Adjuster Name" value={claim.adjusterName} />
              <ReadField label="Adjuster Phone" value={claim.adjusterPhone} href={claim.adjusterPhone ? `tel:${claim.adjusterPhone.replace(/[^\d+]/g, "")}` : undefined} />
              <ReadField label="Adjuster Email" value={claim.adjusterEmail} href={claim.adjusterEmail ? `mailto:${claim.adjusterEmail}` : undefined} />
              <ReadField label="Adjuster Meeting Date" value={dateText(claim.adjusterMeetingAt)} />
            </>
          )}
        </div>

        {/* Amounts — roof info, line items & supplements now live in Scope of Work. */}
        <Section title="Amounts">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {editing ? (
              <>
                <ClaimField label="Deductible ($)" type="number" value={f.deductible} onChange={upd("deductible")} onBlur={onBlur} disabled={!canEdit} />
                <ClaimField label="RCV ($)" type="number" value={f.rcv} onChange={upd("rcv")} onBlur={onBlur} disabled={!canEdit} />
                <ClaimField label="ACV ($)" type="number" value={f.acv} onChange={upd("acv")} onBlur={onBlur} disabled={!canEdit} />
                <ClaimField label="Depreciation ($)" type="number" value={f.depreciation} onChange={upd("depreciation")} onBlur={onBlur} disabled={!canEdit} />
              </>
            ) : (
              <>
                <ReadField label="Deductible" value={moneyText(claim.deductible)} />
                <ReadField label="RCV" value={moneyText(claim.rcv)} />
                <ReadField label="ACV" value={moneyText(claim.acv)} />
                <ReadField label="Depreciation" value={moneyText(claim.depreciation)} />
              </>
            )}
          </div>
        </Section>

    </>
  );

  const actions = (
    <div className="flex items-center gap-3">
      {saving && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> saving</span>}
      {canEdit &&
        (editing ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={closeEditor} disabled={saving}>
              <X className="size-3.5" /> Done
            </Button>
            <Button size="sm" onClick={() => commit({ toastOk: true })} className="bg-gold text-gold-foreground hover:bg-gold/90">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save claim
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={openEditor}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ))}
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-6">
        {/* No header bar, but the Save button still has to be reachable. */}
        <div className="flex justify-end">{actions}</div>
        {body}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold" />
          <h2 className="font-display text-lg font-semibold">Claim Information</h2>
        </div>
        {actions}
      </div>

      <div className="space-y-6 p-5">
        {body}
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

/**
 * One claim fact in read mode. An empty slot says "—" rather than collapsing,
 * so the grid keeps its shape and a missing policy number stays visible as a
 * gap in the file instead of silently not existing.
 */
function ReadField({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <p className="min-h-8 break-words text-sm font-medium">
        {value ? (
          href ? (
            <a href={href} className="underline-offset-2 hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="font-normal text-muted-foreground/70">—</span>
        )}
      </p>
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

