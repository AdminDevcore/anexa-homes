"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Hint, Panel, StatRow, TextField } from "@/components/portal/settings-kit";
import { setStormCoverageAction } from "@/server/modules/storm/actions";
import { AddressAutocomplete } from "@/components/portal/address-autocomplete";

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <Panel
        title="Where storm reports are pulled from"
        description="Reports are only imported and shown inside this circle. Set it to the metro you canvass."
      >
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="storm-center">
            Centre (address, city, or ZIP)
          </Label>
          {/* "broad" because this field's label offers a city or a ZIP, and the
              default house-only restriction would suggest nothing for either. */}
          <AddressAutocomplete
            id="storm-center"
            mode="single"
            scope="broad"
            value={address}
            onChange={setAddress}
            onSelect={(parts) => setAddress(parts.formatted)}
            placeholder="e.g. Plano, TX  or  75075"
          />
          <Hint>Geocoded to set the centre point.</Hint>
        </div>

        <TextField
          label="Radius (miles)"
          type="number"
          value={radius}
          onChange={setRadius}
          hint="5–300 miles. Larger means more data and a longer import; 100 is a good metro default."
        />

        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          coverage
        </Button>

        <Hint>
          New reports flow in on the next daily import. Reports already inside the old circle stay
          until they age out.
        </Hint>
      </Panel>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Panel title="Current coverage" tone="muted">
          <dl>
            {initial.isDefault ? (
              <>
                <StatRow label="Centre" value="Dallas, TX" tone="warn" />
                <StatRow label="Radius" value="100 mi" />
                <StatRow label="Set by" value="nobody yet" tone="warn" />
              </>
            ) : (
              <>
                <StatRow
                  label="Centre"
                  value={`${initial.centerLat?.toFixed(4)}, ${initial.centerLng?.toFixed(4)}`}
                />
                <StatRow label="Radius" value={`${initial.radiusMiles} mi`} />
              </>
            )}
          </dl>
          {initial.isDefault && (
            <Hint className="mt-2">
              Still the shipped default. Every storm report this workspace has is one that happened
              to fall within 100 miles of Dallas.
            </Hint>
          )}
        </Panel>
      </div>
    </div>
  );
}
