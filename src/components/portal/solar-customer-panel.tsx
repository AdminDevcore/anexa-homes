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
 * A dropdown rather than three cards. The choice is made once, early, and
 * almost always stays "Solar" — three tiles the width of the panel spend the
 * top of the step arguing a question nobody is stuck on, and push the
 * customer's own details below the fold.
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
  // The select is driven by local state, not straight off the prop, so a
  // cancelled confirm can put it back: a controlled <select> whose value never
  // changes does not re-render, and the DOM node would sit on the rejected
  // pick. Reset during render (not in an effect) when the deal itself changes.
  const [sel, setSel] = React.useState<SolarSystemType>(value);
  const [seen, setSeen] = React.useState<SolarSystemType>(value);
  if (seen !== value) {
    setSeen(value);
    setSel(value);
  }

  async function pick(next: SolarSystemType) {
    if (next === value || busy) return;
    setSel(next);

    // Switching to storage throws the array away — see setSolarSystemTypeAction.
    // Losing a drawn roof to a mis-click is worth one question.
    if (next === "storage" && hasLayout) {
      const ok = window.confirm(
        "This deal has a panel layout drawn on it. Quoting storage only will clear the array, its production and the drawing. Continue?"
      );
      if (!ok) return setSel(value);
    }

    setBusy(true);
    try {
      const res = await setSolarSystemTypeAction({ leadId, systemType: next });
      if (!res.ok) {
        setSel(value);
        return toast.error(res.error);
      }
      router.refresh();
    } catch {
      setSel(value);
      toast.error("Could not change what this deal is quoting.");
    } finally {
      // In a finally: an action that throws must not leave the picker frozen.
      setBusy(false);
    }
  }

  return (
    <section className="flex max-w-3xl flex-wrap items-end gap-x-3 gap-y-1">
      <div className="w-full max-w-xs space-y-1">
        <Label htmlFor="system-type" className="text-xs">
          What are we quoting?
        </Label>
        <select
          id="system-type"
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
          value={sel}
          disabled={!canEdit || busy}
          onChange={(e) => void pick(e.target.value as SolarSystemType)}
        >
          {SYSTEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label} — {t.blurb.replace(/\.$/, "")}
            </option>
          ))}
        </select>
      </div>
      {busy && (
        <span className="flex h-9 items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </span>
      )}
      {sel === "storage" && (
        <p className="w-full text-xs text-muted-foreground">
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
