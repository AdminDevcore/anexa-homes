"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, Loader2, Pencil, X } from "lucide-react";
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
  installDateSlot,
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
    assignedRep: string | null;
    propertyValue: string | null;
    lastSale: string | null;
    claimStatus: string | null;
    created: string;
  };
  /** Live controls that write on click — rendered in both modes. */
  dealTypeSlot: React.ReactNode;
  installDateSlot: React.ReactNode;
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

        {/* Live toggle in both modes — it already writes on click. */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isSolar ? "Financing" : "Deal Type"}
          </span>
          {dealTypeSlot}
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

        {display.claimStatus && <Detail label="Claim Status" value={display.claimStatus} />}

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

        {editing ? (
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
          <Detail label="Deal Value" value={display.value} />
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

        {/* The install date lives HERE, with the other key dates. Already an
            inline control, so it is identical in both modes. */}
        <div>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <CalendarClock className="size-3.5" />
            Install Date
          </div>
          <div className="mt-1">{installDateSlot}</div>
        </div>

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
