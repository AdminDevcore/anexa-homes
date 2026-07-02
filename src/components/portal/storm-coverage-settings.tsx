"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStormCoverageAction } from "@/server/modules/storm/actions";

export function StormCoverageSettings({
  initial,
}: {
  initial: { centerLat: number | null; centerLng: number | null; radiusMiles: number; isDefault: boolean };
}) {
  const router = useRouter();
  const [address, setAddress] = React.useState("");
  const [radius, setRadius] = React.useState(String(initial.radiusMiles));
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const r = Math.round(Number(radius) || 0);
    if (r < 5 || r > 300) return toast.error("Radius must be between 5 and 300 miles.");
    if (!address.trim()) return toast.error("Enter a center address, city, or ZIP.");
    setBusy(true);
    const res = await setStormCoverageAction({ address: address.trim(), radiusMiles: r });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Coverage set: ${r} mi around ${res.resolvedAddress ?? "the location"}`);
    setAddress("");
    router.refresh();
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current coverage</div>
        <div className="mt-1 text-sm">
          {initial.isDefault ? (
            <span>Default — <b>Dallas, TX</b> @ <b>100 mi</b> (not customized yet)</span>
          ) : (
            <span>
              Center <b>{initial.centerLat?.toFixed(4)}, {initial.centerLng?.toFixed(4)}</b> · radius <b>{initial.radiusMiles} mi</b>
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Storm reports are only imported and shown within this circle. Set it to the metro you canvass.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="storm-center">Center (address, city, or ZIP)</Label>
          <Input id="storm-center" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Plano, TX  or  75075" />
          <p className="text-xs text-muted-foreground">We geocode this to set the center point.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="storm-radius">Radius (miles)</Label>
          <Input id="storm-radius" type="number" inputMode="numeric" min={5} max={300} value={radius} onChange={(e) => setRadius(e.target.value)} className="w-32" />
          <p className="text-xs text-muted-foreground">5–300 mi. Larger = more data + more import time. 100 is a good metro default.</p>
        </div>
        <Button onClick={save} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save coverage
        </Button>
        <p className="text-xs text-muted-foreground">
          New reports flow in on the next daily import; existing reports outside the new circle stay until they age out.
        </p>
      </div>
    </div>
  );
}
