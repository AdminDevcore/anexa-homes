"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Pencil, ShieldCheck, Wallet, X } from "lucide-react";
import { Card, Detail, type DealTone } from "@/components/portal/deal-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateLeadPatchAction } from "@/server/modules/leads/manage";

/**
 * The deal's Summary card, editable in place.
 *
 * Owns its card chrome for the same reason the Homeowner card does: the Edit
 * button lives in the header and the fields it toggles live in the body.
 *
 * This card is a HYBRID, and deliberately so. Deal type, install date and the
 * appointment/claim actions are already live controls that write on click —
 * putting those behind an Edit button would be a downgrade, so they render
 * identically in both modes and arrive as slots from the server page. Edit mode
 * only swaps the plain readouts (project type, appointment, value, priority,
 * rep) for inputs.
 *
 * Value, priority and assigned rep are shown here at all — read mode included —
 * because removing the page's blanket "Edit" button left them with no way in.
 * They were previously reachable only from the full lead form.
 */

type Option = { id: string; name: string };
type ServiceOption = { value: string; label: string };

export type SummaryValues = {
  serviceType: string;
  /** Naive "YYYY-MM-DDTHH:mm" in the COMPANY's zone — see utcToZonedWallClock. */
  appointmentLocal: string;
  priority: string;
  valueCents: number;
  assignedRepId: string | null;
};

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export function DealSummaryPanel({
  leadId,
  isSolar,
  tone = "brand",
  canEdit,
  canAssign,
  values,
  reps,
  serviceTypes,
  display,
  dealTypeSlot,
  claimStatusSlot,
  actionsSlot,
}: {
  leadId: string;
  isSolar: boolean;
  tone?: DealTone;
  canEdit: boolean;
  /** Reassignment is a separate permission from editing the deal. */
  canAssign: boolean;
  values: SummaryValues;
  reps: Option[];
  serviceTypes: ServiceOption[];
  /** Pre-formatted read-mode strings; null ones are omitted entirely. */
  display: {
    serviceTypeLabel: string;
    appointment: string;
    value: string;
    /**
     * Where a DERIVED value came from — "Proposal v3". Null on roofing, whose
     * value is typed into this card and needs no provenance.
     */
    valueHint: string | null;
    assignedRep: string | null;
    propertyValue: string | null;
    lastSale: string | null;
    created: string;
  };
  /** Live controls that write on click — rendered in both modes. */
  dealTypeSlot: React.ReactNode;
  /** Null on cash and solar deals, which have no carrier claim to track. */
  claimStatusSlot: React.ReactNode;
  actionsSlot: React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState(values);

  const set = <K extends keyof SummaryValues>(key: K, v: SummaryValues[K]) =>
    setDraft((d) => ({ ...d, [key]: v }));

  function open() {
    setDraft(values);
    setEditing(true);
  }

  function cancel() {
    setDraft(values);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    // Only send what actually changed. Sending the appointment on every save
    // would re-derive the deal's stage (and stamp stageChangedAt) even when the
    // rep only touched the priority.
    const patch: Parameters<typeof updateLeadPatchAction>[1] = {};
    if (draft.serviceType !== values.serviceType) patch.serviceType = draft.serviceType as never;
    if (draft.appointmentLocal !== values.appointmentLocal) patch.appointmentAt = draft.appointmentLocal;
    if (draft.priority !== values.priority) patch.priority = draft.priority as never;
    if (draft.valueCents !== values.valueCents) patch.valueCents = draft.valueCents;
    if (canAssign && draft.assignedRepId !== values.assignedRepId) {
      patch.assignedRepId = draft.assignedRepId ?? "";
    }

    if (Object.keys(patch).length === 0) {
      setSaving(false);
      setEditing(false);
      return;
    }

    const res = await updateLeadPatchAction(leadId, patch);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setEditing(false);
    toast.success("Summary saved");
    router.refresh();
  }

  return (
    <Card
      title="Summary"
      tone={tone}
      action={
        canEdit ? (
          editing ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
                <X className="size-3.5" /> Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving}
                className="bg-gold text-gold-foreground hover:bg-gold/90"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={open}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          )
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Solar's product IS its vertical, so there is nothing to choose. */}
        {!isSolar &&
          (editing ? (
            <FieldRow label="Project Type">
              <Select value={draft.serviceType} onValueChange={(v) => set("serviceType", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {serviceTypes.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          ) : (
            <Detail label="Project Type" value={display.serviceTypeLabel} />
          ))}

        {/* Live toggle in both modes — it already writes on click. Stacked like
            the Install Date block rather than squeezed to the right of its
            label: the picker is a full-width choice, not a one-line readout. */}
        <div>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <Wallet className="size-3.5" />
            {isSolar ? "Financing" : "Deal Type"}
          </div>
          <div className="mt-1.5">{dealTypeSlot}</div>
        </div>

        {display.propertyValue && <Detail label="Property Value" value={display.propertyValue} />}
        {display.lastSale && <Detail label="Last Sale" value={display.lastSale} />}

        {editing && canAssign ? (
          <FieldRow label="Assigned Rep">
            {/* Radix Select has no empty-string value; "none" stands in for
                unassigned and is mapped back on the way out. */}
            <Select
              value={draft.assignedRepId ?? "none"}
              onValueChange={(v) => set("assignedRepId", v === "none" ? null : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        ) : (
          // An assigned rep already has a summary card of its own, so read mode
          // only states the gap. UNASSIGNED is worth saying out loud.
          !display.assignedRep && <Detail label="Assigned Rep" value="Unassigned" />
        )}

        {/* Another live control: where the carrier claim stands right now. The
            options come from Settings → Claim Statuses, so this list is the
            office's own vocabulary. */}
        {claimStatusSlot && (
          <div>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Claim Status
            </div>
            <div className="mt-1.5">{claimStatusSlot}</div>
          </div>
        )}

        {editing ? (
          <FieldRow label={isSolar ? "Consult Date" : "Appointment Date"}>
            <Input
              type="datetime-local"
              value={draft.appointmentLocal}
              onChange={(e) => set("appointmentLocal", e.target.value)}
            />
          </FieldRow>
        ) : (
          <Detail label={isSolar ? "Consult Date" : "Appointment Date"} value={display.appointment} />
        )}

        {/* SOLAR'S VALUE IS NOT TYPED, IT IS QUOTED. It comes off the last
            proposal — the design, the lender's fee and the adders decide it —
            so there is no box here on a solar deal. There used to be, and what
            it wrote was never read back: the card kept showing the derived
            figure, so a rep who corrected the number watched it snap back. */}
        {editing && !isSolar ? (
          <FieldRow label="Deal Value">
            <Input
              type="number"
              min={0}
              step="1"
              value={draft.valueCents ? String(Math.round(draft.valueCents / 100)) : ""}
              onChange={(e) =>
                set("valueCents", e.target.value ? Math.round(Number(e.target.value) * 100) : 0)
              }
              placeholder="0"
            />
          </FieldRow>
        ) : (
          <Detail
            label="Deal Value"
            capitalize={false}
            value={
              <>
                {display.value}
                {display.valueHint && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {display.valueHint}
                  </span>
                )}
              </>
            }
          />
        )}

        {editing ? (
          <FieldRow label="Priority">
            <Select value={draft.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        ) : (
          <Detail label="Priority" value={values.priority} />
        )}

        {/* No install date here any more — it moved onto the Installation
            slide, with the crew and the photos it schedules. It was the only
            control in this panel that changed the JOB rather than describing
            the deal. */}
        <Detail label="Created" value={display.created} />
      </div>

      {actionsSlot}
    </Card>
  );
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
