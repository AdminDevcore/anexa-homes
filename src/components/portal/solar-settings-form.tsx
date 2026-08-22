"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSolarSettingsAction } from "@/server/modules/solar/actions";
import type { SolarSettingsView } from "@/server/modules/solar/settings";

/**
 * Solar assumptions. Everything a quote is built from lives here rather than in
 * code, so the numbers can move without a deploy.
 *
 * There is no incentive configuration here on purpose: this company quotes no
 * federal, state or local credit, so nothing in the product asks for one and
 * nothing prints one. Saving this form clears any legacy value still on the row.
 */
/** Module scope on purpose — react-hooks/static-components is an error here. */
function NumField({
  label, value, onChange, step, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SolarSettingsForm({ settings }: { settings: SolarSettingsView }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({
    derateFactor: String(settings.derateFactor),
    annualDegradationPct: String(settings.annualDegradationPct),
    utilityEscalationPct: String(settings.utilityEscalationPct),
    kwhPerKwYear: String(settings.kwhPerKwYear),
    defaultGrossPpw: (settings.defaultGrossPpwCents / 100).toFixed(2),
    defaultDealerFeePct: String(settings.defaultDealerFeePct),
    targetNetPpw: settings.targetNetPpwCents == null ? "" : (settings.targetNetPpwCents / 100).toFixed(2),
    homeValueUpliftPct: String(settings.homeValueUpliftPct),
    minOffsetPct: String(settings.minOffsetPct),
    maxOffsetPct: String(settings.maxOffsetPct),
    minPpw: (settings.minPpwCents / 100).toFixed(2),
    maxPpw: (settings.maxPpwCents / 100).toFixed(2),
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await updateSolarSettingsAction({
      derateFactor: Number(f.derateFactor),
      annualDegradationPct: Number(f.annualDegradationPct),
      utilityEscalationPct: Number(f.utilityEscalationPct),
      kwhPerKwYear: Number(f.kwhPerKwYear),
      defaultGrossPpwCents: Math.round(Number(f.defaultGrossPpw) * 100),
      defaultDealerFeePct: Number(f.defaultDealerFeePct),
      // Blank means "derive nothing" — the sticker stays exactly as a rep types
      // it, which is how every company behaves until somebody sets a target.
      targetNetPpwCents:
        f.targetNetPpw.trim() === "" ? null : Math.round(Number(f.targetNetPpw) * 100),
      // Blank is zero, and zero means the claim is not made at all — the
      // proposal omits the card rather than printing "0%".
      homeValueUpliftPct: f.homeValueUpliftPct.trim() === "" ? 0 : Number(f.homeValueUpliftPct),
      minOffsetPct: Number(f.minOffsetPct),
      maxOffsetPct: Number(f.maxOffsetPct),
      minPpwCents: Math.round(Number(f.minPpw) * 100),
      maxPpwCents: Math.round(Number(f.maxPpw) * 100),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Solar settings saved");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Production assumptions</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Derate factor" value={f.derateFactor} onChange={(v) => set("derateFactor", v)} step="0.01" hint="0.84 = 16% system losses" />
          <NumField label="Annual degradation %" value={f.annualDegradationPct} onChange={(v) => set("annualDegradationPct", v)} step="0.1" />
          <NumField label="Utility escalation %/yr" value={f.utilityEscalationPct} onChange={(v) => set("utilityEscalationPct", v)} step="0.1" />
          <NumField label="kWh per kW / year" value={f.kwhPerKwYear} onChange={(v) => set("kwhPerKwYear", v)} hint="Local irradiance" />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">What the proposal claims</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField
            label="Home value increase %"
            value={f.homeValueUpliftPct}
            onChange={(v) => set("homeValueUpliftPct", v)}
            step="0.1"
            hint="What you are willing to say an owned system adds to a home's value. The published studies cluster around 4% and disagree by market, so this is yours to stand behind. Leave it at 0 and the proposal makes no such claim."
          />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Pricing defaults</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label="Default gross $/W" value={f.defaultGrossPpw} onChange={(v) => set("defaultGrossPpw", v)} step="0.01" />
          <NumField label="Default dealer fee %" value={f.defaultDealerFeePct} onChange={(v) => set("defaultDealerFeePct", v)}
            step="0.1"
            hint="Loans only — a cash deal has no lender and therefore no fee. A chosen lender product's own fee wins over this." />
          <NumField label="Target net $/W" value={f.targetNetPpw} onChange={(v) => set("targetNetPpw", v)}
            step="0.01"
            hint="What you keep per watt after the lender's cut. Set it and the sticker is derived from the chosen product's dealer fee, so cheaper money raises the price instead of costing margin. Blank leaves gross exactly as typed." />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Validation bounds</h3>
        <p className="text-xs text-muted-foreground">
          Guard rails a rep cannot quote outside of. A proposal breaching these cannot be generated
          at all — this is what stops a five-figure offset reaching a homeowner.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Min offset %" value={f.minOffsetPct} onChange={(v) => set("minOffsetPct", v)} />
          <NumField label="Max offset %" value={f.maxOffsetPct} onChange={(v) => set("maxOffsetPct", v)} />
          <NumField label="Min $/W" value={f.minPpw} onChange={(v) => set("minPpw", v)} step="0.01" />
          <NumField label="Max $/W" value={f.maxPpw} onChange={(v) => set("maxPpw", v)} step="0.01" />
        </div>
      </section>

      <Button onClick={save} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Save solar settings
      </Button>
    </div>
  );
}
