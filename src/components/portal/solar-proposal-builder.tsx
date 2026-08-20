"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Hammer, Landmark, Maximize2, Sun, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayoutBlock } from "@/lib/solar-layout";
import type { YieldAssumptions } from "@/lib/solar-money";
import { Button } from "@/components/ui/button";
import {
  SolarDesignPanel,
  SolarFinancePanel,
  SolarProposalGate,
  type LenderOption,
  type LenderProductOption,
  type ProposalVersion,
  type SolarDesignView,
  type SolarFinanceView,
} from "@/components/portal/solar-panels";
import type { AdderOption, DealAdderLine } from "@/components/portal/solar-adders-panel";
import { SolarCustomerPanel, type SolarCustomerView } from "@/components/portal/solar-customer-panel";
import { SolarEnergyPanel, type SolarEnergyView } from "@/components/portal/solar-energy-panel";
import type { ProviderOption } from "@/server/modules/solar/providers";

export type StepId = "customer" | "energy" | "design" | "financing" | "generate";

const STEPS: { id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "customer", label: "1 · Customer", icon: User },
  { id: "energy", label: "2 · Energy", icon: Zap },
  { id: "design", label: "3 · System design", icon: Hammer },
  { id: "financing", label: "4 · Financing", icon: Landmark },
  { id: "generate", label: "5 · Review & send", icon: Sun },
];

/**
 * The five things that make a solar proposal, in the order they happen.
 *
 * Every step stays MOUNTED and is hidden with `display:none` rather than
 * unmounted on switch. The panels hold their edits in local state behind an
 * explicit Save button, so unmounting step 1 to show step 2 would throw away a
 * design a rep had typed but not yet saved — silently, which is the worst way
 * to lose work. A handful of small forms cost nothing to keep in the tree.
 */
export function SolarProposalBuilder({
  leadId,
  initialStep = "customer",
  canEditDeal,
  canCreateProposal,
  design,
  finance,
  lenders,
  lenderId,
  lenderProducts,
  targetNetPpwCents,
  adderCatalogue,
  adderLines,
  systemSizeKwDc,
  year1ProductionKwh,
  annualDegradationPct,
  versions,
  layoutAvailable,
  canApproveLayout,
  lat,
  moduleRatingW,
  initialBlocks,
  assumptions,
  customer,
  energy,
  utilities,
  retailers,
  hasLayout,
}: {
  leadId: string;
  /**
   * Which step to open on. The readiness report links straight to the screen
   * that fixes each finding, so "Open financing" has to land ON financing
   * rather than on step 1 with the rep hunting for the tab again.
   */
  initialStep?: StepId;
  /** Editing the design and its financing is a Lead permission... */
  canEditDeal: boolean;
  /** ...while generating a customer-facing proposal is its own. */
  canCreateProposal: boolean;
  design: SolarDesignView;
  finance: SolarFinanceView;
  /** Every lender the company works with — the Financing step picks one. */
  lenders: LenderOption[];
  /** The one on the design, if it has been chosen. */
  lenderId: string | null;
  /** Every lender's rate sheet — see SolarFinancePanel. */
  lenderProducts: LenderProductOption[];
  targetNetPpwCents: number | null;
  /** Every adder the company sells, for the Financing step to offer. */
  adderCatalogue: AdderOption[];
  /** The adder lines already on this deal. Their sum is the contract's. */
  adderLines: DealAdderLine[];
  systemSizeKwDc: number;
  /** A PPA's term costs what the roof makes, so the comparison needs output. */
  year1ProductionKwh: number;
  /** And output decays, so a 25-year total is not year one times 25. */
  annualDegradationPct: number;
  versions: ProposalVersion[];
  /** Resolved server-side: the layout file row AND its bytes both exist. */
  layoutAvailable: boolean;
  canApproveLayout: boolean;
  /** Null when the deal has no rooftop coordinate — see SolarLayoutDesigner. */
  lat: number | null;
  moduleRatingW: number | null;
  initialBlocks: LayoutBlock[];
  /** The company's yield and derate. The designer previews production with the
   *  same two figures the save action uses, so the two cannot disagree. */
  assumptions: YieldAssumptions;
  customer: SolarCustomerView;
  energy: SolarEnergyView;
  utilities: ProviderOption[];
  retailers: ProviderOption[];
  /** Whether a layout already exists — an address change would invalidate it. */
  hasLayout: boolean;
}) {
  const [step, setStep] = React.useState<StepId>(initialStep);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={step === s.id ? "step" : undefined}
            onClick={() => setStep(s.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              step === s.id
                ? "bg-solar text-solar-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <s.icon className="size-3.5" />
            {s.label}
          </button>
        ))}
      </div>

      <StepPanel
        active={step === "customer"}
        title="Customer"
        blurb="Check we are quoting the right person at the right house before anything else."
      >
        <SolarCustomerPanel
          leadId={leadId}
          customer={customer}
          hasLayout={hasLayout}
          canEdit={canEditDeal}
        />
        <NextStep label="Next: Energy" onClick={() => setStep("energy")} />
      </StepPanel>

      <StepPanel
        active={step === "energy"}
        title="Energy"
        blurb="What the house uses and what they pay for it — from their usage, or from their bill and rate."
      >
        <SolarEnergyPanel
          leadId={leadId}
          energy={energy}
          utilities={utilities}
          retailers={retailers}
          year1ProductionKwh={year1ProductionKwh}
          canEdit={canEditDeal}
        />
        <NextStep label="Next: System design" onClick={() => setStep("design")} />
      </StepPanel>

      <StepPanel active={step === "design"} title="System design">
        <SolarDesignPanel
          leadId={leadId}
          design={design}
          canEdit={canEditDeal}
          layoutAvailable={layoutAvailable}
          canApproveLayout={canApproveLayout}
          lat={lat}
          moduleRatingW={moduleRatingW}
          initialBlocks={initialBlocks}
          assumptions={assumptions}
        />
        <NextStep label="Next: Financing" onClick={() => setStep("financing")} />
      </StepPanel>

      <StepPanel
        active={step === "financing"}
        title="Financing"
        blurb="The lender, the product and its terms travel with the quote the customer signs — pick them here, not on the deal."
      >
        {/* WHAT is being priced, at the top of the screen that prices it.
            Financing was a form with no system on it: a rep chose a product,
            typed a rate per watt and read back a monthly payment with nothing
            on screen saying how big the array was or what it made. Every figure
            below is that array multiplied by something. */}
        <SystemBanner
          leadId={leadId}
          systemSizeKwDc={systemSizeKwDc}
          year1ProductionKwh={year1ProductionKwh}
          annualUsageKwh={energy?.annualUsageKwh ?? null}
          onOpenEnergy={() => setStep("energy")}
        />
        <SolarFinancePanel
          leadId={leadId}
          finance={finance}
          canEdit={canEditDeal}
          lenders={lenders}
          lenderId={lenderId}
          products={lenderProducts}
          targetNetPpwCents={targetNetPpwCents}
          adderCatalogue={adderCatalogue}
          adderLines={adderLines}
          systemSizeKwDc={systemSizeKwDc}
          year1ProductionKwh={year1ProductionKwh}
          annualDegradationPct={annualDegradationPct}
        />
        <NextStep label="Next: Review & send" onClick={() => setStep("generate")} />
      </StepPanel>

      <StepPanel active={step === "generate"} title="Review & send">
        <SolarProposalGate
          leadId={leadId}
          canEdit={canCreateProposal}
          versions={versions}
          onOpenStep={setStep}
        />
      </StepPanel>
    </div>
  );
}

