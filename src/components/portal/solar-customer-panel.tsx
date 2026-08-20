"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCustomerDetailsAction } from "@/server/modules/solar/energy-actions";

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
}: {
  leadId: string;
  customer: SolarCustomerView;
  /** A drawn array is positioned against the OLD address if this one changes. */
  hasLayout: boolean;
  canEdit: boolean;
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
