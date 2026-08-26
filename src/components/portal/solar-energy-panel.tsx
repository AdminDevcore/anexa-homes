"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  annualFromMonthlyKwh,
  annualUsageFromBill,
  monthlyBillFromUsage,
} from "@/lib/solar-energy";
import { deriveUtilityRateMills } from "@/lib/solar-money";
import { saveSolarEnergyAction } from "@/server/modules/solar/energy-actions";
import type { ProviderOption } from "@/server/modules/solar/providers";
import { SolarEnergyChart } from "@/components/portal/solar-energy-chart";
import {
  buybackLine,
  hasProviderTerms,
  vppLine,
} from "@/lib/solar-provider-terms";

export type SolarEnergyView = {
  utilityProvider: string | null;
  electricProvider: string | null;
  annualUsageKwh: number | null;
  avgMonthlyBillCents: number | null;
  utilityRateMills: number | null;
  usageBasis: string | null;
} | null;

type Basis = "usage" | "bill" | "rate";

const OTHER = "__other";

/**
 * What the house uses, and what they pay for it.
 *
 * A homeowner rarely knows their annual kWh — it is the number they are least
 * likely to have to hand. They know what they pay a month, and often what they
 * pay per kWh. So there are three ways in, and a switch picks which TWO figures
 * the rep types: the third is calculated and read-only.
 *
 * That read-only third is the point. Three editable boxes let a rep store a
 * usage, a bill and a rate that do not reconcile, with nothing on screen saying
 * which one the proposal actually used.
 *
 * The third way in — usage and rate — exists because the first could only
 * DERIVE the rate, and bill ÷ usage is not the customer's energy rate: it has
 * every fixed charge on the bill folded into it, the delivery fee and the meter
 * charge and the taxes, spread across the kilowatt-hours as though they were
 * energy. That reads high, and it reads high on the one number the entire
 * savings model is built on. A rep holding the bill can read the real rate off
 * it, and now has somewhere to put it without giving up the usage they know.
 */
