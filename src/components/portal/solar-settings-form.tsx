"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Caution,
  FieldGrid,
  Hint,
  MoneyField,
  Panel,
  SaveBar,
  TextAreaField,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import { updateSolarSettingsAction } from "@/server/modules/solar/actions";
import { wholeHomeBackup } from "@/lib/solar-storage";
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
/**
 * The house the worked example below is drawn on.
 *
 * A REFERENCE, not a promise about any deal: a real quote divides the battery
 * the customer is actually buying by the usage on their own Energy step. It is
 * here so a factor typed with the decimal in the wrong place shows up as an
 * absurd runtime before anybody saves it.
 */
const REFERENCE_KWH = 27;
const REFERENCE_USAGE_KWH = 15_000;

/** The stored settings as the boxes on this form. */
function seedFrom(settings: SolarSettingsView) {
  return {
    derateFactor: String(settings.derateFactor),
    annualDegradationPct: String(settings.annualDegradationPct),
    utilityEscalationPct: String(settings.utilityEscalationPct),
    kwhPerKwYear: String(settings.kwhPerKwYear),
    utilityMeterFee: (settings.utilityMeterFeeCents / 100).toFixed(2),
    defaultGrossPpw: (settings.companyDefaultBasePpwCents / 100).toFixed(2),
    defaultDealerFeePct: String(settings.defaultDealerFeePct),
    targetNetPpw:
      settings.targetBasePpwCents == null
        ? ""
        : (settings.targetBasePpwCents / 100).toFixed(2),
    homeValueUpliftPct: String(settings.homeValueUpliftPct),
    defaultBatteryQty: String(settings.defaultBatteryQty),
    backupOutageDrawFactor: String(settings.backupOutageDrawFactor),
    minOffsetPct: String(settings.minOffsetPct),
    maxOffsetPct: String(settings.maxOffsetPct),
    // Only a zero can be "no minimum"; a figure above zero is the decision.
    minOffsetNone: settings.minOffsetConfigured === true && settings.minOffsetPct <= 0,
    creditItcPct: String(settings.creditRates.itcPct),
    creditEnergyCommunityPct: String(settings.creditRates.energyCommunityPct),
    creditDomesticContentPct: String(settings.creditRates.domesticContentPct),
    creditIncentiveLabel: settings.creditIncentiveLabel,
    creditDisclaimer: settings.creditDisclaimer,
  };
}

const SOLAR_TABS = [
  "production",
  "backup",
  "pricing",
  "guardrails",
  "credits",
  "stages",
] as const;
type SolarTab = (typeof SOLAR_TABS)[number];

