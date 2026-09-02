"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Languages, Loader2, Mail, MapPin, Pencil, Phone, Tag, User, Users, X } from "lucide-react";
import { CopyButton } from "@/components/portal/copy-button";
import { Card, type DealTone } from "@/components/portal/deal-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateLeadPatchAction } from "@/server/modules/leads/manage";

/**
 * Who the homeowner is and how to reach them, in the sidebar where a rep can
 * see it from any tab — and editable in place.
 *
 * The card owns its own chrome rather than being wrapped in a <Card> by the
 * page, because the Edit button lives in the header and the fields it toggles
 * live in the body: split them across the RSC boundary and the button can't
 * reach the state. The page used to carry two blanket "Edit" buttons at the top
 * that threw you onto a separate form for the whole lead; a rep fixing a typo'd
 * phone number should not have to leave the deal.
 *
 * Every contact slot renders whether or not it is filled. A missing phone
 * number is a fact about the deal — the thing standing between a rep and a
 * conversation — and hiding the row makes it look like the card is complete
 * when it isn't. An empty slot says so and opens the editor on click, so
 * "there's no number" and "here's where you put one" are the same click.
 *
 * Every reachable value gets a copy button, because the actual job here is
 * getting a phone number into a dialler or an address into a maps app — and
 * hand-retyping a customer's email is how a proposal goes to the wrong inbox.
 *
 * Phone and email are also real `tel:` / `mailto:` links: on a phone in a
 * driveway, tapping to call beats copy-then-paste.
 */

/** The lead's raw homeowner columns — what the editor writes back. */
export type HomeownerValues = {
  firstName: string;
  lastName: string;
  /**
   * Co-owner / co-signer on the deal, e.g. a spouse. The EMAIL is what makes
   * them a signer rather than a name on a page — without one they print on the
   * contract but are never sent a link to sign it.
   */
  coOwnerName: string | null;
  coOwnerEmail: string | null;
  coOwnerPhone: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Preferred spoken language, e.g. "Spanish". Null on most deals. */
  preferredLanguage: string | null;
  sourceId: string | null;
  notes: string | null;
};

type SourceOption = { id: string; name: string };

/** Null-safe trim to the empty string the patch action reads as "clear this". */
const s = (v: string | null | undefined) => v ?? "";

