"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCustomerDetailsAction } from "@/server/modules/solar/energy-actions";
import { setSolarSystemTypeAction } from "@/server/modules/solar/actions";
import { cn } from "@/lib/utils";

export type SolarSystemType = "pv" | "pv_storage" | "storage";

export type SolarCustomerView = {
  firstName: string;
  lastName: string;
  coOwnerName: string | null;
  preferredLanguage: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

/**
 * Who we are quoting, checked before we quote them.
 *
 * Editable in place rather than a read-only summary with a link away: a rep who
 * spots a wrong phone number is mid-call, and sending them to another screen to
 * fix it is how it stays wrong.
 *
 * Writes the contact fields and nothing else — see saveCustomerDetailsAction.
 */
export function SolarCustomerPanel({
  leadId,
  customer,
  hasLayout,
  canEdit,
  systemType,
}: {
  leadId: string;
  customer: SolarCustomerView;
  /** A drawn array is positioned against the OLD address if this one changes. */
  hasLayout: boolean;
  canEdit: boolean;
  systemType: SolarSystemType;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    coOwnerName: customer.coOwnerName ?? "",
    preferredLanguage: customer.preferredLanguage ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    address: customer.address ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    zip: customer.zip ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await saveCustomerDetailsAction({ leadId, ...f });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);

    // The layout is drawn against the deal's coordinates, and a corrected
    // address throws those away so the roof can be re-found. Saying so beats
    // a rep discovering it when the panels are floating over next door.
    if (res.addressMoved && hasLayout) {
      toast.warning(
        "Address changed — the roof view will re-centre on the new one. Check the panel layout still sits on the house."
      );
    } else {
      toast.success("Customer details saved");
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <SystemTypePicker
        leadId={leadId}
        value={systemType}
        canEdit={canEdit}
        hasLayout={hasLayout}
      />

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Who we are talking to
        </h4>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <TextField id="first-name" label="First name" value={f.firstName} onChange={(v) => set("firstName", v)} disabled={!canEdit} />
          <TextField id="last-name" label="Last name" value={f.lastName} onChange={(v) => set("lastName", v)} disabled={!canEdit} />
          <TextField
            id="co-signer"
            label="Co-signer name"
            value={f.coOwnerName}
            onChange={(v) => set("coOwnerName", v)}
            disabled={!canEdit}
            hint="The other person on the title or the loan, if there is one."
          />
          {/* Free text with suggestions rather than a fixed select: the list a
              company actually serves is theirs, not ours, and a datalist still
              lets somebody type "Tagalog". Same control as the intake form. */}
          <TextField
            id="preferred-language"
            label="Preferred language"
            list="solar-language-options"
            placeholder="English"
            value={f.preferredLanguage}
            onChange={(v) => set("preferredLanguage", v)}
            disabled={!canEdit}
          />
          <datalist id="solar-language-options">
            {["English", "Spanish", "Vietnamese", "Mandarin", "Tagalog", "Arabic", "French", "Portuguese"].map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <TextField id="phone" label="Phone" value={f.phone} onChange={(v) => set("phone", v)} disabled={!canEdit} />
          <TextField id="email" label="Email" type="email" value={f.email} onChange={(v) => set("email", v)} disabled={!canEdit} />
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Where the system goes
        </h4>
        <div className="max-w-3xl">
          <TextField id="address" label="Address" value={f.address} onChange={(v) => set("address", v)} disabled={!canEdit} />
        </div>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
          <TextField id="city" label="City" value={f.city} onChange={(v) => set("city", v)} disabled={!canEdit} />
          <TextField id="state" label="State" value={f.state} onChange={(v) => set("state", v)} disabled={!canEdit} />
          <TextField id="zip" label="ZIP" value={f.zip} onChange={(v) => set("zip", v)} disabled={!canEdit} />
        </div>
        {hasLayout && (
          <p className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
            This deal already has a panel layout drawn on its roof. Changing the address moves the
            roof, so the array would need redrawing.
          </p>
        )}
      </section>

      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save customer details
        </Button>
      )}
    </div>
  );
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
const SYSTEM_TYPES: { value: SolarSystemType; label: string; blurb: string }[] = [
  { value: "pv", label: "Solar", blurb: "Panels only." },
  { value: "pv_storage", label: "Solar + Storage", blurb: "Panels with a battery." },
  { value: "storage", label: "Storage only", blurb: "A battery, no panels." },
];

/**
 * The first question on the first step, because everything downstream reshapes
 * from it: which steps show, what the design step asks, which lenders appear,
 * and which of two customer documents gets generated.
 *
 * SAVES ON CHANGE rather than behind the panel's Save button. A rep who picks
 * "Storage only" and walks to the next step must not find the roof designer
 * still sitting there — and they would, because the button below writes contact
 * fields on a different action entirely.
 */
function SystemTypePicker({
  leadId,
  value,
  canEdit,
  hasLayout,
}: {
  leadId: string;
  value: SolarSystemType;
  canEdit: boolean;
  hasLayout: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<SolarSystemType | null>(null);

  async function pick(next: SolarSystemType) {
    if (next === value || busy) return;

    // Switching to storage throws the array away — see setSolarSystemTypeAction.
    // Losing a drawn roof to a mis-click is worth one question.
    if (next === "storage" && hasLayout) {
      const ok = window.confirm(
        "This deal has a panel layout drawn on it. Quoting storage only will clear the array, its production and the drawing. Continue?"
      );
      if (!ok) return;
    }

    setPending(next);
    setBusy(true);
    try {
      const res = await setSolarSystemTypeAction({ leadId, systemType: next });
      if (!res.ok) return toast.error(res.error);
      router.refresh();
    } catch {
      toast.error("Could not change what this deal is quoting.");
    } finally {
      // In a finally: an action that throws must not leave the picker frozen.
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        What are we quoting?
      </h4>
      {/* A real radiogroup, so the three read as one choice to a screen reader
          and to a test rather than as three unrelated toggles. */}
      <div role="radiogroup" aria-label="What are we quoting?" className="flex flex-wrap gap-2">
        {SYSTEM_TYPES.map((t) => {
          const active = value === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canEdit || busy}
              onClick={() => pick(t.value)}
              className={cn(
                "flex-1 basis-48 rounded-lg border p-3 text-left transition",
                active
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border bg-card hover:border-primary/50",
                (!canEdit || busy) && "cursor-not-allowed opacity-70"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {t.label}
                {pending === t.value && <Loader2 className="size-3.5 animate-spin" />}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t.blurb}</span>
            </button>
          );
        })}
      </div>
      {value === "storage" && (
        <p className="text-xs text-muted-foreground">
          This deal is priced per battery and its proposal argues from backup hours and bill
          savings rather than from production. There is no array to design.
        </p>
      )}
    </section>
  );
}

function TextField({
  id, label, value, onChange, disabled, type = "text", hint, list, placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  hint?: string;
  /** A <datalist> id, for a field that suggests without constraining. */
  list?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type={type}
        list={list}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
