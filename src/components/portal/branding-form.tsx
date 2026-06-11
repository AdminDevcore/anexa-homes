"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBrandingAction } from "@/server/modules/settings/actions";

export function BrandingForm({
  initial,
}: {
  initial: { logoUrl: string; primaryColor: string; accentColor: string };
}) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = React.useState(initial.logoUrl);
  const [primaryColor, setPrimaryColor] = React.useState(initial.primaryColor);
  const [accentColor, setAccentColor] = React.useState(initial.accentColor);
  const [pending, setPending] = React.useState(false);

  async function save() {
    setPending(true);
    const res = await updateBrandingAction({ logoUrl, primaryColor, accentColor });
    setPending(false);
    if (res.ok) {
      toast.success("Branding saved");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="space-y-1.5">
          <Label>Logo URL</Label>
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
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
        <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save branding
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="mb-3 text-sm font-medium text-muted-foreground">Preview</p>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center gap-3 p-4" style={{ backgroundColor: primaryColor }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="logo" className="h-7 object-contain" />
            ) : (
              <span className="font-display text-lg font-semibold text-white">Anexa Homes</span>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
            <button className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: accentColor }}>
              Request Inspection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