/**
 * The system the money is being quoted on: how big, what it makes, what share
 * of the house that covers.
 *
 * Every one of these is a link as well as a figure, because the answer to "that
 * offset is wrong" is always on another screen — either the roof or the bill —
 * and making a rep hunt for the tab is how a proposal goes out on numbers
 * nobody corrected.
 *
 * Offset reads "—" rather than 0% when no usage has been recorded. A system
 * makes the same kWh whatever the house uses; 0% would be a claim about the
 * house, made from nothing.
 */
function SystemBanner({
  leadId,
  systemSizeKwDc,
  year1ProductionKwh,
  annualUsageKwh,
  onOpenEnergy,
}: {
  leadId: string;
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  annualUsageKwh: number | null;
  onOpenEnergy: () => void;
}) {
  const offset =
    annualUsageKwh && annualUsageKwh > 0 ? (year1ProductionKwh / annualUsageKwh) * 100 : null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <Figure label="System" value={`${systemSizeKwDc.toFixed(2)} kW`} />
      <Figure label="Year one" value={`${year1ProductionKwh.toLocaleString()} kWh`} />
      <Figure
        label="Offset"
        value={offset == null ? "—" : `${offset.toFixed(0)}%`}
        muted={offset == null}
      />
      <div className="ml-auto flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/portal/leads/${leadId}/solar-proposal/design`}>
            <Maximize2 className="size-4" /> Edit the design
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={onOpenEnergy}>
          <Zap className="size-4" /> {annualUsageKwh ? "Edit usage" : "Add usage"}
        </Button>
      </div>
    </div>
  );
}

function Figure({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-display text-lg font-semibold tabular-nums",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * One step's card. `hidden` (not conditional rendering) so the step keeps its
 * unsaved state while another one is on screen — and stays out of the
 * accessibility tree and tab order while it is off.
 */
function StepPanel({
  active,
  title,
  blurb,
  children,
}: {
  active: boolean;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section hidden={!active} className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {blurb && <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>}
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

function NextStep({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="flex justify-end border-t border-border pt-4">
      <Button variant="outline" onClick={onClick}>
        {label} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
