"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Loader2,
  Pencil,
  Lock,
  Plus,
  Check,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Presentation,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  setAppointmentDispositionAction,
  setInspectionOutcomeAction,
  addOutcomeNoteAction,
} from "@/server/modules/leads/actions";
import { DEFAULT_APPOINTMENT_DISPOSITIONS, groupDispositions, type Disposition } from "@/lib/dispositions";

export type OutcomeNote = { id: string; body: string; author: string; createdAt: string };

/**
 * The visit, as one numbered flow: appointment → inspection → claim → proposal.
 *
 * The claim used to sit BETWEEN the two outcomes, which split the two things a
 * rep records in the same breath. It is downstream of the inspection, so it is
 * step 3. Building the proposal is the terminal action and the only emphasized
 * button here — it used to be buried in a document card below the fold.
 */
export function DealActionsPanel({
  leadId,
  disposition,
  appointmentNote,
  appointmentNotes,
  dispositions,
  isSolar = false,
  inspectionOutcome,
  inspectionNote,
  inspectionNotes,
  inspectionOutcomes,
  canEditLead,
  canCreateProposal = false,
}: {
  leadId: string;
  disposition: string | null;
  appointmentNote: string | null;
  // Append-only, tamper-proof outcome notes (newest last). Legacy single-field
  // note (appointmentNote) is shown as a locked "initial note" if present.
  appointmentNotes: OutcomeNote[];
  // Customizable, grouped appointment outcomes (Settings → Appointment Outcomes).
  dispositions?: Disposition[];
  inspectionOutcome: string | null;
  inspectionNote: string | null;
  inspectionNotes: OutcomeNote[];
  // Customizable inspection outcomes (Settings → Inspection Outcomes).
  inspectionOutcomes: string[];
  canEditLead: boolean;
  /** Solar has no claim, no adjuster and no roof inspection. */
  isSolar?: boolean;
  canCreateProposal?: boolean;
}) {
  const groups = groupDispositions(dispositions?.length ? dispositions : DEFAULT_APPOINTMENT_DISPOSITIONS);
  // Both verticals close the same way — one emphasized button, at the end of
  // the visit. They just build different documents: roofing walks a photo-led
  // presentation, solar a system design and its financing.
  const proposalHref = isSolar
    ? `/portal/leads/${leadId}/solar-proposal`
    : `/portal/leads/${leadId}/presentation`;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The visit</p>

      <ol className="mt-3">
        <Step n={1} done={!!disposition} title={isSolar ? "Qualification" : "Appointment"}>
          <AppointmentRun
            leadId={leadId}
            disposition={disposition}
            legacyNote={appointmentNote}
            notes={appointmentNotes}
            groups={groups}
            canEdit={canEditLead}
            isSolar={isSolar}
          />
        </Step>

        {/* The claim is NOT a step here. It used to be step 3, with an "Open
            claim" button — but the Summary above already carries a Claim Status
            picker, and two controls for one claim meant the button had to guess
            a status ("Filed") the deal might be well past. Setting the status
            opens the claim now, so the visit ends at the inspection. */}
        <Step n={2} done={!!inspectionOutcome} title={isSolar ? "Site survey" : "Inspection"} last>
          <InspectionOutcome
            leadId={leadId}
            outcome={inspectionOutcome}
            legacyNote={inspectionNote}
            notes={inspectionNotes}
            outcomes={inspectionOutcomes}
            canEdit={canEditLead}
            label={isSolar ? "Site survey outcome" : "Inspection outcome"}
          />
        </Step>
      </ol>

      {canCreateProposal && (
        <div className="mt-1 border-t border-border pt-3">
          <Button
            asChild
            size="sm"
            className={cn(
              "w-full",
              isSolar
                ? "bg-solar text-solar-foreground hover:bg-solar/90"
                : "bg-gold text-gold-foreground hover:bg-gold/90"
            )}
          >
            <Link href={proposalHref}>
              <Presentation className="size-4" /> Build Proposal
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

/** One numbered row of the visit flow, with the rail connecting it to the next. */
function Step({
  n,
  done,
  title,
  children,
  last = false,
}: {
  n: number;
  done: boolean;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className={cn("relative flex gap-3", last ? "pb-0" : "pb-4")}>
      {!last && <span className="absolute bottom-1 left-[11px] top-7 w-px bg-border" aria-hidden />}
      <span
        className={cn(
          "relative z-10 flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          done ? "bg-emerald-500 text-white" : "border border-border bg-background text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Append-only outcome notes, collapsed behind their own count.
 *
 * Two always-open textareas made this panel twice as tall as it needed to be —
 * on most deals there is nothing to say. Existing entries stay read-only
 * (locked) so the record can't be tampered with; users can only add new
 * timestamped notes.
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
  const [open, setOpen] = React.useState(false);
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

  const count = (legacyNote ? 1 : 0) + notes.length;

  // Nothing recorded and nothing you're allowed to record — show no affordance.
  if (count === 0 && !canEdit) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquare className="size-3" />
        {count > 0 ? `${count} note${count === 1 ? "" : "s"}` : "Add note"}
        <ChevronRight className="size-3" />
      </button>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquare className="size-3" />
        {count > 0 ? `${count} note${count === 1 ? "" : "s"}` : "Add note"}
        <ChevronDown className="size-3" />
      </button>
      {count > 0 && (
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
      {outcome && !picking ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border bg-blue-500/15 px-2.5 py-1 text-xs font-medium">
            <ClipboardCheck className="size-3" /> {outcome}
          </span>
          {canEdit && (
            <button onClick={() => setPicking(true)} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Pencil className="size-3" /> Change
            </button>
          )}
        </div>
      ) : picking ? (
        <div className="mt-1 flex items-center gap-2">
          <select autoFocus defaultValue={outcome ?? ""} disabled={busy} onChange={(e) => setOutcome(e.target.value || null)} className="h-9 flex-1 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="">Select outcome…</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setPicking(true)} className="mt-1 w-full">
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
      {disposition && !picking ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-gold/15 px-2.5 py-1 text-xs font-medium text-gold-muted">{disposition}</span>
          {canEdit && (
            <button onClick={() => setPicking(true)} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Pencil className="size-3" /> Change
            </button>
          )}
        </div>
      ) : picking ? (
        <div className="mt-1 flex items-center gap-2">
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
        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setPicking(true)} className="mt-1 w-full">
          {isSolar ? "Record qualification" : "Run appointment"}
        </Button>
      )}
      <OutcomeNotes leadId={leadId} context="appointment_outcome" legacyNote={legacyNote} notes={notes} canEdit={canEdit} placeholder="Add an appointment note…" />
    </div>
  );
}

