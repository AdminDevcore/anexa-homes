"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLeadAction, updateLeadAction, type LeadInput } from "@/server/modules/leads/manage";

type Option = { id: string; name: string };
type FieldDef = { id: string; key: string; label: string; type: string; options: string[]; required: boolean };

type Initial = Partial<LeadInput> & { valueDollars?: string; appointmentDate?: string };

export function LeadForm({
  mode,
  leadId,
  initial,
  sources,
  stages,
  reps,
  canAssign,
  fieldDefs,
}: {
  mode: "create" | "edit";
  leadId?: string;
  initial?: Initial;
  sources: Option[];
  stages: Option[];
  reps: Option[];
  canAssign: boolean;
  fieldDefs: FieldDef[];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [v, setV] = React.useState({
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    address: initial?.address ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    zip: initial?.zip ?? "",
    sourceId: initial?.sourceId ?? "",
    stageId: initial?.stageId ?? "",
    assignedRepId: initial?.assignedRepId ?? "",
    serviceType: (initial?.serviceType ?? "roofing") as LeadInput["serviceType"],
    valueDollars: initial?.valueDollars ?? "",
    priority: (initial?.priority ?? "medium") as LeadInput["priority"],
    appointmentDate: initial?.appointmentDate ?? "",
    notes: initial?.notes ?? "",
  });
  const [custom, setCustom] = React.useState<Record<string, string>>(
    (initial?.customFields as Record<string, string>) ?? {}
  );

  function set<K extends keyof typeof v>(k: K, val: (typeof v)[K]) {
    setV((s) => ({ ...s, [k]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.firstName.trim() || !v.lastName.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    setPending(true);
    const payload: LeadInput = {
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      phone: v.phone,
      address: v.address,
      city: v.city,
      state: v.state,
      zip: v.zip,
      sourceId: v.sourceId,
      stageId: v.stageId,
      assignedRepId: v.assignedRepId,
      serviceType: v.serviceType,
      valueCents: Math.round((Number(v.valueDollars) || 0) * 100),
      priority: v.priority,
      appointmentAt: v.appointmentDate,
      notes: v.notes,
      customFields: custom,
    };
    const res = mode === "create"
      ? await createLeadAction(payload)
      : await updateLeadAction(leadId!, payload);
    setPending(false);
    if (res.ok) {
      toast.success(mode === "create" ? "Appointment created" : "Appointment updated");
      router.push(`/portal/leads/${res.id}`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <Section title="Contact">
        <Grid>
          <Field label="First name" required><Input value={v.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Last name" required><Input value={v.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone"><Input value={v.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        </Grid>
        <Field label="Address"><Input value={v.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Grid cols={3}>
          <Field label="City"><Input value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="State"><Input value={v.state} onChange={(e) => set("state", e.target.value)} /></Field>
          <Field label="ZIP"><Input value={v.zip} onChange={(e) => set("zip", e.target.value)} /></Field>
        </Grid>
      </Section>

      <Section title="Pipeline">
        <Grid>
          {/* No product/industry picker — the deal belongs to the active industry
              workspace (switched from the top-right). */}
          <Field label="Stage">
            <Picker value={v.stageId} onChange={(val) => set("stageId", val)} options={stages} placeholder="Select stage" />
          </Field>
          <Field label="Source">
            <Picker value={v.sourceId} onChange={(val) => set("sourceId", val)} options={sources} placeholder="Select source" />
          </Field>
          {canAssign && (
            <Field label="Assigned rep">
              <Picker value={v.assignedRepId} onChange={(val) => set("assignedRepId", val)} options={reps} placeholder="Unassigned" />
            </Field>
          )}
          <Field label="Estimated value (USD)">
            <Input type="number" value={v.valueDollars} onChange={(e) => set("valueDollars", e.target.value)} placeholder="0" />
          </Field>
          <Field label="Priority">
            <Select value={v.priority} onValueChange={(val) => set("priority", val as LeadInput["priority"])}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Appointment date & time">
            <Input type="datetime-local" value={v.appointmentDate} onChange={(e) => set("appointmentDate", e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Set a date and it moves to “Appointment Set”. Leave blank to keep it in “New Lead”.
            </p>
          </Field>
        </Grid>
      </Section>

      {fieldDefs.length > 0 && (
        <Section title="Custom Fields">
          <Grid>
            {fieldDefs.map((f) => (
              <Field key={f.id} label={f.label} required={f.required}>
                {f.type === "textarea" ? (
                  <Textarea value={custom[f.key] ?? ""} onChange={(e) => setCustom((s) => ({ ...s, [f.key]: e.target.value }))} />
                ) : f.type === "select" ? (
                  <Select value={custom[f.key] ?? ""} onValueChange={(val) => setCustom((s) => ({ ...s, [f.key]: val }))}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : f.type === "checkbox" ? (
                  <Select value={custom[f.key] ?? "false"} onValueChange={(val) => setCustom((s) => ({ ...s, [f.key]: val }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={custom[f.key] ?? ""} onChange={(e) => setCustom((s) => ({ ...s, [f.key]: e.target.value }))} />
                )}
              </Field>
            ))}
          </Grid>
        </Section>
      )}

      <Section title="Notes">
        <Textarea rows={4} value={v.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Appointment notes, damage description, etc." />
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {mode === "create" ? "Create Appointment" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-4 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}
function Picker({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