export function HomeownerCard({
  leadId,
  values,
  sources,
  canEdit,
  tone = "brand",
}: {
  leadId: string;
  values: HomeownerValues;
  /** Selectable lead sources. Empty list hides the row's editor, not the row. */
  sources: SourceOption[];
  /** False for a viewer who can't update the lead: no Edit button, and empty
   *  slots read as "Not provided" with nothing to click. */
  canEdit: boolean;
  tone?: DealTone;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState(values);

  // No effect syncing `draft` to `values`: open() re-seeds it from the current
  // props every time the editor opens, so a stale draft can never be shown. An
  // effect here would also fight the rep's cursor, overwriting half-typed input
  // whenever an unrelated save re-rendered the page.
  const set =<K extends keyof HomeownerValues>(key: K, v: HomeownerValues[K]) =>
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
    if (!draft.firstName.trim() || !draft.lastName.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    setSaving(true);
    const res = await updateLeadPatchAction(leadId, {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      coOwnerName: s(draft.coOwnerName).trim(),
      coOwnerEmail: s(draft.coOwnerEmail).trim(),
      coOwnerPhone: s(draft.coOwnerPhone).trim(),
      phone: s(draft.phone).trim(),
      email: s(draft.email).trim(),
      address: s(draft.address).trim(),
      city: s(draft.city).trim(),
      state: s(draft.state).trim(),
      zip: s(draft.zip).trim(),
      preferredLanguage: s(draft.preferredLanguage).trim(),
      sourceId: s(draft.sourceId),
      notes: s(draft.notes).trim(),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setEditing(false);
    toast.success("Homeowner details saved");
    router.refresh();
  }

  const name = `${values.firstName} ${values.lastName}`.trim();
  const address =
    [values.address, values.city, values.state, values.zip].filter(Boolean).join(", ") || null;
  const leadSource = sources.find((o) => o.id === values.sourceId)?.name ?? null;

  return (
    <Card
      title="Homeowner Information"
      icon={User}
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
      {editing ? (
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} />
            </Field>
            <Field label="Last name">
              <Input value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </Field>
          </div>
          <Field label="Co-owner">
            <Input
              value={s(draft.coOwnerName)}
              onChange={(e) => set("coOwnerName", e.target.value)}
              placeholder="Spouse or co-signer"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Co-owner email">
              <Input
                type="email"
                value={s(draft.coOwnerEmail)}
                onChange={(e) => set("coOwnerEmail", e.target.value)}
                placeholder="Needed to send them documents"
              />
            </Field>
            <Field label="Co-owner phone">
              <Input
                value={s(draft.coOwnerPhone)}
                onChange={(e) => set("coOwnerPhone", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Phone">
            <Input value={s(draft.phone)} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={s(draft.email)} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Address">
            <Input value={s(draft.address)} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <Input value={s(draft.city)} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="State">
              <Input value={s(draft.state)} onChange={(e) => set("state", e.target.value)} />
            </Field>
            <Field label="ZIP">
              <Input value={s(draft.zip)} onChange={(e) => set("zip", e.target.value)} />
            </Field>
          </div>
          <Field label="Language">
            <Input
              value={s(draft.preferredLanguage)}
              onChange={(e) => set("preferredLanguage", e.target.value)}
              placeholder="English"
            />
          </Field>
          {sources.length > 0 && (
            <Field label="Lead source">
              {/* Radix Select has no empty-string value, so "none" stands in for
                  "no source" and is mapped back to "" on the way out. */}
              <Select
                value={draft.sourceId ?? "none"}
                onValueChange={(v) => set("sourceId", v === "none" ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No source</SelectItem>
                  {sources.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Notes">
            <Textarea
              rows={4}
              value={s(draft.notes)}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Anything the next person to open this deal should know"
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-3.5">
          <Row icon={User} label="Name" value={name || null} copyLabel="name" onEdit={canEdit ? open : undefined} />
          <Row
            icon={Users}
            label="Co-owner"
            // Named rather than shown on its own row: the address only matters
            // as the reason this person can be sent something, and a second
            // empty row for every deal without a spouse is noise.
            value={
              values.coOwnerName
                ? values.coOwnerEmail
                  ? `${values.coOwnerName} · ${values.coOwnerEmail}`
                  : `${values.coOwnerName} · no email, cannot sign`
                : null
            }
            copyLabel="co-owner"
            onEdit={canEdit ? open : undefined}
          />
          <Row
            icon={Phone}
            label="Phone"
            value={values.phone}
            href={values.phone ? `tel:${values.phone.replace(/[^\d+]/g, "")}` : undefined}
            copyLabel="phone"
            onEdit={canEdit ? open : undefined}
          />
          <Row
            icon={Mail}
            label="Email"
            value={values.email}
            href={values.email ? `mailto:${values.email}` : undefined}
            copyLabel="email"
            onEdit={canEdit ? open : undefined}
          />
          <Row
            icon={MapPin}
            label="Address"
            value={address}
            copyLabel="address"
            onEdit={canEdit ? open : undefined}
          />
          {/* Before the lead source on purpose: this one changes how you talk to
              the person, so it belongs with the ways of reaching them. No copy
              button — nobody pastes a language anywhere. */}
          <Row
            icon={Languages}
            label="Language"
            value={values.preferredLanguage}
            onEdit={canEdit ? open : undefined}
          />
          <Row icon={Tag} label="Lead source" value={leadSource} onEdit={canEdit ? open : undefined} />

          <div className="border-t border-border pt-3.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Notes
            </div>
            {values.notes ? (
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {values.notes}
              </p>
            ) : (
              <p className="mt-1.5 text-sm">
                <Empty label="notes" onEdit={canEdit ? open : undefined} />
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  href,
  copyLabel,
  onEdit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  href?: string;
  copyLabel?: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        {value ? (
          href ? (
            <a
              href={href}
              className="mt-0.5 block break-words text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {value}
            </a>
          ) : (
            <p className="mt-0.5 break-words text-sm font-medium">{value}</p>
          )
        ) : (
          <p className="mt-0.5 text-sm">
            <Empty label={label.toLowerCase()} onEdit={onEdit} />
          </p>
        )}
      </div>
      {/* Nothing to copy on an empty slot, and a dead copy button next to
          "Add phone" is worse than no button at all. */}
      {copyLabel && value && <CopyButton value={value} label={copyLabel} className="mt-3.5" />}
    </div>
  );
}

/** The empty state of one slot: an invitation when you can edit, a fact when you can't. */
function Empty({ label, onEdit }: { label: string; onEdit?: () => void }) {
  if (!onEdit) {
    return <span className="text-muted-foreground/70">Not provided</span>;
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className="font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      Add {label}
    </button>
  );
}
