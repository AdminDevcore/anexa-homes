"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { makeMoney, makeDate } from "@/lib/format-core";
import { updateBrandingAction, uploadBrandingLogoAction } from "@/server/modules/settings/actions";

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

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN"];

const LOCALES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
];

export function BrandingForm({
  initial,
  workspaceLabel,
  isOverride,
}: {
  initial: {
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
  /** Which brand is being edited — Anexa Homes (Roofing) vs Prime Solar. */
  workspaceLabel?: string;
  /** True when edits land on this vertical's overrides rather than the company row. */
  isOverride?: boolean;
}) {
  const router = useRouter();
  const [brandName, setBrandName] = React.useState(initial.brandName);
  const [logoUrl, setLogoUrl] = React.useState(initial.logoUrl);
  const [faviconUrl, setFaviconUrl] = React.useState(initial.faviconUrl);
  const [primaryColor, setPrimaryColor] = React.useState(initial.primaryColor);
  const [accentColor, setAccentColor] = React.useState(initial.accentColor);
  const [fontFamily, setFontFamily] = React.useState(initial.fontFamily);
  const [emailFromName, setEmailFromName] = React.useState(initial.emailFromName);
  const [recordPrefix, setRecordPrefix] = React.useState(initial.recordPrefix);
  const [supportPhone, setSupportPhone] = React.useState(initial.supportPhone);
  const [supportEmail, setSupportEmail] = React.useState(initial.supportEmail);
  const [currencyCode, setCurrencyCode] = React.useState(initial.currencyCode);
  const [locale, setLocale] = React.useState(initial.locale);
  const [customDomain, setCustomDomain] = React.useState(initial.customDomain);
  const [removePoweredBy, setRemovePoweredBy] = React.useState(initial.removePoweredBy);
  const [pending, setPending] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const logoInputRef = React.useRef<HTMLInputElement>(null);

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadBrandingLogoAction(fd);
    setUploading(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
    if (res.ok) {
      setLogoUrl(res.logoUrl);
      toast.success("Logo uploaded");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function save() {
    setPending(true);
    const res = await updateBrandingAction({
      brandName,
      logoUrl,
      faviconUrl,
      primaryColor,
      accentColor,
      fontFamily: fontFamily || "",
      emailFromName,
      recordPrefix,
      supportPhone,
      supportEmail,
      currencyCode,
      locale,
      customDomain,
      removePoweredBy,
    });
    setPending(false);
    if (res.ok) {
      toast.success("Branding saved");
      router.refresh();
    } else toast.error(res.error);
  }

  const formatter = makeMoney({ currency: currencyCode, locale });
  const dateFormatter = makeDate({ locale });

  return (
    <div className="space-y-6">
      {/* Branding Card */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="font-medium">Branding{workspaceLabel ? ` — ${workspaceLabel}` : ""}</h3>

        {isOverride ? (
          // Says out loud that blanks inherit rather than clear, so nobody
          // fills the whole form in defensively to avoid an empty brand.
          <p className="text-sm text-muted-foreground">
            These values apply to the <strong>{workspaceLabel}</strong> workspace only. Anything you
            leave blank falls back to the company brand, so a partly-filled brand never renders
            empty. Currency and locale are company-wide and shared with every workspace.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label>Brand name</Label>
          <Input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder={isOverride ? "e.g. Prime Solar — blank inherits the company name" : "Company name"}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Logo</Label>
          <div className="flex items-center gap-2">
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
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
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Upload a PNG, JPG, or WebP — or paste a hosted image URL. Updates the sidebar logo on save.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Favicon URL</Label>
          <Input value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="https://…/favicon.ico" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Primary color</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="size-9 rounded border border-border" />
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Accent color</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="size-9 rounded border border-border" />
              <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Font Family</Label>
          <Select value={fontFamily || "system"} onValueChange={(v) => setFontFamily(v === "system" ? "" : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Email From Name</Label>
          <Input value={emailFromName} onChange={(e) => setEmailFromName(e.target.value)} placeholder="e.g., Anexa Support" />
        </div>

        <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90 w-full">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save branding
        </Button>

        {/* Preview */}
        <div className="mt-6 border-t pt-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">Preview</p>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center gap-3 p-4" style={{ backgroundColor: primaryColor }}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="logo" className="h-7 object-contain" />
              ) : (
                <span className="font-display text-lg font-semibold text-white">Anexa</span>
              )}
            </div>
            <div className="space-y-3 p-4">
              <div className="text-sm text-foreground/60">{formatter(150000)} • {dateFormatter(new Date())}</div>
              <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: accentColor }}>
                Action
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Localization & Support Card */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="font-medium">Localization & Support</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Currency Code</Label>
            <Select value={currencyCode} onValueChange={setCurrencyCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Locale</Label>
            <Select value={locale} onValueChange={setLocale}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Record Prefix</Label>
          <Input
            value={recordPrefix}
            onChange={(e) => setRecordPrefix(e.target.value.slice(0, 8))}
            placeholder="e.g., SR"
            maxLength={8}
          />
          <p className="text-xs text-muted-foreground">Used for new record numbers, e.g. SR-1001</p>
        </div>

        <div className="space-y-1.5">
          <Label>Support Phone</Label>
          <Input value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="e.g., +1-800-555-0123" />
        </div>

        <div className="space-y-1.5">
          <Label>Support Email</Label>
          <Input value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@example.com" type="email" />
        </div>

        <div className="space-y-1.5">
          <Label>Custom Domain</Label>
          <Input
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="e.g., homes.example.com"
          />
          <p className="text-xs text-muted-foreground">Point a CNAME at your host, then enter it here</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
          <Label className="font-normal cursor-pointer">Remove &quot;Powered by Anexa&quot; branding</Label>
          <Switch checked={removePoweredBy} onCheckedChange={setRemovePoweredBy} />
        </div>

        <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90 w-full">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save localization
        </Button>
      </div>
    </div>
  );
}
