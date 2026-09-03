"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
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
  coOwnerEmail: string | null;
  coOwnerPhone: string | null;
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
 * TWO COLUMNS, not one. The form used to be a single `max-w-3xl` stack adrift
 * in a full-width card — two thirds of the step was blank while eleven fields
 * queued up down the left edge. The right rail is what that space is for: the
 * one deal-level decision this step makes, and a running read of who ends up on
 * the contract, both worth having on screen while the fields are typed.
 *
 * Writes the contact fields and nothing else — see saveCustomerDetailsAction.
 */
export function SolarCustomerPanel({
  leadId,
  customer,
  hasLayout,
  canEdit,
  systemType,
  systemSizeKwDc,
}: {
  leadId: string;
  customer: SolarCustomerView;
  /** A drawn array is positioned against the OLD address if this one changes. */
  hasLayout: boolean;
  canEdit: boolean;
  systemType: SolarSystemType;
  /** For the rail's read of the deal. Zero until somebody designs a roof. */
  systemSizeKwDc: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const initial = React.useMemo(
    () => ({
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      coOwnerName: customer.coOwnerName ?? "",
      coOwnerEmail: customer.coOwnerEmail ?? "",
      coOwnerPhone: customer.coOwnerPhone ?? "",
      preferredLanguage: customer.preferredLanguage ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      city: customer.city ?? "",
      state: customer.state ?? "",
      zip: customer.zip ?? "",
    }),
    [customer]
  );
  const [f, setF] = React.useState(initial);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // What the rep has typed but not yet written. Drives the one indicator that
  // answers "did that save?" without them clicking again to be sure.
  const dirty = React.useMemo(
    () => (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]),
    [f, initial]
  );

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
    /* Three children, placed explicitly above `lg` so the rail can be one
       column while the phone gets a different ORDER than the desktop columns
       would give it: the question first, the form, then the summaries of what
       the form says. Stacking the whole rail on top would open a phone on
       "No co-signer on this deal" above the name fields it is describing. */
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-[auto_1fr]">
      <div className="order-1 lg:order-none lg:col-start-2 lg:row-start-1">
        <SystemTypePicker
          leadId={leadId}
          value={systemType}
          canEdit={canEdit}
          hasLayout={hasLayout}
        />
      </div>

      <aside className="order-3 space-y-4 lg:order-none lg:col-start-2 lg:row-start-2">
        <SignerSummary
          firstName={f.firstName}
          lastName={f.lastName}
          coOwnerName={f.coOwnerName}
          coOwnerEmail={f.coOwnerEmail}
        />
        <DealSummary systemType={systemType} systemSizeKwDc={systemSizeKwDc} hasLayout={hasLayout} />
      </aside>

      <div className="order-2 min-w-0 space-y-6 lg:order-none lg:col-start-1 lg:row-start-1 lg:row-span-2">
        {/* The homeowner's OWN phone and email sit with their name now. They
            used to fall below three optional co-signer fields, which put the
            number a rep is about to dial fourth in reading order. */}
        <FieldGroup title="Homeowner" hint="The person we are quoting.">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="first-name" label="First name" value={f.firstName} onChange={(v) => set("firstName", v)} disabled={!canEdit} />
            <TextField id="last-name" label="Last name" value={f.lastName} onChange={(v) => set("lastName", v)} disabled={!canEdit} />
            <TextField id="phone" label="Phone" value={f.phone} onChange={(v) => set("phone", v)} disabled={!canEdit} />
            <TextField id="email" label="Email" type="email" value={f.email} onChange={(v) => set("email", v)} disabled={!canEdit} />
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
          </div>
        </FieldGroup>

        {/* Its own group, marked optional, and after the homeowner rather than
            through the middle of them. Three fields most deals leave empty
            should not read as three fields most deals owe an answer to.
            Still rendered, never collapsed: a co-signer who is on the title and
            not on the screen is how one gets left off the contract. */}
        <FieldGroup
          title="Co-signer"
          optional
          hint="The other person on the title or the loan, if there is one. They need their own email before anything can be sent to them to sign."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField id="co-signer" label="Co-signer name" value={f.coOwnerName} onChange={(v) => set("coOwnerName", v)} disabled={!canEdit} />
            {/* Their own address, not the household's: it is what lets a
                co-signer be sent the contract. Without one they print on the
                document but can never sign it. */}
            <TextField id="co-signer-email" label="Co-signer email" type="email" value={f.coOwnerEmail} onChange={(v) => set("coOwnerEmail", v)} disabled={!canEdit} />
            <TextField id="co-signer-phone" label="Co-signer phone" value={f.coOwnerPhone} onChange={(v) => set("coOwnerPhone", v)} disabled={!canEdit} />
          </div>
        </FieldGroup>

        <FieldGroup title="Property" hint="Where the system goes.">
          <div className="space-y-3">
            <TextField id="address" label="Address" value={f.address} onChange={(v) => set("address", v)} disabled={!canEdit} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField id="city" label="City" value={f.city} onChange={(v) => set("city", v)} disabled={!canEdit} />
              <TextField id="state" label="State" value={f.state} onChange={(v) => set("state", v)} disabled={!canEdit} />
              <TextField id="zip" label="ZIP" value={f.zip} onChange={(v) => set("zip", v)} disabled={!canEdit} />
            </div>
            {hasLayout && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  This deal already has a panel layout drawn on its roof. Changing the address moves
                  the roof, so the array would need redrawing.
                </span>
              </p>
            )}
          </div>
        </FieldGroup>

        {canEdit && (
          <div className="flex items-center gap-3 border-t border-border/70 pt-4">
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Save customer details
            </Button>
            {dirty && !busy && (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One labelled block of fields.
 *
 * The step used to be two uppercase captions over an eleven-field grid, which
 * is the same amount of form with none of the shape. A titled group per subject
 * lets a rep looking for the ZIP find "Property" instead of reading labels.
 */
function FieldGroup({
  title,
  hint,
  optional,
  children,
}: {
  title: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {optional && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Optional
            </span>
          )}
        </h4>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** A rail card. Same shell for all three so the rail reads as one column. */
function RailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-muted/30 p-3.5">
      <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * Who ends up on the contract, read live off the fields as they are typed.
 *
 * The co-signer inputs say nothing about what a co-signer IS for, and a rep
 * only finds out an email was needed when the envelope will not send. This says
 * it while the field is still on screen and still empty.
 */
function SignerSummary({
  firstName,
  lastName,
  coOwnerName,
  coOwnerEmail,
}: {
  firstName: string;
  lastName: string;
  coOwnerName: string;
  coOwnerEmail: string;
}) {
  const name = `${firstName} ${lastName}`.trim();
  const co = coOwnerName.trim();
  return (
    <RailCard title="On the contract">
      <ul className="space-y-1.5 text-sm">
        <li className="flex items-baseline justify-between gap-2">
          <span className={cn("min-w-0 truncate", !name && "text-muted-foreground")}>
            {name || "No name yet"}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">Homeowner</span>
        </li>
        {co ? (
          <li className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">{co}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">Co-signer</span>
          </li>
        ) : (
          <li className="text-sm text-muted-foreground">No co-signer on this deal.</li>
        )}
      </ul>
      {co && !coOwnerEmail.trim() && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Add their email or they cannot be sent anything to sign.
        </p>
      )}
    </RailCard>
  );
}

/**
 * What the later steps have already put on this deal.
 *
 * Rendered only when there is something true to say. "0.00 kW" over a deal
 * nobody has designed is a figure about an array that does not exist, and a
 * storage deal has no array to have a size at all.
 */
function DealSummary({
  systemType,
  systemSizeKwDc,
  hasLayout,
}: {
  systemType: SolarSystemType;
  systemSizeKwDc: number;
  hasLayout: boolean;
}) {
  if (systemType === "storage") return null;

  return (
    <RailCard title="This deal">
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">System</dt>
          <dd className={cn("tabular-nums", systemSizeKwDc > 0 ? "font-medium" : "text-muted-foreground")}>
            {systemSizeKwDc > 0 ? `${systemSizeKwDc.toFixed(2)} kW` : "Not designed yet"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Roof layout</dt>
          <dd className={cn(!hasLayout && "text-muted-foreground")}>
            {hasLayout ? (
              <span className="inline-flex items-center gap-1 font-medium">
                <MapPin className="size-3.5 text-solar" aria-hidden /> Drawn
              </span>
            ) : (
              "Not drawn"
            )}
          </dd>
        </div>
      </dl>
    </RailCard>
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
 * almost always stays "Solar" — three tiles spend the top of the step arguing a
 * question nobody is stuck on.
 *
 * It lives in the rail rather than above the form: it is a fact about the DEAL,
 * not another contact field, and sitting over the name it was indistinguishable
 * from one. In the rail it stays on screen for the whole step and costs the
 * form no vertical space at all.
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
    <section className="rounded-xl border border-solar/30 bg-solar/5 p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <Label
          htmlFor="system-type"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          What are we quoting?
        </Label>
        {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>
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
      {sel === "storage" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Priced per battery, and its proposal argues from backup hours and bill savings rather than
          production. There is no array to design.
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
