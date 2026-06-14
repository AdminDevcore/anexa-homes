"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, Upload, Check, ShieldCheck, Landmark, FileText, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveOnboardingAction, uploadOnboardingDocAction } from "@/server/modules/onboarding/actions";
import type { OnboardingView } from "@/server/modules/onboarding/queries";

const TAX_CLASSES = [
  ["individual", "Individual / Sole proprietor"],
  ["llc", "LLC"],
  ["s_corp", "S-Corporation"],
  ["c_corp", "C-Corporation"],
  ["partnership", "Partnership"],
];

export function OnboardingWizard({ initial, firstName, lastName }: { initial: OnboardingView | null; firstName: string; lastName: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({
    legalFirstName: initial?.legalFirstName ?? firstName,
    legalMiddleName: initial?.legalMiddleName ?? "",
    legalLastName: initial?.legalLastName ?? lastName,
    dateOfBirth: initial?.dateOfBirth ? initial.dateOfBirth.slice(0, 10) : "",
    ssn: "",
    address: initial?.address ?? "", city: initial?.city ?? "", state: initial?.state ?? "", zip: initial?.zip ?? "",
    accountHolderName: initial?.accountHolderName ?? "",
    bankName: initial?.bankName ?? "", routingNumber: initial?.routingNumber ?? "", account: "", accountType: initial?.accountType ?? "checking",
    accountAddress: initial?.accountAddress ?? "",
    taxClassification: initial?.taxClassification ?? "individual", businessName: initial?.businessName ?? "", ein: "",
    signatureName: initial?.signatureName ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const [docs, setDocs] = React.useState({
    id: !!initial?.idPhotoFileId,
    id_back: !!initial?.idPhotoBackFileId,
    ssn_card: !!initial?.ssnCardFileId,
    ssn_back: !!initial?.ssnCardBackFileId,
    voided_check: !!initial?.voidedCheckFileId,
  });

  async function upload(kind: "id" | "id_back" | "ssn_card" | "ssn_back" | "voided_check", file: File) {
    const fd = new FormData();
    fd.set("kind", kind); fd.set("file", file);
    const res = await uploadOnboardingDocAction(fd);
    if (!res.ok) return toast.error(res.error);
    setDocs((d) => ({ ...d, [kind]: true }));
    toast.success("Uploaded");
  }

  async function saveDraft() {
    setBusy(true);
    const res = await saveOnboardingAction({ ...f, complete: false });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Saved");
  }

  async function submit() {
    if (!docs.id || !docs.id_back) return toast.error("Please upload the front and back of your driver's license / ID.");
    if (!docs.ssn_card || !docs.ssn_back) return toast.error("Please upload the front and back of your Social Security card.");
    setBusy(true);
    const res = await saveOnboardingAction({ ...f, complete: true });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("All set — welcome aboard!");
    router.push("/portal");
  }

  return (
    <div className="space-y-6">
      <Section icon={ShieldCheck} title="Identity" subtitle="Your legal name as it appears on your tax documents.">
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldI label="Legal first name" value={f.legalFirstName} onChange={set("legalFirstName")} />
          <FieldI label="Middle name" value={f.legalMiddleName} onChange={set("legalMiddleName")} />
          <FieldI label="Legal last name" value={f.legalLastName} onChange={set("legalLastName")} />
          <FieldI label="Date of birth" type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} />
          <Field label="Social Security Number" secure note={initial?.ssnMasked ? `On file: ${initial.ssnMasked}` : undefined}>
            <Input value={f.ssn} onChange={set("ssn")} placeholder={initial?.ssnMasked ?? "###-##-####"} inputMode="numeric" />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><FieldI label="Home address" value={f.address} onChange={set("address")} /></div>
          <FieldI label="City" value={f.city} onChange={set("city")} />
          <div className="grid grid-cols-2 gap-2">
            <FieldI label="State" value={f.state} onChange={set("state")} />
            <FieldI label="ZIP" value={f.zip} onChange={set("zip")} />
          </div>
        </div>
      </Section>

      <Section icon={Landmark} title="Direct deposit" subtitle="Where we send your pay. Encrypted at rest.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldI label="Name on account" value={f.accountHolderName} onChange={set("accountHolderName")} />
          <FieldI label="Bank name" value={f.bankName} onChange={set("bankName")} />
          <Field label="Account type">
            <select value={f.accountType} onChange={set("accountType")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </Field>
          <FieldI label="Routing number" value={f.routingNumber} onChange={set("routingNumber")} inputMode="numeric" />
          <Field label="Account number" secure note={initial?.accountMasked ? `On file: ${initial.accountMasked}` : undefined}>
            <Input value={f.account} onChange={set("account")} placeholder={initial?.accountMasked ?? "Account number"} inputMode="numeric" />
          </Field>
          <div className="sm:col-span-2"><FieldI label="Address on account" value={f.accountAddress} onChange={set("accountAddress")} /></div>
        </div>
      </Section>

      <Section icon={FileText} title="Tax info (W-9 / 1099)" subtitle="Used to prepare your year-end 1099.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax classification">
            <select value={f.taxClassification} onChange={set("taxClassification")} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              {TAX_CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <FieldI label="Business / DBA name (if any)" value={f.businessName} onChange={set("businessName")} />
          <Field label="EIN (if a business)" secure note={initial?.einMasked ? `On file: ${initial.einMasked}` : undefined}>
            <Input value={f.ein} onChange={set("ein")} placeholder={initial?.einMasked ?? "##-#######"} inputMode="numeric" />
          </Field>
        </div>
      </Section>

      <Section icon={IdCard} title="Documents" subtitle="A clear photo of each side. Stored privately & encrypted on your profile.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DocUpload label="Driver's license — Front" hint="Front of license / ID" done={docs.id} onFile={(file) => upload("id", file)} />
          <DocUpload label="Driver's license — Back" hint="Back of license / ID" done={docs.id_back} onFile={(file) => upload("id_back", file)} />
          <DocUpload label="Social Security — Front" hint="Front of SS card" done={docs.ssn_card} onFile={(file) => upload("ssn_card", file)} />
          <DocUpload label="Social Security — Back" hint="Back of SS card" done={docs.ssn_back} onFile={(file) => upload("ssn_back", file)} />
          <DocUpload label="Voided check (optional)" hint="For direct deposit" done={docs.voided_check} onFile={(file) => upload("voided_check", file)} />
        </div>
      </Section>

      <Section icon={Check} title="Sign & submit" subtitle="Type your full legal name to confirm the information is accurate.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldI label="Signature (type your full name)" value={f.signatureName} onChange={set("signatureName")} />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={saveDraft} disabled={busy}>Save & finish later</Button>
          <Button onClick={submit} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Submit & enter portal
          </Button>
        </div>
      </Section>
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }: { icon: typeof Check; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><Icon className="size-4" /></div>
        <div>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, secure, note, children }: { label: string; secure?: boolean; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs">{label}{secure && <Lock className="size-3 text-muted-foreground" />}</Label>
      {children}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function FieldI({ label, value, onChange, type = "text", inputMode }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; inputMode?: "numeric" }) {
  return (
    <Field label={label}><Input type={type} value={value} onChange={onChange} inputMode={inputMode} /></Field>
  );
}

function DocUpload({ label, hint, done, onFile }: { label: string; hint: string; done: boolean; onFile: (f: File) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      className={cn("flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-center transition-colors", done ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:bg-muted")}
    >
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { setBusy(true); await onFile(file); setBusy(false); } }} />
      {busy ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : done ? <Check className="size-5 text-emerald-600" /> : <Upload className="size-5 text-muted-foreground" />}
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground">{done ? "Uploaded · tap to replace" : hint}</span>
    </button>
  );
}
