"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCompanyIdentityAction } from "@/server/modules/settings/actions";
import { AddressAutocomplete } from "@/components/portal/address-autocomplete";

export function CompanyIdentityForm({
  initial,
}: {
  initial: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    timezone: string;
  };
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [address, setAddress] = React.useState(initial.address);
  const [city, setCity] = React.useState(initial.city);
  const [state, setState] = React.useState(initial.state);
  const [zip, setZip] = React.useState(initial.zip);
  const [timezone, setTimezone] = React.useState(initial.timezone);
  const [pending, setPending] = React.useState(false);

  async function save() {
    setPending(true);
    const res = await updateCompanyIdentityAction({
      name,
      address,
      city,
      state,
      zip,
      timezone,
    });
    setPending(false);
    if (res.ok) {
      toast.success("Company information saved");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <h3 className="font-medium">Company Information</h3>

      <div className="space-y-1.5">
        <Label>Company Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Acme Roofing"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Address</Label>
        <AddressAutocomplete
          value={address}
          onChange={setAddress}
          onSelect={(parts) => {
            setAddress(parts.address);
            // City/State/ZIP have their own fields below; only overwrite the
            // ones the suggestion actually carries.
            if (parts.city) setCity(parts.city);
            if (parts.state) setState(parts.state);
            if (parts.zip) setZip(parts.zip);
          }}
          placeholder="Street address"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>City</Label>
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
          />
        </div>
        <div className="space-y-1.5">
          <Label>State</Label>
          <Input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="State/Province"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>ZIP Code</Label>
        <Input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="ZIP/Postal code"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Timezone</Label>
        <Input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="e.g., America/Chicago"
        />
      </div>

      <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90 w-full">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save company info
      </Button>
    </div>
  );
}
