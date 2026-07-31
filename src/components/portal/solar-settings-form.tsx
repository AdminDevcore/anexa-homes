"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSolarSettingsAction } from "@/server/modules/solar/actions";
import type { SolarSettingsView } from "@/server/modules/solar/settings";

/**
 * Solar assumptions. Everything a quote is built from lives here rather than in
 * code, so the numbers can move without a deploy.
 *
 * The federal credit is the reason this page exists: the residential-solar
 * rules changed in 2025 and are still moving, so it is deliberately UNSET by
 * default and owned by the company's CPA. Leaving it blank shows no credit at
 * all, which is the safe state — better to show nothing than a stale rate.
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
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
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
    federalItcPct: settings.federalItcPct == null ? "" : String(settings.federalItcPct),
    stateIncentiveNote: settings.stateIncentiveNote ?? "",
    incentiveDisclaimer: settings.incentiveDisclaimer,
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
      // Blank means "no federal credit", not "zero percent" — the distinction
      // matters, because a configured 0% would still render a $0 credit line.
      federalItcPct: f.federalItcPct.trim() === "" ? null : Number(f.federalItcPct),
      stateIncentiveNote: f.stateIncentiveNote.trim() || null,
      incentiveDisclaimer: f.incentiveDisclaimer,
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
        <h3 className="font-semibold">Pricing defaults</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label="Default gross $/W" value={f.defaultGrossPpw} onChange={(v) => set("defaultGrossPpw", v)} step="0.01" />
          <NumField label="Default dealer fee %" value={f.defaultDealerFeePct} onChange={(v) => set("defaultDealerFeePct", v)}
            step="0.1"
            hint="Loans only — a cash deal has no lender and therefore no fee." />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-5">
        <h3 className="font-semibold">Incentives</h3>
        <p className="flex items-start gap-1.5 text-xs text-amber-900">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          The federal residential-solar credit changed in 2025 and the rules are still moving. This
          percentage is <strong>not</strong> set anywhere in code — confirm the current federal and
          state position with your CPA and enter it here. Leave it blank to show no credit at all.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Federal credit %</Label>
            <Input
              type="number"
              step="0.1"
              placeholder="blank = do not show a credit"
              value={f.federalItcPct}
              onChange={(e) => set("federalItcPct", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">State / local incentive note</Label>
            <Input value={f.stateIncentiveNote} onChange={(e) => set("stateIncentiveNote", e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Disclaimer shown wherever an incentive appears</Label>
          <Textarea
            rows={3}
            value={f.incentiveDisclaimer}
            onChange={(e) => set("incentiveDisclaimer", e.target.value)}
          />
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