export function SolarSettingsForm({
  settings,
  stageModel,
  initialTab,
}: {
  settings: SolarSettingsView;
  /** The stage-model editor, rendered as this screen's last tab. */
  stageModel?: React.ReactNode;
  initialTab?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState(() => seedFrom(settings));

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const [tab, setTab] = React.useState<SolarTab>(() =>
    (SOLAR_TABS as readonly string[]).includes(initialTab ?? "")
      ? (initialTab as SolarTab)
      : "production",
  );

  // Re-seeded during render when the server sends something new, so a refresh
  // never flashes the pre-save figures.
  const saved = React.useMemo(() => seedFrom(settings), [settings]);
  const serverKey = JSON.stringify(saved);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setF(saved);
  }
  const dirty = JSON.stringify(f) !== serverKey;

  /** The bounds are a band, so one above the other blocks every proposal. */
  const badOffsetBand = Number(f.minOffsetPct) >= Number(f.maxOffsetPct);
  const noDisclaimer = f.creditDisclaimer.trim() === "";

  /**
   * The factor is a MARGIN over the home's average, so it starts at 1.
   *
   * Below that the company would be quoting fewer watts than the house actually
   * averages — hours on the strength of a household conserving, which is not a
   * claim the customer's document makes. Blocked here rather than caught by the
   * action, so the Save says why instead of failing after the click.
   */
  const factor = Number(f.backupOutageDrawFactor);
  const badFactor = !(factor >= 1) || factor > 3;

  /** What that factor does to the reference home, live under the box. */
  const example = badFactor
    ? null
    : wholeHomeBackup({
        usableKwh: REFERENCE_KWH,
        annualUsageKwh: REFERENCE_USAGE_KWH,
        outageDrawFactor: factor,
      });

  async function save() {
    setBusy(true);
    try {
      const res = await updateSolarSettingsAction({
        derateFactor: Number(f.derateFactor),
        annualDegradationPct: Number(f.annualDegradationPct),
        utilityEscalationPct: Number(f.utilityEscalationPct),
        kwhPerKwYear: Number(f.kwhPerKwYear),
        // Blank is zero, not "leave it alone": a company clearing this box is
        // saying its utility bills no standing charge.
        utilityMeterFeeCents:
          f.utilityMeterFee.trim() === ""
            ? 0
            : Math.round(Number(f.utilityMeterFee) * 100),
        companyDefaultBasePpwCents: Math.round(Number(f.defaultGrossPpw) * 100),
        defaultDealerFeePct: Number(f.defaultDealerFeePct),
        // Blank means "derive nothing" — the sticker stays exactly as a rep types
        // it, which is how every company behaves until somebody sets a target.
        targetBasePpwCents:
          f.targetNetPpw.trim() === ""
            ? null
            : Math.round(Number(f.targetNetPpw) * 100),
        // Blank is zero, and zero means the claim is not made at all — the
        // proposal omits the card rather than printing "0%".
        homeValueUpliftPct:
          f.homeValueUpliftPct.trim() === "" ? 0 : Number(f.homeValueUpliftPct),
        // Blank falls back to one rather than zero: an empty box is a company
        // that has not said, and "a battery, none of them" is not a system.
        defaultBatteryQty:
          f.defaultBatteryQty.trim() === "" ? 1 : Number(f.defaultBatteryQty),
        // Blank falls back to the plain average rather than to zero: an empty
        // box is a company that has not said, and dividing by nothing prints an
        // endless runtime on a customer's document.
        backupOutageDrawFactor:
          f.backupOutageDrawFactor.trim() === ""
            ? 1
            : Number(f.backupOutageDrawFactor),
        minOffsetPct: Number(f.minOffsetPct),
        maxOffsetPct: Number(f.maxOffsetPct),
        minOffsetNone: Number(f.minOffsetPct) <= 0 ? f.minOffsetNone : false,
        // Blank is zero, and zero means the bonus is not claimed at all — the
        // row is dropped from the customer's page rather than printed as "0%".
        creditItcPct: f.creditItcPct.trim() === "" ? 0 : Number(f.creditItcPct),
        creditEnergyCommunityPct:
          f.creditEnergyCommunityPct.trim() === ""
            ? 0
            : Number(f.creditEnergyCommunityPct),
        creditDomesticContentPct:
          f.creditDomesticContentPct.trim() === ""
            ? 0
            : Number(f.creditDomesticContentPct),
        // NEVER sent blank: an empty label is a negative figure on a customer's
        // page with no name against it, and an empty caveat is a page of credit
        // arithmetic with nothing qualifying it. The action rejects both, so the
        // form falls back to what is already stored rather than to a default the
        // company did not choose.
        creditIncentiveLabel:
          f.creditIncentiveLabel.trim() || settings.creditIncentiveLabel,
        creditDisclaimer:
          f.creditDisclaimer.trim() || settings.creditDisclaimer,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Solar settings saved");
      router.refresh();
    } finally {
      // In a `finally`: an action that throws must not leave the whole screen
      // disabled with no way back to it.
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SolarTab)}
        className="gap-4"
      >
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto"
        >
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="backup">
            Backup
            {badFactor && (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                aria-hidden
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="guardrails">
            Guard rails
            {badOffsetBand && (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                aria-hidden
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="credits">
            Credits
            {noDisclaimer && (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                aria-hidden
              />
            )}
          </TabsTrigger>
          {stageModel && <TabsTrigger value="stages">Stage model</TabsTrigger>}
        </TabsList>

        {/* ── PRODUCTION ─────────────────────────────────────────────────── */}
        <TabsContent value="production" className="space-y-4">
          <Panel
            title="Production assumptions"
            description="What every quote's kWh figure is worked out from, before a roof is drawn."
          >
            <FieldGrid columns={2}>
              <TextField
                label="Derate factor"
                type="number"
                value={f.derateFactor}
                onChange={(v) => set("derateFactor", v)}
                hint="0.84 means 16% system losses."
              />
              <TextField
                label="Annual degradation %"
                type="number"
                value={f.annualDegradationPct}
                onChange={(v) => set("annualDegradationPct", v)}
                hint="How much less the array makes each year."
              />
              <TextField
                label="Utility escalation %/yr"
                type="number"
                value={f.utilityEscalationPct}
                onChange={(v) => set("utilityEscalationPct", v)}
                hint="What the customer's bill is assumed to do without solar."
              />
              <TextField
                label="kWh per kW / year"
                type="number"
                value={f.kwhPerKwYear}
                onChange={(v) => set("kwhPerKwYear", v)}
                hint="Local irradiance. Only used where a real per-plane figure cannot be had."
              />
            </FieldGrid>
            <MoneyField
              label="Utility meter fee"
              suffix="/mo"
              value={f.utilityMeterFee}
              onChange={(v) => set("utilityMeterFee", v)}
              why="The utility's fixed monthly charge, billed whatever the roof produces. It is added to the bill the proposal shows AFTER solar, so a full-offset system never quotes $0 a month to a homeowner who will still get a bill."
              hint="Blank is zero — a company clearing this box is saying its utility bills no standing charge."
            />
          </Panel>

          <Panel title="What the proposal claims">
            <TextField
              label="Home value increase %"
              type="number"
              value={f.homeValueUpliftPct}
              onChange={(v) => set("homeValueUpliftPct", v)}
              hint="What you are willing to say an owned system adds to a home's value. The published studies cluster around 4% and disagree by market, so this is yours to stand behind. Leave it at 0 and the proposal makes no such claim."
            />
          </Panel>

          {/* "Batteries per system" MOVED to Settings → Solar Equipment →
              Default equipment, beside the battery it counts. It was the only
              field in an "Equipment defaults" panel on a screen otherwise made
              of assumptions and rates, two clicks from the catalogue it
              describes and with no sign of which battery it was counting. The
              value itself is unchanged and still saved through this action —
              see `settingsSchema.defaultBatteryQty`, which the form keeps
              posting so this screen never blanks it. */}
        </TabsContent>

        {/* ── BACKUP ─────────────────────────────────────────────────────── */}
        <TabsContent value="backup" className="space-y-4">
          <Panel
            title="Whole-home backup"
            description="How long a battery carries the house when the power is out. Worked out from each home's own usage — the proposal never asks anyone to type a runtime, and nobody picks a coverage tier."
          >
            <FieldGrid columns={2}>
              <TextField
                label="Outage draw multiplier"
                type="number"
                value={f.backupOutageDrawFactor}
                onChange={(v) => set("backupOutageDrawFactor", v)}
                why="A home's average draw is its yearly kilowatt-hours spread over 8,760 hours. An outage is not an average moment — the power goes out in a heatwave with the AC running — so the runtime is quoted against that average multiplied by this."
                hint="1× quotes the bare average and promises the most hours. Anything up to 3× is accepted; past that is a typo, not a policy."
              />
            </FieldGrid>

            {example && (
              <Hint className="mt-3">
                {/* One template literal: JSX drops the space after `{expr}`. */}
                {`A home using ${REFERENCE_USAGE_KWH.toLocaleString()} kWh a year averages ` +
                  `${(example.averageLoadWatts / 1000).toFixed(1)} kW, so at ${factor}× it is quoted ` +
                  `${(example.loadWatts / 1000).toFixed(1)} kW while the grid is down — and a ` +
                  `${REFERENCE_KWH} kWh system, two Powerwalls, carries that for about ` +
                  `${example.hours < 10 ? example.hours.toFixed(1) : Math.round(example.hours)} hrs. ` +
                  `A bigger house gets fewer hours off the same battery, which is the point: the ` +
                  `runtime follows the home rather than a wattage typed once for everybody.`}
              </Hint>
            )}

            {badFactor && (
              <Caution>
                Outage draw must be between 1× and 3× the home&rsquo;s average.
                Below 1× the proposal would quote fewer watts than the house
                actually averages, which promises hours on the strength of a
                household conserving — not a claim the document makes.
              </Caution>
            )}
          </Panel>
        </TabsContent>

        {/* ── PRICING ────────────────────────────────────────────────────── */}
        <TabsContent value="pricing" className="space-y-4">
          <Panel title="Pricing defaults">
            <FieldGrid columns={2}>
              <MoneyField
                label="Default gross $/W"
                suffix="/W"
                value={f.defaultGrossPpw}
                onChange={(v) => set("defaultGrossPpw", v)}
              />
              <TextField
                label="Default dealer fee %"
                type="number"
                value={f.defaultDealerFeePct}
                onChange={(v) => set("defaultDealerFeePct", v)}
                hint="Loans only — a cash deal has no lender and therefore no fee. A chosen lender product's own fee wins over this."
              />
            </FieldGrid>
            <MoneyField
              label="Target net $/W"
              suffix="/W"
              value={f.targetNetPpw}
              onChange={(v) => set("targetNetPpw", v)}
              why="What you keep per watt after the lender's cut. Set it and the sticker is derived from the chosen product's dealer fee, so cheaper money raises the price instead of costing margin."
              hint="Blank leaves gross exactly as a rep types it, which is how every company behaves until somebody sets a target."
            />
          </Panel>
        </TabsContent>

        {/* ── GUARD RAILS ────────────────────────────────────────────────── */}
        <TabsContent value="guardrails" className="space-y-4">
          <Panel
            title="Validation bounds"
            description="Guard rails a rep cannot quote outside of. A proposal breaching these cannot be generated at all — this is what stops a five-figure offset reaching a homeowner."
          >
            <FieldGrid columns={2}>
              <TextField
                label="Min offset %"
                type="number"
                value={f.minOffsetPct}
                onChange={(v) => set("minOffsetPct", v)}
              />
              <TextField
                label="Max offset %"
                type="number"
                value={f.maxOffsetPct}
                onChange={(v) => set("maxOffsetPct", v)}
              />
            </FieldGrid>
            {badOffsetBand && (
              <Caution>
                The minimum is at or above the maximum, so no offset can satisfy
                both and every proposal on this workspace would be blocked from
                generating.
              </Caution>
            )}
            {/* Zero is either a decision or nobody having looked, and only the
                admin can say which. Undecided is warned on every deal but never
                blocks; a minimum above zero blocks generation below it. */}
            {Number(f.minOffsetPct) <= 0 && (
              <>
                <ToggleRow
                  label="No minimum offset"
                  description="Confirms this workspace deliberately allows a system of any size. Leave it off and set a minimum above to stop undersized systems being quoted."
                  checked={f.minOffsetNone}
                  onChange={(v) => setF((p) => ({ ...p, minOffsetNone: v }))}
                />
                {!f.minOffsetNone && (
                  <Caution>
                    No minimum offset has been set up. Proposals still generate,
                    but every deal carries a warning that an undersized system
                    cannot be caught. Set a minimum, or confirm there is none.
                  </Caution>
                )}
              </>
            )}
            {/* THE MIN/MAX $/W BAND USED TO BE THE OTHER HALF OF THIS ROW.
                Removed 2026-09-02. What a deal may price at is a property of
                the LOAN PRODUCT, not of the whole app: one universal band was
                asked about three different numbers as pricing grew caps, flat
                partners and adders, and each time it silently blocked real
                deals — an Amos job over about $4,700 of extra work could not be
                generated at all, with no box a rep could change. The floor now
                lives per partner, on Settings → Lenders → Pricing, beside the
                ceiling it has to clear. */}
            <Hint>
              A price-per-watt floor is set per financing partner, next to that
              partner&rsquo;s own ceiling, on{" "}
              <Link
                href="/portal/settings/solar-lenders"
                className="underline underline-offset-2"
              >
                Lenders
              </Link>
              . There is no company-wide $/W band.
            </Hint>
          </Panel>
        </TabsContent>

        {/* ── CREDITS ────────────────────────────────────────────────────── */}
        <TabsContent value="credits" className="space-y-4">
          <Panel
            title="Federal credits"
            tone="accent"
            description="Read on ONE structure: a lender carrying a contract adjustment, where the paper is written above the price and the credits are earned on the larger figure. Every other deal quotes no credit at all. A rep decides per job which of the two bonuses that address and that equipment actually earn — these are the percentages they earn."
          >
            <FieldGrid columns={3}>
              <TextField
                label="Federal solar tax credit %"
                type="number"
                value={f.creditItcPct}
                onChange={(v) => set("creditItcPct", v)}
                hint="The base residential credit."
              />
              <TextField
                label="Energy community bonus %"
                type="number"
                value={f.creditEnergyCommunityPct}
                onChange={(v) => set("creditEnergyCommunityPct", v)}
                hint="Qualifying census tracts only."
              />
              <TextField
                label="Domestic content bonus %"
                type="number"
                value={f.creditDomesticContentPct}
                onChange={(v) => set("creditDomesticContentPct", v)}
                hint="Depends on module and inverter sourcing."
              />
            </FieldGrid>
          </Panel>

          <Panel title="What the customer reads">
            <TextField
              label="What the leftover is called"
              value={f.creditIncentiveLabel}
              onChange={(v) => set("creditIncentiveLabel", v)}
              id="credit-incentive-label"
              hint="After the credits come off the contract there is usually money still standing between that figure and the price the system was sold at. It is handed back under this name, and the AMOUNT is always the difference — nobody types it, on any deal."
            />
            <TextAreaField
              label="Tax caveat printed under the credits"
              rows={3}
              value={f.creditDisclaimer}
              onChange={(v) => set("creditDisclaimer", v)}
              id="credit-disclaimer"
              hint="A credit is claimed on the customer's own return and depends on their liability. This sentence is what says so."
            />
            {noDisclaimer && (
              <Caution>
                The caveat cannot be blank — a page of credit arithmetic with
                nothing qualifying it is a promise about somebody&rsquo;s tax
                return. Saving keeps the stored wording rather than clearing it.
              </Caution>
            )}
          </Panel>
        </TabsContent>

        {/* ── STAGE MODEL ────────────────────────────────────────────────── */}
        {stageModel && (
          <TabsContent value="stages" className="space-y-4">
            {stageModel}
          </TabsContent>
        )}
      </Tabs>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what="solar settings"
        onSave={save}
        onDiscard={() => setF(saved)}
        disabled={badFactor}
        blockedReason={
          badFactor
            ? "Outage draw must be between 1× and 3× the home's average."
            : undefined
        }
      />
    </div>
  );
}
