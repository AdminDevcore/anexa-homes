"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Caution,
  FieldGrid,
  Hint,
  Panel,
  SaveBar,
  SelectField,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import { AddressAutocomplete } from "@/components/portal/address-autocomplete";
import { makeMoney, makeDate } from "@/lib/format-core";
import {
  updateBrandingAction,
  updateCompanyIdentityAction,
  uploadBrandingLogoAction,
} from "@/server/modules/settings/actions";

// Radix <SelectItem> forbids an empty-string value, so the default option uses a
// "system" sentinel that maps to "" (no custom font) on save.
const FONT_FAMILIES = [
  { value: "system", label: "System default" },
  { value: "Inter", label: "Inter" },
  { value: "Roboto", label: "Roboto" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Lato", label: "Lato" },
  { value: "Poppins", label: "Poppins" },
  { value: "Source Sans 3", label: "Source Sans 3" },
];

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN"].map((c) => ({
  value: c,
  label: c,
}));

const LOCALES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
];

export type BrandingValues = {
  brandName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  emailFromName: string;
  recordPrefix: string;
  supportPhone: string;
  supportEmail: string;
  currencyCode: string;
  locale: string;
  customDomain: string;
  removePoweredBy: boolean;
};

export type IdentityValues = {
  name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
};

const BRANDING_TABS = ["brand", "company", "localization"] as const;
type BrandingTab = (typeof BRANDING_TABS)[number];

/**
 * Everything that decides what this company looks like and how it is named.
 *
 * Three forms used to sit on this page, two of them side by side, with three
 * Save buttons between them — and the two on the left posted the SAME action, so
 * pressing "Save branding" also wrote the localization fields and pressing
 * "Save localization" also wrote the logo. Nothing said so.
 *
 * One panel, three tabs, one Save. The Save works out which of the two actions
 * each change belongs to: the brand and localization are per-workspace, the
 * company identity is the legal entity and is shared by both.
 */
