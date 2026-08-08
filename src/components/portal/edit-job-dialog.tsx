"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { updateProjectAction } from "@/server/modules/projects/actions";
import { AddressAutocomplete } from "@/components/portal/address-autocomplete";
import { serviceTypeOptions } from "@/lib/service-types";
import type { ServiceType } from "@prisma/client";

type ProjStatus = "not_started" | "in_production" | "on_hold" | "qc" | "completed" | "closed" | "cancelled";
type ProjPriority = "low" | "medium" | "high" | "urgent";
type ProjService = ServiceType;

const STATUSES: ProjStatus[] = ["not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled"];
const PRIORITIES: ProjPriority[] = ["low", "medium", "high", "urgent"];
const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export type EditableJob = {
  id: string;
  projectNumber: string;
  status: string;
  priority: string;
  serviceType: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  roofingType: string | null;
  materialSelection: string | null;
  pitch: string | null;
  tearOffLayers: number | null;
  contractValue: number;
  supplementCents: number;
  deductibleCents: number;
  depreciationCents: number;
  repGetsSupplement: boolean;
  repGetsDepreciation: boolean;
  companyProvidedLead: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  installDate: string | null;
  adjusterMeetingAt: string | null;
  completedAt: string | null;
  notes: string | null;
};

const dollars = (cents: number) => (Math.round(cents) / 100).toString();
const dateVal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

function Fld({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{l}</Label>
      {children}
    </div>
  );
}

const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm capitalize focus:border-ring focus:outline-none";

