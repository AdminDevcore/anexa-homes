"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlayCircle, ShieldPlus, ShieldCheck, ClipboardCheck, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  setAppointmentDispositionAction,
  setInspectionOutcomeAction,
  openClaimAction,
} from "@/server/modules/leads/actions";
import { DEFAULT_APPOINTMENT_DISPOSITIONS, groupDispositions, type Disposition } from "@/lib/dispositions";

const INSPECTION_OUTCOMES = [
  "Damage confirmed",
  "Approved — full replacement",
  "Approved — repair only",
  "Partial approval",
  "Denied",
  "No damage found",
  "Pending adjuster review",
];

export type ClaimInfo = {
  carrier: string | null;
  claimNumber: string | null;
  policyNumber: string | null;
  adjusterName: string | null;
  adjusterPhone: string | null;
  adjusterEmail: string | null;
  lossDate: string | null; // ISO
  deductible: number;
  rcv: number;
  acv: number;
  depreciation: number;
} | null;

export function DealActionsPanel({
  leadId,
  disposition,
  appointmentNote,
  dispositions,
  claim,
  inspectionOutcome,
  inspectionNote,
  canEditLead,
  canEditClaim,
}: {
  leadId: string;
  disposition: string | null;
  appointmentNote: string | null;
  // Customizable, grouped appointment outcomes (Settings → Appointment Outcomes).
  dispositions?: Disposition[];
  claim: ClaimInfo;
  inspectionOutcome: string | null;
  inspectionNote: string | null;
  canEditLead: boolean;
  canEditClaim: boolean;
}) {
  const groups = groupDispositions(dispositions?.length ? dispositions : DEFAULT_APPOINTMENT_DISPOSITIONS);
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <AppointmentRun leadId={leadId} disposition={disposition} note={appointmentNote} groups={groups} canEdit={canEditLead} />
      <div className="border-t border-border pt-3">
        <ClaimSection leadId={leadId} claim={claim} canOpen={canEditLead} canEdit={canEditClaim} />
      </div>
      <div className="border-t border-border pt-3">
        <InspectionOutcome leadId={leadId} outcome={inspectionOutcome} note={inspectionNote} canEdit={canEditLead} />
      </div>
    </div>
  );
}

/** A small autosaving note box used under an outcome. */
function NoteField({ value, onSave, canEdit, placeholder }: { value: string | null; onSave: (n: string) => void | Promise<unknown>; canEdit: boolean; placeholder: string }) {
  const [note, setNote] = React.useState(value ?? "");
  React.useEffect(() => { setNote(value ?? ""); }, [value]);
  return (
    <textarea
      value={note}
      disabled={!canEdit}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => { if (note !== (value ?? "")) onSave(note); }}
      placeholder={placeholder}
      rows={2}
      className="mt-1.5 w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    />
  );
}

function InspectionOutcome({ leadId, outcome, note, canEdit }: { leadId: string; outcome: string | null; note: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function setOutcome(value: string | null) {
    setBusy(true);
    const res = await setInspectionOutcomeAction({ leadId, outcome: value });
    setBusy(false);
    setPicking(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(value ? "Inspection outcome saved" : "Cleared");
    router.refresh();
  }
  async function saveNote(n: string) {
    const res = await setInspectionOutcomeAction({ leadId, note: n });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }
  const options = outcome && !INSPECTION_OUTCOMES.includes(outcome) ? [outcome, ...INSPECTION_OUTCOMES] : INSPECTION_OUTCOMES;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Inspection outcome</p>
      {outcome && !picking ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-600">
            <ClipboardCheck className="size-3" /> {outcome}
          </span>
          {canEdit && (
            <button onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Pencil className="size-3" /> Change
            </button>
          )}
        </div>
      ) : picking ? (
        <div className="mt-1.5 flex items-center gap-2">
          <select autoFocus defaultValue={outcome ?? ""} disabled={busy} onChange={(e) => setOutcome(e.target.value || null)} className="h-9 flex-1 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="">Select outcome…</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setPicking(true)} className="mt-1.5 w-full">
          <ClipboardCheck className="size-4" /> Set inspection outcome
        </Button>
      )}
      <NoteField value={note} onSave={saveNote} canEdit={canEdit} placeholder="Inspection notes…" />
    </div>
  );
}

function AppointmentRun({
  leadId,
  disposition,
  note,
  groups,
  canEdit,
}: {
  leadId: string;
  disposition: string | null;
  note: string | null;
  groups: { group: string | null; items: string[] }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const allLabels = groups.flatMap((g) => g.items);

  async function set(value: string | null) {
    setBusy(true);
    const res = await setAppointmentDispositionAction({ leadId, disposition: value });
    setBusy(false);
    setPicking(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(value ? "Appointment outcome saved" : "Outcome cleared");
    router.refresh();
  }
  async function saveNote(n: string) {
    const res = await setAppointmentDispositionAction({ leadId, note: n });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Appointment outcome</p>
      {disposition && !picking ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-gold/15 px-2.5 py-1 text-xs font-medium text-gold-muted">{disposition}</span>
          {canEdit && (
            <button onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Pencil className="size-3" /> Change
            </button>
          )}
        </div>
      ) : picking ? (
        <div className="mt-1.5 flex items-center gap-2">
          <select
            autoFocus
            defaultValue={disposition ?? ""}
            disabled={busy}
            onChange={(e) => set(e.target.value || null)}
            className="h-9 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">Select outcome…</option>
            {/* Keep a previously-recorded outcome selectable even if it was later removed in Settings. */}
            {disposition && !allLabels.includes(disposition) && <option value={disposition}>{disposition}</option>}
            {groups.map((g, gi) =>
              g.group ? (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((l) => <option key={l} value={l}>{l}</option>)}
                </optgroup>
              ) : (
                g.items.map((l) => <option key={`${gi}-${l}`} value={l}>{l}</option>)
              )
            )}
          </select>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <Button
          size="sm"
          disabled={!canEdit}
          onClick={() => setPicking(true)}
          className="mt-1.5 w-full bg-gold text-gold-foreground hover:bg-gold/90"
        >
          <PlayCircle className="size-4" /> Run appointment
        </Button>
      )}
      <NoteField value={note} onSave={saveNote} canEdit={canEdit} placeholder="Appointment notes…" />
    </div>
  );
}

function ClaimSection({ leadId, claim, canOpen, canEdit }: { leadId: string; claim: ClaimInfo; canOpen: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function open() {
    setBusy(true);
    const res = await openClaimAction(leadId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Claim opened");
    router.refresh();
  }

  if (!claim) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Insurance claim</p>
        <Button size="sm" variant="outline" disabled={!canOpen || busy} onClick={open} className="mt-1.5 w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldPlus className="size-4" />} Open claim
        </Button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Insurance claim</p>
      <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm">
        <ShieldCheck className="size-4 shrink-0 text-emerald-600" />
        <span className="font-medium">Claim open</span>
        <span className="ml-auto text-xs text-muted-foreground">Edit in Claim Information</span>
      </div>
    </div>
  );
}