export function BrandingSettings({
  branding,
  identity,
  workspaceLabel,
  isOverride,
  initialTab,
}: {
  branding: BrandingValues;
  identity: IdentityValues;
  /** Which brand is being edited — Anexa Homes (Roofing) vs Prime Solar. */
  workspaceLabel?: string;
  /** True when edits land on this vertical's overrides rather than the company row. */
  isOverride?: boolean;
  initialTab?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const logoInputRef = React.useRef<HTMLInputElement>(null);

  const [tab, setTab] = React.useState<BrandingTab>(() =>
    (BRANDING_TABS as readonly string[]).includes(initialTab ?? "")
      ? (initialTab as BrandingTab)
      : "brand"
  );

  const saved = React.useMemo(() => ({ ...branding, ...identity }), [branding, identity]);
  const [draft, setDraft] = React.useState(saved);

  const serverKey = JSON.stringify(saved);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(saved);
  }

  const dirty = JSON.stringify(draft) !== serverKey;
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  /**
   * The logo is uploaded, not typed, so it commits on choose.
   *
   * It also writes into the draft, which means the preview moves immediately and
   * the Save still posts it — an upload that never reached the branding row
   * would leave a logo in storage that nothing renders.
   */
  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadBrandingLogoAction(fd);
      if (logoInputRef.current) logoInputRef.current.value = "";
      if (!res.ok) return toast.error(res.error);
      set("logoUrl", res.logoUrl);
      toast.success("Logo uploaded — Save to apply it");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const brandingChanged = (Object.keys(branding) as (keyof BrandingValues)[]).some(
        (k) => draft[k] !== branding[k]
      );
      const identityChanged = (Object.keys(identity) as (keyof IdentityValues)[]).some(
        (k) => draft[k] !== identity[k]
      );

      if (brandingChanged) {
        const res = await updateBrandingAction({
          brandName: draft.brandName,
          logoUrl: draft.logoUrl,
          faviconUrl: draft.faviconUrl,
          primaryColor: draft.primaryColor,
          accentColor: draft.accentColor,
          fontFamily: draft.fontFamily || "",
          emailFromName: draft.emailFromName,
          recordPrefix: draft.recordPrefix,
          supportPhone: draft.supportPhone,
          supportEmail: draft.supportEmail,
          currencyCode: draft.currencyCode,
          locale: draft.locale,
          customDomain: draft.customDomain,
          removePoweredBy: draft.removePoweredBy,
        });
        if (!res.ok) return toast.error(res.error);
      }

      if (identityChanged) {
        const res = await updateCompanyIdentityAction({
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          website: draft.website,
          address: draft.address,
          city: draft.city,
          state: draft.state,
          zip: draft.zip,
          timezone: draft.timezone,
        });
        if (!res.ok) return toast.error(res.error);
      }

      toast.success("Branding saved");
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  const formatter = makeMoney({ currency: draft.currencyCode, locale: draft.locale });
  const dateFormatter = makeDate({ locale: draft.locale });

  /** A proposal will not generate while any of these is blank. */
  const missingIdentity = [
    draft.name,
    draft.phone,
    draft.email,
    draft.address,
  ].some((v) => v.trim() === "");

  return (
    <div className="min-w-0">
      <Tabs value={tab} onValueChange={(v) => setTab(v as BrandingTab)} className="gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="brand">
            Brand{workspaceLabel ? ` — ${workspaceLabel}` : ""}
          </TabsTrigger>
          <TabsTrigger value="company">
            Company
            {missingIdentity && <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />}
          </TabsTrigger>
          <TabsTrigger value="localization">Localization</TabsTrigger>
        </TabsList>

        {/* ── BRAND ────────────────────────────────────────────────────── */}
        <TabsContent value="brand" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              {isOverride && (
                // Says out loud that blanks inherit rather than clear, so nobody
                // fills the whole form in defensively to avoid an empty brand.
                <Hint className="rounded-lg border border-dashed border-border p-3 text-xs">
                  These apply to the <strong>{workspaceLabel}</strong> workspace only. Anything left
                  blank falls back to the company brand, so a partly-filled brand never renders
                  empty. Currency and locale are company-wide and shared with every workspace.
                </Hint>
              )}

              <Panel title="Name and mark">
                <TextField
                  label="Brand name"
                  value={draft.brandName}
                  onChange={(v) => set("brandName", v)}
                  placeholder={
                    isOverride
                      ? "e.g. Prime Solar — blank inherits the company name"
                      : "Company name"
                  }
                />
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="branding-logo">
                    Logo
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="branding-logo"
                      value={draft.logoUrl}
                      onChange={(e) => set("logoUrl", e.target.value)}
                      placeholder="https://…/logo.png"
                    />
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={onLogoFile}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => logoInputRef.current?.click()}
                      className="shrink-0"
                    >
                      {uploading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      Upload
                    </Button>
                  </div>
                  <Hint>
                    Upload a PNG, JPG or WebP — or paste a hosted image URL. It replaces the sidebar
                    logo when you save.
                  </Hint>
                </div>
                <TextField
                  label="Favicon URL"
                  value={draft.faviconUrl}
                  onChange={(v) => set("faviconUrl", v)}
                  placeholder="https://…/favicon.ico"
                />
              </Panel>

              <Panel title="Colours and type">
                <FieldGrid columns={2}>
                  <ColorField
                    label="Primary colour"
                    value={draft.primaryColor}
                    onChange={(v) => set("primaryColor", v)}
                  />
                  <ColorField
                    label="Accent colour"
                    value={draft.accentColor}
                    onChange={(v) => set("accentColor", v)}
                  />
                </FieldGrid>
                <SelectField
                  label="Font family"
                  value={draft.fontFamily || "system"}
                  onChange={(v) => set("fontFamily", v === "system" ? "" : v)}
                  options={FONT_FAMILIES}
                />
                <TextField
                  label="Email from name"
                  value={draft.emailFromName}
                  onChange={(v) => set("emailFromName", v)}
                  placeholder="e.g. Anexa Support"
                  hint="What a customer sees in the From line of anything this workspace sends."
                />
              </Panel>
            </div>

            <div className="xl:sticky xl:top-20 xl:self-start">
              <Panel title="Preview" tone="muted">
                <div className="overflow-hidden rounded-xl border border-border">
                  <div
                    className="flex items-center gap-3 p-4"
                    style={{ backgroundColor: draft.primaryColor }}
                  >
                    {draft.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.logoUrl} alt="logo" className="h-7 object-contain" />
                    ) : (
                      <span className="font-display text-lg font-semibold text-white">
                        {draft.brandName || "Anexa"}
                      </span>
                    )}
                  </div>
                  <div className="space-y-3 bg-card p-4">
                    <div className="text-sm text-foreground/60">
                      {formatter(150000)} • {dateFormatter(new Date())}
                    </div>
                    <button
                      type="button"
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                      style={{ backgroundColor: draft.accentColor }}
                    >
                      Action
                    </button>
                  </div>
                </div>
                <Hint className="mt-2">
                  The money and date follow the localization tab, so a currency picked there shows
                  up here before it is saved.
                </Hint>
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* ── COMPANY ──────────────────────────────────────────────────── */}
        <TabsContent value="company" className="space-y-4">
          <Panel
            title="The legal entity"
            description="How the business identifies itself on customer-facing documents. A proposal prints this name, phone, email and address — and will not generate while any of them is blank. Shared by every workspace: one company, one identity."
          >
            <TextField
              label="Company name"
              value={draft.name}
              onChange={(v) => set("name", v)}
              placeholder="e.g. Acme Roofing"
            />
            <FieldGrid columns={2}>
              <TextField
                label="Phone"
                type="tel"
                value={draft.phone}
                onChange={(v) => set("phone", v)}
                placeholder="(555) 123-4567"
              />
              <TextField
                label="Email"
                type="email"
                value={draft.email}
                onChange={(v) => set("email", v)}
                placeholder="support@example.com"
              />
            </FieldGrid>
            <TextField
              label="Website"
              value={draft.website}
              onChange={(v) => set("website", v)}
              placeholder="anexahomes.com"
            />
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="company-address">
                Address
              </Label>
              <AddressAutocomplete
                value={draft.address}
                onChange={(v) => set("address", v)}
                onSelect={(parts) => {
                  // City/State/ZIP have their own fields below; only overwrite
                  // the ones the suggestion actually carries.
                  setDraft((d) => ({
                    ...d,
                    address: parts.address,
                    ...(parts.city ? { city: parts.city } : {}),
                    ...(parts.state ? { state: parts.state } : {}),
                    ...(parts.zip ? { zip: parts.zip } : {}),
                  }));
                }}
                placeholder="Street address"
              />
            </div>
            <FieldGrid columns={3}>
              <TextField
                label="City"
                value={draft.city}
                onChange={(v) => set("city", v)}
                placeholder="City"
              />
              <TextField
                label="State"
                value={draft.state}
                onChange={(v) => set("state", v)}
                placeholder="State/Province"
              />
              <TextField
                label="ZIP code"
                value={draft.zip}
                onChange={(v) => set("zip", v)}
                placeholder="ZIP/Postal code"
              />
            </FieldGrid>
            <TextField
              label="Timezone"
              value={draft.timezone}
              onChange={(v) => set("timezone", v)}
              placeholder="e.g. America/Chicago"
            />
            {missingIdentity && (
              <Caution>
                A proposal will not generate while the name, phone, email or address is blank — and
                it fails at the moment a rep tries to send one, in front of a customer.
              </Caution>
            )}
          </Panel>
        </TabsContent>

        {/* ── LOCALIZATION ─────────────────────────────────────────────── */}
        <TabsContent value="localization" className="space-y-4">
          <Panel
            title="Numbers and dates"
            description="Company-wide: every workspace formats money and dates the same way."
          >
            <FieldGrid columns={2}>
              <SelectField
                label="Currency"
                value={draft.currencyCode}
                onChange={(v) => set("currencyCode", v)}
                options={CURRENCIES}
              />
              <SelectField
                label="Locale"
                value={draft.locale}
                onChange={(v) => set("locale", v)}
                options={LOCALES}
              />
            </FieldGrid>
            <TextField
              label="Record prefix"
              value={draft.recordPrefix}
              onChange={(v) => set("recordPrefix", v.slice(0, 8))}
              placeholder="e.g. SR"
              hint="Used for new record numbers, e.g. SR-1001. Records already numbered keep the prefix they were given."
            />
          </Panel>

          <Panel title="Where support goes">
            <FieldGrid columns={2}>
              <TextField
                label="Support phone"
                value={draft.supportPhone}
                onChange={(v) => set("supportPhone", v)}
                placeholder="e.g. +1-800-555-0123"
              />
              <TextField
                label="Support email"
                type="email"
                value={draft.supportEmail}
                onChange={(v) => set("supportEmail", v)}
                placeholder="support@example.com"
              />
            </FieldGrid>
          </Panel>

          <Panel title="White label">
            <TextField
              label="Custom domain"
              value={draft.customDomain}
              onChange={(v) => set("customDomain", v)}
              placeholder="e.g. homes.example.com"
              hint="Point a CNAME at your host, then enter it here."
            />
            <ToggleRow
              label="Remove “Powered by Anexa” branding"
              description="Takes the footer credit off the customer-facing pages this workspace serves."
              checked={draft.removePoweredBy}
              onChange={(v) => set("removePoweredBy", v)}
            />
          </Panel>
        </TabsContent>
      </Tabs>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what={workspaceLabel ? `${workspaceLabel} branding` : "branding"}
        onSave={save}
        onDiscard={() => setDraft(saved)}
      />
    </div>
  );
}

/** A colour, as a swatch you can pick from and a hex you can paste into. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} swatch`}
          className="size-9 shrink-0 rounded border border-border"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