export function SolarEnergyPanel({
  leadId,
  energy,
  utilities,
  retailers,
  year1ProductionKwh,
  canEdit,
}: {
  leadId: string;
  energy: SolarEnergyView;
  utilities: ProviderOption[];
  retailers: ProviderOption[];
  /** What the array as drawn makes in year one, for the comparison below. */
  year1ProductionKwh: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [basis, setBasis] = React.useState<Basis>(
    energy?.usageBasis === "bill" ? "bill" : energy?.usageBasis === "rate" ? "rate" : "usage"
  );

  const [utility, setUtility] = React.useState(() => seedProvider(utilities, energy?.utilityProvider));
  const [retail, setRetail] = React.useState(() => seedProvider(retailers, energy?.electricProvider));

  const [annualUsage, setAnnualUsage] = React.useState(
    energy?.annualUsageKwh == null ? "" : String(energy.annualUsageKwh)
  );
  const [monthlyUsage, setMonthlyUsage] = React.useState("");
  const [bill, setBill] = React.useState(
    energy?.avgMonthlyBillCents == null ? "" : (energy.avgMonthlyBillCents / 100).toFixed(0)
  );
  const [rate, setRate] = React.useState(
    energy?.utilityRateMills == null ? "" : (energy.utilityRateMills / 1000).toFixed(3)
  );

  const billCents = bill.trim() === "" ? null : Math.round(Number(bill) * 100);
  const rateMills = rate.trim() === "" ? null : Math.round(Number(rate) * 1000);

  // Every figure below comes from the shared library — never a second copy of
  // the arithmetic living in a component.
  const annual =
    basis === "bill"
      ? annualUsageFromBill(billCents, rateMills)
      : (Number(annualUsage) || null) ?? annualFromMonthlyKwh(Number(monthlyUsage) || null);

  // Typed on two of the three bases, worked out on the first.
  const resolvedRate = basis === "usage" ? deriveUtilityRateMills(billCents, annual) : rateMills;
  /** The bill the rate basis calculates, so the rep sees what they just implied. */
  const derivedBillCents = basis === "rate" ? monthlyBillFromUsage(annual, rateMills) : null;

  async function save() {
    setBusy(true);
    const res = await saveSolarEnergyAction({
      leadId,
      utilityProvider: providerValue(utility),
      electricProvider: providerValue(retail),
      basis,
      avgMonthlyBillCents: billCents,
      annualUsageKwh: basis !== "bill" && Number(annualUsage) ? Number(annualUsage) : null,
      avgMonthlyUsageKwh: basis !== "bill" && Number(monthlyUsage) ? Number(monthlyUsage) : null,
      utilityRateMills: basis === "usage" ? null : rateMills,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Energy saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Providers
        </h4>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <ProviderField
            id="utility-provider"
            label="Utility (delivers the power)"
            options={utilities}
            state={utility}
            onChange={setUtility}
            disabled={!canEdit}
          />
          <ProviderField
            id="electric-provider"
            label="Electric provider (bills the customer)"
            options={retailers}
            state={retail}
            onChange={setRetail}
            disabled={!canEdit}
          />
        </div>
        {utilities.length === 0 && retailers.length === 0 && (
          <p className="text-[11px] text-amber-700">
            No providers set up yet — you can still type one.{" "}
            <Link href="/portal/settings/solar-providers" className="underline underline-offset-2">
              Add your lists
            </Link>{" "}
            so every proposal spells them the same way.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Consumption
        </h4>

        <fieldset className="flex flex-wrap gap-4" disabled={!canEdit}>
          <legend className="sr-only">How do you know their usage?</legend>
          {([
            ["usage", "From their usage"],
            ["bill", "From their bill"],
            ["rate", "From their rate"],
          ] as const).map(([id, label]) => (
            <label key={id} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="energy-basis"
                value={id}
                checked={basis === id}
                onChange={() => setBasis(id)}
                className="size-4"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {/* Which two boxes each choice asks for, said out loud. "From their
            rate" does not name the usage it also needs, and a rep should not
            have to click a radio to find out what it wants. */}
        <p className="text-[11px] text-muted-foreground">
          {basis === "usage"
            ? "Type the usage and the bill — the rate is worked out. Note it includes fixed charges, so it reads higher than the energy rate on the bill."
            : basis === "bill"
              ? "Type the bill and the rate — the usage is worked out."
              : "Type the usage and the rate off their bill — the bill is worked out. Use this when you have the real energy rate."}
        </p>

        {basis === "usage" ? (
          <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
            <NumberField
              id="annual-usage"
              label="Annual usage (kWh)"
              value={annualUsage}
              onChange={setAnnualUsage}
              disabled={!canEdit}
            />
            <NumberField
              id="avg-monthly-kwh"
              label="Avg monthly kWh"
              value={monthlyUsage}
              onChange={setMonthlyUsage}
              disabled={!canEdit || Boolean(Number(annualUsage))}
              hint={Number(annualUsage) ? "Using the annual figure" : "× 12"}
            />
            <NumberField
              id="avg-monthly-bill"
              label="Average monthly bill ($)"
              value={bill}
              onChange={setBill}
              disabled={!canEdit}
            />
          </div>
        ) : basis === "bill" ? (
          <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
            <NumberField
              id="avg-monthly-bill"
              label="Average monthly bill ($)"
              value={bill}
              onChange={setBill}
              disabled={!canEdit}
            />
            <NumberField
              id="rate-per-kwh"
              label="Rate ($/kWh)"
              value={rate}
              onChange={setRate}
              step="0.001"
              disabled={!canEdit}
              hint="What the customer pays per kWh"
            />
            <div className="space-y-1">
              <Label className="text-xs">Annual usage (kWh)</Label>
              <div className="flex h-9 items-center rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground">
                {annual ? annual.toLocaleString() : "—"}
                <span className="ml-1.5 text-[11px]">(calculated)</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
            <NumberField
              id="annual-usage"
              label="Annual usage (kWh)"
              value={annualUsage}
              onChange={setAnnualUsage}
              disabled={!canEdit}
            />
            <NumberField
              id="avg-monthly-kwh"
              label="Avg monthly kWh"
              value={monthlyUsage}
              onChange={setMonthlyUsage}
              disabled={!canEdit || Boolean(Number(annualUsage))}
              hint={Number(annualUsage) ? "Using the annual figure" : "× 12"}
            />
            <NumberField
              id="rate-per-kwh"
              label="Rate ($/kWh)"
              value={rate}
              onChange={setRate}
              step="0.001"
              disabled={!canEdit}
              hint="The energy rate off their bill"
            />
            <div className="space-y-1 sm:col-span-3">
              <Label className="text-xs">Average monthly bill ($)</Label>
              <div className="flex h-9 max-w-[13rem] items-center rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground">
                {derivedBillCents ? `$${(derivedBillCents / 100).toFixed(0)}` : "—"}
                <span className="ml-1.5 text-[11px]">(calculated)</span>
              </div>
            </div>
          </div>
        )}

        <div
          data-testid="energy-summary"
          className="max-w-3xl rounded-lg border border-border bg-muted/30 p-3 text-sm"
        >
          <span className="font-display text-lg font-semibold">
            {annual ? `${annual.toLocaleString()} kWh/yr` : "—"}
          </span>
          {resolvedRate ? (
            <span className="ml-2 text-muted-foreground">
              · ${(resolvedRate / 1000).toFixed(3)}/kWh
              {basis === "usage" && <span className="text-[11px]"> (calculated)</span>}
            </span>
          ) : null}
          {!annual && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              Enter consumption to anchor the offset.
            </span>
          )}
        </div>

        {/* The two figures the boxes above are for, next to each other. A rep
            could type 14,000 kWh, draw an array, and not see the pair until
            the proposal was generated. Live from the same numbers the box
            holds, so it moves as they type. */}
        <SolarEnergyChart
          annualUsageKwh={annual}
          year1ProductionKwh={year1ProductionKwh}
          className="max-w-3xl"
        />

        <p className="max-w-3xl text-[11px] text-muted-foreground">
          Annual usage is what the offset on the proposal is measured against. It does not size the
          system: how much this roof can make depends on which way its planes face, their pitch and
          what shades them, so the size is whatever array you draw on the next step.
        </p>
      </section>

      {canEdit && (
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save energy
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type ProviderState = { selected: string; other: string };

/** Preselect a stored name; anything not on the list opens as "Other…". */
function seedProvider(options: ProviderOption[], stored: string | null | undefined): ProviderState {
  if (!stored) return { selected: "", other: "" };
  return options.some((o) => o.name === stored)
    ? { selected: stored, other: "" }
    : { selected: OTHER, other: stored };
}

function providerValue(s: ProviderState): string | null {
  if (s.selected === OTHER) return s.other.trim() || null;
  return s.selected || null;
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function ProviderField({
  id, label, options, state, onChange, disabled,
}: {
  id: string;
  label: string;
  options: ProviderOption[];
  state: ProviderState;
  onChange: (s: ProviderState) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        value={state.selected}
        disabled={disabled}
        onChange={(e) => onChange({ ...state, selected: e.target.value })}
      >
        <option value="">— not set —</option>
        {options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
            {o.active ? "" : " · retired"}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {state.selected === OTHER && (
        <Input
          aria-label={`${label} name`}
          value={state.other}
          disabled={disabled}
          placeholder="Type the provider's name"
          onChange={(e) => onChange({ ...state, other: e.target.value })}
        />
      )}
      <ProviderTermsNote option={options.find((o) => o.name === state.selected) ?? null} />
    </div>
  );
}

/**
 * What the office has confirmed this provider does, read back the moment a rep
 * picks them.
 *
 * This is the question that gets asked across the kitchen table — "do they pay
 * me for what I send back, and is there anything for the battery?" — and until
 * now the answer lived in somebody's head. It is a NOTE, not a quote: none of
 * it reaches the customer's document or its arithmetic, which is why it renders
 * here beside the picker and nowhere near the savings model.
 *
 * A provider with nothing recorded says so. On a panel whose job is to answer
 * this, blank space reads as "no" when it means "nobody has checked", and a rep
 * will quote the first one.
 */
function ProviderTermsNote({ option }: { option: ProviderOption | null }) {
  if (!option) return null;
  const lines = [buybackLine(option), vppLine(option)].filter(Boolean);
  if (lines.length === 0 && !option.notes) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {hasProviderTerms(option)
          ? "No buyback or battery programme."
          : "Buyback and VPP not recorded for this provider."}
      </p>
    );
  }
  return (
    <div className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5">
      {lines.length > 0 && (
        <p className="text-[11px] font-medium text-foreground">{lines.join(" · ")}</p>
      )}
      {option.notes && (
        <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
          {option.notes}
        </p>
      )}
    </div>
  );
}

function NumberField({
  id, label, value, onChange, disabled, step, hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  step?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type="number"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
