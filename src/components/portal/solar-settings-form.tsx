"use client";

import * as React from "react";
import Link from "next/link";
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
 * The federal credits at the bottom are the ONE exception to "no incentive is
 * quoted anywhere". They are read on a single structure — a lender carrying a
 * contract adjustment — and on every other deal the product still asks for no
 * credit and prints none. Saving this form still clears the legacy incentive
 * columns, which nothing reads.
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
    utilityMeterFee: (settings.utilityMeterFeeCents / 100).toFixed(2),
    defaultGrossPpw: (settings.defaultGrossPpwCents / 100).toFixed(2),
    defaultDealerFeePct: String(settings.defaultDealerFeePct),
    targetNetPpw: settings.targetNetPpwCents == null ? "" : (settings.targetNetPpwCents / 100).toFixed(2),
    homeValueUpliftPct: String(settings.homeValueUpliftPct),
    defaultBatteryQty: String(settings.defaultBatteryQty),
    minOffsetPct: String(settings.minOffsetPct),
    maxOffsetPct: String(settings.maxOffsetPct),
    creditItcPct: String(settings.creditRates.itcPct),
    creditEnergyCommunityPct: String(settings.creditRates.energyCommunityPct),
    creditDomesticContentPct: String(settings.creditRates.domesticContentPct),
    creditIncentiveLabel: settings.creditIncentiveLabel,
    creditDisclaimer: settings.creditDisclaimer,
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await updateSolarSettingsAction({
      derateFactor: Number(f.derateFactor),
      annualDegradationPct: Number(f.annualDegradationPct),
      utilityEscalationPct: Number(f.utilityEscalationPct),
      kwhPerKwYear: Number(f.kwhPerKwYear),
      // Blank is zero, not "leave it alone": a company clearing this box is
      // saying its utility bills no standing charge.
      utilityMeterFeeCents:
        f.utilityMeterFee.trim() === "" ? 0 : Math.round(Number(f.utilityMeterFee) * 100),
      defaultGrossPpwCents: Math.round(Number(f.defaultGrossPpw) * 100),
      defaultDealerFeePct: Number(f.defaultDealerFeePct),
      // Blank means "derive nothing" — the sticker stays exactly as a rep types
      // it, which is how every company behaves until somebody sets a target.
      targetNetPpwCents:
        f.targetNetPpw.trim() === "" ? null : Math.round(Number(f.targetNetPpw) * 100),
      // Blank is zero, and zero means the claim is not made at all — the
      // proposal omits the card rather than printing "0%".
      homeValueUpliftPct: f.homeValueUpliftPct.trim() === "" ? 0 : Number(f.homeValueUpliftPct),
      // Blank falls back to one rather than zero: an empty box is a company
      // that has not said, and "a battery, none of them" is not a system.
      defaultBatteryQty: f.defaultBatteryQty.trim() === "" ? 1 : Number(f.defaultBatteryQty),
      minOffsetPct: Number(f.minOffsetPct),
      maxOffsetPct: Number(f.maxOffsetPct),
      // Blank is zero, and zero means the bonus is not claimed at all — the
      // row is dropped from the customer's page rather than printed as "0%".
      creditItcPct: f.creditItcPct.trim() === "" ? 0 : Number(f.creditItcPct),
      creditEnergyCommunityPct:
        f.creditEnergyCommunityPct.trim() === "" ? 0 : Number(f.creditEnergyCommunityPct),
      creditDomesticContentPct:
        f.creditDomesticContentPct.trim() === "" ? 0 : Number(f.creditDomesticContentPct),
      // NEVER sent blank: an empty label is a negative figure on a customer's
      // page with no name against it, and an empty caveat is a page of credit
      // arithmetic with nothing qualifying it. The action rejects both, so the
      // form falls back to what is already stored rather than to a default the
      // company did not choose.
      creditIncentiveLabel: f.creditIncentiveLabel.trim() || settings.creditIncentiveLabel,
      creditDisclaimer: f.creditDisclaimer.trim() || settings.creditDisclaimer,
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
          <NumField
            label="Utility meter fee $/mo"
            value={f.utilityMeterFee}
            onChange={(v) => set("utilityMeterFee", v)}
            step="0.01"
            hint="The utility's fixed monthly charge, billed whatever the roof produces. Added to the bill the proposal shows AFTER solar, so a full-offset system never quotes $0 a month to a homeowner who will still get a bill."
          />
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
        <h3 className="font-semibold">Equipment defaults</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField
            label="Batteries per system"
            value={f.defaultBatteryQty}
            onChange={(v) => set("defaultBatteryQty", v)}
            step="1"
            hint="How many batteries a design starts with the moment a rep picks one, on the roof designer. Your standard offer — a rep can still change it on any deal, and changing this never touches a deal that already has a battery on it."
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
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label="Min offset %" value={f.minOffsetPct} onChange={(v) => set("minOffsetPct", v)} />
          <NumField label="Max offset %" value={f.maxOffsetPct} onChange={(v) => set("maxOffsetPct", v)} />
        </div>
        {/* THE MIN/MAX $/W BAND USED TO BE THE OTHER HALF OF THIS ROW.
            Removed 2026-09-02. What a deal may price at is a property of the
            LOAN PRODUCT, not of the whole app: one universal band was asked
            about three different numbers as pricing grew caps, flat partners
            and adders, and each time it silently blocked real deals — an Amos
            job over about $4,700 of extra work could not be generated at all,
            with no box a rep could change. The floor now lives per partner, on
            Settings → Lenders → Pricing, beside the ceiling it has to clear. */}
        <p className="text-xs text-muted-foreground">
          A price-per-watt floor is set per financing partner, next to that partner&rsquo;s own
          ceiling, on{" "}
          <Link href="/portal/settings/solar-lenders" className="underline underline-offset-2">
            Lenders
          </Link>
          . There is no company-wide $/W band.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Federal credits</h3>
        <p className="text-xs text-muted-foreground">
          Read on ONE structure: a lender carrying a contract adjustment, where the paper is
          written above the price and the credits are earned on the larger figure. Every other deal
          quotes no credit at all. A rep decides per job which of the two bonuses that address and
          that equipment actually earn — these are the percentages they earn.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumField
            label="Federal solar tax credit %"
            value={f.creditItcPct}
            onChange={(v) => set("creditItcPct", v)}
            step="0.5"
            hint="The base residential credit."
          />
          <NumField
            label="Energy community bonus %"
            value={f.creditEnergyCommunityPct}
            onChange={(v) => set("creditEnergyCommunityPct", v)}
            step="0.5"
            hint="Qualifying census tracts only."
          />
          <NumField
            label="Domestic content bonus %"
            value={f.creditDomesticContentPct}
            onChange={(v) => set("creditDomesticContentPct", v)}
            step="0.5"
            hint="Depends on module and inverter sourcing."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="credit-incentive-label" className="text-xs">
            What the leftover is called
          </Label>
          <Input
            id="credit-incentive-label"
            value={f.creditIncentiveLabel}
            onChange={(e) => set("creditIncentiveLabel", e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            After the credits come off the contract there is usually money still standing between
            that figure and the price the system was sold at. It is handed back under this name,
            and the AMOUNT is always the difference — nobody types it, on any deal.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="credit-disclaimer" className="text-xs">
            Tax caveat printed under the credits
          </Label>
          <textarea
            id="credit-disclaimer"
            rows={3}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={f.creditDisclaimer}
            onChange={(e) => set("creditDisclaimer", e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            A credit is claimed on the customer&rsquo;s own return and depends on their liability.
            This sentence is what says so. It cannot be left blank.
          </p>
        </div>
      </section>

      <Button onClick={save} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Save solar settings
      </Button>
    </div>
  );
}