export function EditJobDialog({ job }: { job: EditableJob }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState(() => ({
    projectNumber: job.projectNumber,
    status: job.status as ProjStatus,
    priority: job.priority as ProjPriority,
    serviceType: job.serviceType as ProjService,
    address: job.address ?? "",
    city: job.city ?? "",
    state: job.state ?? "",
    zip: job.zip ?? "",
    roofingType: job.roofingType ?? "",
    materialSelection: job.materialSelection ?? "",
    pitch: job.pitch ?? "",
    tearOffLayers: job.tearOffLayers != null ? String(job.tearOffLayers) : "",
    contractValue: dollars(job.contractValue),
    supplement: dollars(job.supplementCents),
    deductible: dollars(job.deductibleCents),
    depreciation: dollars(job.depreciationCents),
    repGetsSupplement: job.repGetsSupplement,
    repGetsDepreciation: job.repGetsDepreciation,
    companyProvidedLead: job.companyProvidedLead,
    scheduledStart: dateVal(job.scheduledStart),
    scheduledEnd: dateVal(job.scheduledEnd),
    installDate: dateVal(job.installDate),
    adjusterMeetingAt: dateVal(job.adjusterMeetingAt),
    completedAt: dateVal(job.completedAt),
    notes: job.notes ?? "",
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await updateProjectAction({
      projectId: job.id,
      projectNumber: f.projectNumber,
      status: f.status,
      priority: f.priority,
      serviceType: f.serviceType,
      address: f.address,
      city: f.city,
      state: f.state,
      zip: f.zip,
      roofingType: f.roofingType,
      materialSelection: f.materialSelection,
      pitch: f.pitch,
      tearOffLayers: f.tearOffLayers === "" ? null : Number(f.tearOffLayers),
      contractValueCents: Math.round((Number(f.contractValue) || 0) * 100),
      supplementCents: Math.round((Number(f.supplement) || 0) * 100),
      deductibleCents: Math.round((Number(f.deductible) || 0) * 100),
      depreciationCents: Math.round((Number(f.depreciation) || 0) * 100),
      repGetsSupplement: f.repGetsSupplement,
      repGetsDepreciation: f.repGetsDepreciation,
      companyProvidedLead: f.companyProvidedLead,
      scheduledStart: f.scheduledStart,
      scheduledEnd: f.scheduledEnd,
      installDate: f.installDate,
      adjusterMeetingAt: f.adjusterMeetingAt,
      completedAt: f.completedAt,
      notes: f.notes,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Job updated");
    setOpen(false);
    router.refresh();
  }

  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="size-4" /> Edit Job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Job</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <Group title="Job">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fld label="Job number">
                <Input value={f.projectNumber} onChange={(e) => set("projectNumber", e.target.value)} />
              </Fld>
              <Fld label="Status">
                <select className={selectCls} value={f.status} onChange={(e) => set("status", e.target.value as ProjStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </Fld>
              <Fld label="Priority">
                <select className={selectCls} value={f.priority} onChange={(e) => set("priority", e.target.value as ProjPriority)}>
                  {PRIORITIES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </Fld>
              <Fld label="Service">
                <select className={selectCls} value={f.serviceType} onChange={(e) => set("serviceType", e.target.value as ProjService)}>
                  {serviceTypeOptions(job.serviceType).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Fld>
            </div>
          </Group>

          <Group title="Property">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2">
                <Fld label="Address">
                  <AddressAutocomplete
                    value={f.address}
                    onChange={(val) => set("address", val)}
                    onSelect={(parts) =>
                      setF((s) => ({
                        ...s,
                        address: parts.address,
                        // Don't wipe a value the user already typed when the
                        // suggestion happens not to carry that component.
                        city: parts.city || s.city,
                        state: parts.state || s.state,
                        zip: parts.zip || s.zip,
                      }))
                    }
                  />
                </Fld>
              </div>
              <Fld label="City">
                <Input value={f.city} onChange={(e) => set("city", e.target.value)} />
              </Fld>
              <div className="grid grid-cols-2 gap-3">
                <Fld label="State">
                  <Input value={f.state} onChange={(e) => set("state", e.target.value)} />
                </Fld>
                <Fld label="ZIP">
                  <Input value={f.zip} onChange={(e) => set("zip", e.target.value)} />
                </Fld>
              </div>
            </div>
          </Group>

          <Group title="Roof / scope">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fld label="Roofing type">
                <Input value={f.roofingType} onChange={(e) => set("roofingType", e.target.value)} />
              </Fld>
              <Fld label="Material">
                <Input value={f.materialSelection} onChange={(e) => set("materialSelection", e.target.value)} />
              </Fld>
              <Fld label="Pitch">
                <Input value={f.pitch} onChange={(e) => set("pitch", e.target.value)} />
              </Fld>
              <Fld label="Tear-off layers">
                <Input type="number" min="0" value={f.tearOffLayers} onChange={(e) => set("tearOffLayers", e.target.value)} />
              </Fld>
            </div>
          </Group>

          <Group title="Money ($)">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fld label="Contract value">
                <Input type="number" min="0" value={f.contractValue} onChange={(e) => set("contractValue", e.target.value)} />
              </Fld>
              <Fld label="Supplement">
                <Input type="number" min="0" value={f.supplement} onChange={(e) => set("supplement", e.target.value)} />
              </Fld>
              <Fld label="Deductible">
                <Input type="number" min="0" value={f.deductible} onChange={(e) => set("deductible", e.target.value)} />
              </Fld>
              <Fld label="Depreciation">
                <Input type="number" min="0" value={f.depreciation} onChange={(e) => set("depreciation", e.target.value)} />
              </Fld>
            </div>
            <div className="flex flex-wrap gap-4 pt-1 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={f.repGetsSupplement} onChange={(e) => set("repGetsSupplement", e.target.checked)} /> Rep gets supplement
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={f.repGetsDepreciation} onChange={(e) => set("repGetsDepreciation", e.target.checked)} /> Rep gets depreciation
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={f.companyProvidedLead} onChange={(e) => set("companyProvidedLead", e.target.checked)} /> Company-provided lead
              </label>
            </div>
          </Group>

          <Group title="Dates">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Fld label="Scheduled start">
                <Input type="date" value={f.scheduledStart} onChange={(e) => set("scheduledStart", e.target.value)} />
              </Fld>
              <Fld label="Scheduled end">
                <Input type="date" value={f.scheduledEnd} onChange={(e) => set("scheduledEnd", e.target.value)} />
              </Fld>
              <Fld label="Install date">
                <Input type="date" value={f.installDate} onChange={(e) => set("installDate", e.target.value)} />
              </Fld>
              <Fld label="Adjuster meeting">
                <Input type="date" value={f.adjusterMeetingAt} onChange={(e) => set("adjusterMeetingAt", e.target.value)} />
              </Fld>
              <Fld label="Completed">
                <Input type="date" value={f.completedAt} onChange={(e) => set("completedAt", e.target.value)} />
              </Fld>
            </div>
          </Group>

          <Group title="Notes">
            <Textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Group>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
