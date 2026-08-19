"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { annualFromMonthlyKwh, annualUsageFromBill } from "@/lib/solar-energy";
import { deriveUtilityRateMills } from "@/lib/solar-money";
import { saveSolarEnergyAction } from "@/server/modules/solar/energy-actions";
import type { ProviderOption } from "@/server/modules/solar/providers";

export type SolarEnergyView = {
  utilityProvider: string | null;
  electricProvider: string | null;
  annualUsageKwh: number | null;
  avgMonthlyBillCents: number | null;
  utilityRateMills: number | null;
  usageBasis: string | null;
} | null;

type Basis = "usage" | "bill";

const OTHER = "__other";

/**
 * What the house uses, and what they pay for it.
 *
 * A homeowner rarely knows their annual kWh — it is the number they are least
 * likely to have to hand. They know what they pay a month, and often what they
 * pay per kWh. So there are two ways in, and a switch picks which two figures
 * the rep types: the third is calculated and read-only.
 *
 * That read-only third is the point. Three editable boxes let a rep store a
 * usage, a bill and a rate that do not reconcile, with nothing on screen saying
 * which one the proposal actually used.
 */
export function SolarEnergyPanel({
  leadId,
  energy,
  utilities,
  retailers,
  canEdit,
}: {
  leadId: string;
  energy: SolarEnergyView;
  utilities: ProviderOption[];
  retailers: ProviderOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [basis, setBasis] = React.useState<Basis>(energy?.usageBasis === "bill" ? "bill" : "usage");

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

  const resolvedRate = basis === "bill" ? rateMills : deriveUtilityRateMills(billCents, annual);

  async function save() {
    setBusy(true);
    const res = await saveSolarEnergyAction({
      leadId,
      utilityProvider: providerValue(utility),
      electricProvider: providerValue(retail),
      basis,
      avgMonthlyBillCents: billCents,
      annualUsageKwh: basis === "usage" && Number(annualUsage) ? Number(annualUsage) : null,
      avgMonthlyUsageKwh: basis === "usage" && Number(monthlyUsage) ? Number(monthlyUsage) : null,
      utilityRateMills: basis === "bill" ? rateMills : null,
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
        <div className="grid gap-3 sm:grid-cols-2">
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

        {basis === "usage" ? (
          <div className="grid gap-3 sm:grid-cols-3">
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
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
        )}

        <div
          data-testid="energy-summary"
          className="rounded-lg border border-border bg-muted/30 p-3 text-sm"
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

        <p className="text-[11px] text-muted-foreground">
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
