"use client";

import * as React from "react";
import type { Vertical } from "@prisma/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Paperclip, Upload, X } from "lucide-react";
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
import { uploadFileAction } from "@/server/modules/files/actions";
import {
  AddressAutocomplete,
  type ResolvedAddress,
} from "@/components/portal/address-autocomplete";

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
  setters,
  utilities,
  canAssign,
  fieldDefs,
  vertical,
}: {
  mode: "create" | "edit";
  leadId?: string;
  initial?: Initial;
  sources: Option[];
  stages: Option[];
  reps: Option[];
  /** Who could have knocked this door. Solar only — see the Setter field. */
  setters: Option[];
  /** The utilities this company sells into. Solar only. */
  utilities: { id: string; name: string }[];
  canAssign: boolean;
  fieldDefs: FieldDef[];
  /** The workspace this deal belongs to — solar hides the insurance-shaped fields. */
  vertical: Vertical;
}) {
  // Solar deals are priced off the system design, not guessed at intake, so the
  // dollar estimate has no place on the solar form. Roofing keeps it. The value
  // itself is never dropped: existing leads post theirs straight back (below).
  const showEstimatedValue = vertical !== "solar";
  /**
   * Solar-only fields, and solar-only omissions.
   *
   * `dealType` is the insurance-vs-cash question, and it does not apply: a
   * solar deal is cash, loan, lease or PPA, and WHICH is settled on the
   * proposal's Financing step once there is a system to price. Asking it at
   * the door made a rep answer a roofing question about a solar job, and the
   * answer then sat on the deal contradicting the financing product.
   */
  const isSolar = vertical === "solar";
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [v, setV] = React.useState({
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    coOwnerName: initial?.coOwnerName ?? "",
    preferredLanguage: initial?.preferredLanguage ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    address: initial?.address ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    zip: initial?.zip ?? "",
    sourceId: initial?.sourceId ?? "",
    // Opens on the first stage of the pipeline rather than on "Select stage".
    // The server already derives this — an appointment date lands the deal in
    // "Appointment Set", no date keeps it in the first stage — so a blank
    // picker was asking a rep to make a choice that had already been made for
    // them, on the one field of the form they cannot get wrong.
    stageId: initial?.stageId ?? (mode === "create" ? (stages[0]?.id ?? "") : ""),
    assignedRepId: initial?.assignedRepId ?? "",
    setterId: initial?.setterId ?? "",
    utilityProvider: initial?.utilityProvider ?? "",
    serviceType: (initial?.serviceType ?? "roofing") as LeadInput["serviceType"],
    dealType: (initial?.dealType ?? "insurance") as LeadInput["dealType"],
    valueDollars: initial?.valueDollars ?? "",
    priority: (initial?.priority ?? "medium") as LeadInput["priority"],
    appointmentDate: initial?.appointmentDate ?? "",
    notes: initial?.notes ?? "",
  });
  const [custom, setCustom] = React.useState<Record<string, string>>(
    (initial?.customFields as Record<string, string>) ?? {}
  );
  // Files staged for upload — attached to the appointment after it's created.
  const [files, setFiles] = React.useState<File[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  /**
   * The rooftop point behind the address currently in the form, if the rep
   * picked it from the dropdown rather than typing it. Kept alongside the
   * address it describes and dropped the instant any of the four address fields
   * is hand-edited, so a coordinate can never outlive the house it belongs to.
   */
  const [picked, setPicked] = React.useState<ResolvedAddress | null>(null);

  function set<K extends keyof typeof v>(k: K, val: (typeof v)[K]) {
    if (k === "address" || k === "city" || k === "state" || k === "zip") setPicked(null);
    setV((s) => ({ ...s, [k]: val }));
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function uploadStaged(leadIdForUpload: string) {
    let failed = 0;
    for (const file of files) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("leadId", leadIdForUpload);
      const res = await uploadFileAction(fd);
      if (!res.ok) failed += 1;
    }
    if (failed > 0) toast.error(`${failed} attachment${failed === 1 ? "" : "s"} failed to upload.`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.firstName.trim() || !v.lastName.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    // Enforce required custom fields.
    const missing = fieldDefs.find((f) => f.required && !(custom[f.key] ?? "").trim());
    if (missing) {
      toast.error(`${missing.label} is required.`);
      return;
    }
    setPending(true);
    const payload: LeadInput = {
      firstName: v.firstName,
      lastName: v.lastName,
      coOwnerName: v.coOwnerName,
      preferredLanguage: v.preferredLanguage,
      email: v.email,
      phone: v.phone,
      address: v.address,
      city: v.city,
      state: v.state,
      zip: v.zip,
      sourceId: v.sourceId,
      stageId: v.stageId,
      setterId: v.setterId,
      utilityProvider: isSolar ? v.utilityProvider : "",
      assignedRepId: v.assignedRepId,
      serviceType: v.serviceType,
      dealType: v.dealType,
      valueCents: Math.round((Number(v.valueDollars) || 0) * 100),
      priority: v.priority,
      appointmentAt: v.appointmentDate,
      notes: v.notes,
      customFields: custom,
      // Only travels when the picked address is still the one in the form.
      ...(picked ? { lat: picked.lat, lng: picked.lng } : {}),
    };
    const res = mode === "create"
      ? await createLeadAction(payload)
      : await updateLeadAction(leadId!, payload);
    if (!res.ok) {
      setPending(false);
      toast.error(res.error);
      return;
    }
    // Attach any staged files to the (now-existing) appointment.
    const targetId = mode === "create" ? res.id : leadId!;
    if (files.length > 0) await uploadStaged(targetId);
    setPending(false);
    toast.success(mode === "create" ? "Appointment created" : "Appointment updated");
    router.push(`/portal/leads/${res.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      <Section title="Contact">
        <Grid>
          <Field label="First name" required><Input value={v.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Last name" required><Input value={v.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="Co-owner name (if applicable)"><Input value={v.coOwnerName} onChange={(e) => set("coOwnerName", e.target.value)} /></Field>
          {/* Free text with suggestions rather than a fixed <select>: the list
              a company actually serves is theirs, not ours, and a datalist
              still lets someone type "Tagalog". */}
          <Field label="Preferred language">
            <Input
              list="preferred-language-options"
              value={v.preferredLanguage}
              placeholder="English"
              onChange={(e) => set("preferredLanguage", e.target.value)}
            />
            <datalist id="preferred-language-options">
              {["English", "Spanish", "Vietnamese", "Mandarin", "Tagalog", "Arabic", "French", "Portuguese"].map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
          <Field label="Email"><Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone"><Input value={v.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        </Grid>
        <Field label="Address">
          <AddressAutocomplete
            value={v.address}
            onChange={(val) => set("address", val)}
            onSelect={(parts) => {
              setV((s) => ({
                ...s,
                address: parts.address,
                // Only overwrite City/State/ZIP when the suggestion provides them,
                // so a partial match doesn't wipe a value the user already typed.
                city: parts.city || s.city,
                state: parts.state || s.state,
                zip: parts.zip || s.zip,
              }));
              // Set after the fields, because `set` above clears it on address edits.
              setPicked(parts.precision === "ROOFTOP" ? parts : null);
            }}
          />
        </Field>
        <Grid cols={3}>
          <Field label="City"><Input value={v.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="State"><Input value={v.state} onChange={(e) => set("state", e.target.value)} /></Field>
          <Field label="ZIP"><Input value={v.zip} onChange={(e) => set("zip", e.target.value)} /></Field>
        </Grid>
      </Section>

      <Section title="Pipeline">
        <Grid>
          {/* No product/vertical picker — the deal belongs to the active vertical
              workspace (switched from the top-right). */}
          <Field label="Stage">
            <Picker value={v.stageId} onChange={(val) => set("stageId", val)} options={stages} placeholder="Select stage" />
          </Field>
          <Field label="Source">
            <Picker value={v.sourceId} onChange={(val) => set("sourceId", val)} options={sources} placeholder="Select source" />
          </Field>
          {canAssign && (
            <Field label={isSolar ? "Sales rep" : "Assigned rep"}>
              <Picker value={v.assignedRepId} onChange={(val) => set("assignedRepId", val)} options={reps} placeholder="Unassigned" />
            </Field>
          )}
          {/* Solar sells door to door: whoever knocked and booked this is paid
              off it too, and a single "assigned rep" could only name one of the
              two people on the deal. */}
          {canAssign && isSolar && (
            <Field label="Setter">
              <Picker value={v.setterId} onChange={(val) => set("setterId", val)} options={setters} placeholder="Same as the rep" />
            </Field>
          )}
          {!isSolar && (
            <Field label="Deal type">
              <Select value={v.dealType} onValueChange={(val) => set("dealType", val as LeadInput["dealType"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="insurance">Insurance claim</SelectItem>
                  <SelectItem value="cash">Cash / financed</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Insurance = filed claim (deductible, depreciation, scope). Cash = customer pays out of pocket or finances.</p>
            </Field>
          )}
          {showEstimatedValue && (
            <Field label="Estimated value (USD)">
              <Input type="number" value={v.valueDollars} onChange={(e) => set("valueDollars", e.target.value)} placeholder="0" />
            </Field>
          )}
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
          {isSolar && (
            <Field label="Utility provider">
              {/* Free text with the company's list as suggestions: a rep at the
                  door should not be blocked by a utility nobody has added yet,
                  and the Energy step still owns the final value. */}
              <Input
                list="lead-utility-options"
                value={v.utilityProvider}
                placeholder="Who delivers their power"
                onChange={(e) => set("utilityProvider", e.target.value)}
              />
              <datalist id="lead-utility-options">
                {utilities.map((u) => (
                  <option key={u.id} value={u.name} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Carried into the proposal&apos;s Energy step, so nobody has to ask twice.
              </p>
            </Field>
          )}
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

      <Section title="Attachments">
        <p className="-mt-2 mb-1 text-xs text-muted-foreground">
          Photos, PDFs, or documents for this appointment. They&rsquo;ll show in its Photos &amp; Documents after it&rsquo;s created.
        </p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> Add files
        </Button>
        {files.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

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
/**
 * Label + control. The label is wired to its control with a generated id rather
 * than left floating: without `htmlFor` the association is visual only, so a
 * screen reader announces "edit text, blank" for City, State and ZIP, and
 * nothing can address them by name. The child keeps its own `id` if it has one.
 */
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  const generated = React.useId();
  const child = React.isValidElement<{ id?: string }>(children) ? children : null;
  const id = child?.props.id ?? generated;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={child ? id : undefined} className="text-sm">
        {label}{required && <span className="text-destructive"> *</span>}
      </Label>
      {child ? React.cloneElement(child, { id }) : children}
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
