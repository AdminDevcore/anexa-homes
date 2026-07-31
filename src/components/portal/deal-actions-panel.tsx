"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlayCircle, ShieldPlus, ShieldCheck, ClipboardCheck, Loader2, Pencil, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  setAppointmentDispositionAction,
  setInspectionOutcomeAction,
  addOutcomeNoteAction,
  openClaimAction,
} from "@/server/modules/leads/actions";
import { DEFAULT_APPOINTMENT_DISPOSITIONS, groupDispositions, type Disposition } from "@/lib/dispositions";

export type OutcomeNote = { id: string; body: string; author: string; createdAt: string };

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
  appointmentNotes,
  dispositions,
  claim,
  isSolar = false,
  inspectionOutcome,
  inspectionNote,
  inspectionNotes,
  inspectionOutcomes,
  canEditLead,
  canEditClaim,
}: {
  leadId: string;
  disposition: string | null;
  appointmentNote: string | null;
  // Append-only, tamper-proof outcome notes (newest last). Legacy single-field
  // note (appointmentNote) is shown as a locked "initial note" if present.
  appointmentNotes: OutcomeNote[];
  // Customizable, grouped appointment outcomes (Settings → Appointment Outcomes).
  dispositions?: Disposition[];
  claim: ClaimInfo;
  inspectionOutcome: string | null;
  inspectionNote: string | null;
  inspectionNotes: OutcomeNote[];
  // Customizable inspection outcomes (Settings → Inspection Outcomes).
  inspectionOutcomes: string[];
  canEditLead: boolean;
  canEditClaim: boolean;
  /** Solar has no claim, no adjuster and no roof inspection. */
  isSolar?: boolean;
}) {
  const groups = groupDispositions(dispositions?.length ? dispositions : DEFAULT_APPOINTMENT_DISPOSITIONS);
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <AppointmentRun leadId={leadId} disposition={disposition} legacyNote={appointmentNote} notes={appointmentNotes} groups={groups} canEdit={canEditLead} isSolar={isSolar} />
      {/* An insurance claim is a roofing concept. Solar has no carrier, no
          adjuster and no deductible, so the section is not rendered at all. */}
      {!isSolar && (
        <div className="border-t border-border pt-3">
          <ClaimSection leadId={leadId} claim={claim} canOpen={canEditLead} canEdit={canEditClaim} />
        </div>
      )}
      <div className="border-t border-border pt-3">
        <InspectionOutcome
          leadId={leadId}
          outcome={inspectionOutcome}
          legacyNote={inspectionNote}
          notes={inspectionNotes}
          outcomes={inspectionOutcomes}
          canEdit={canEditLead}
          label={isSolar ? "Site survey outcome" : "Inspection outcome"}
        />
      </div>
    </div>
  );
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Append-only outcome notes. Existing entries are read-only (locked) so the
 * record can't be tampered with; users can only add new timestamped notes.
 */
function OutcomeNotes({
  leadId,
  context,
  legacyNote,
  notes,
  canEdit,
  placeholder,
}: {
  leadId: string;
  context: "appointment_outcome" | "inspection_outcome";
  legacyNote: string | null;
  notes: OutcomeNote[];
  canEdit: boolean;
  placeholder: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const res = await addOutcomeNoteAction({ leadId, context, body });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setDraft("");
    toast.success("Note added");
    router.refresh();
  }

  const hasAny = !!legacyNote || notes.length > 0;

  return (
    <div className="mt-2 space-y-1.5">
      {hasAny && (
        <ul className="space-y-1.5">
          {legacyNote && (
            <li className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
              <p className="whitespace-pre-wrap text-foreground">{legacyNote}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="size-2.5" /> Initial note · locked
              </p>
            </li>
          )}
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
              <p className="whitespace-pre-wrap text-foreground">{n.body}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="size-2.5" /> {n.author} · {fmtTimestamp(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="rounded-lg border border-border bg-background">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="w-full resize-none rounded-t-lg bg-transparent px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-between border-t border-border px-2 py-1">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lock className="size-2.5" /> Notes can&rsquo;t be edited once added
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy || !draft.trim()} onClick={add}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add note
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InspectionOutcome({ leadId, outcome, legacyNote, notes, outcomes, canEdit, label = "Inspection outcome" }: { leadId: string; outcome: string | null; legacyNote: string | null; notes: OutcomeNote[]; outcomes: string[]; canEdit: boolean; label?: string }) {
  const router = useRouter();
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function setOutcome(value: string | null) {
    setBusy(true);
    const res = await setInspectionOutcomeAction({ leadId, outcome: value });
    setBusy(false);
    setPicking(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(value ? `${label} saved` : "Cleared");
    router.refresh();
  }
  const options = outcome && !outcomes.includes(outcome) ? [outcome, ...outcomes] : outcomes;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
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
          <ClipboardCheck className="size-4" /> Set {label.toLowerCase()}
        </Button>
      )}
      <OutcomeNotes leadId={leadId} context="inspection_outcome" legacyNote={legacyNote} notes={notes} canEdit={canEdit} placeholder="Add an inspection note…" />
    </div>
  );
}

function AppointmentRun({
  isSolar = false,
  leadId,
  disposition,
  legacyNote,
  notes,
  groups,
  canEdit,
}: {
  leadId: string;
  disposition: string | null;
  legacyNote: string | null;
  notes: OutcomeNote[];
  groups: { group: string | null; items: string[] }[];
  canEdit: boolean;
  /** Solar qualifies a homeowner; roofing runs a storm appointment. */
  isSolar?: boolean;
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
          <PlayCircle className="size-4" /> {isSolar ? "Record qualification" : "Run appointment"}
        </Button>
      )}
      <OutcomeNotes leadId={leadId} context="appointment_outcome" legacyNote={legacyNote} notes={notes} canEdit={canEdit} placeholder="Add an appointment note…" />
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
