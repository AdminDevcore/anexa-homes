"use client";

import * as React from "react";
import { ArrowRight, Hammer, Landmark, Sun, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayoutBlock } from "@/lib/solar-layout";
import type { YieldAssumptions } from "@/lib/solar-money";
import { Button } from "@/components/ui/button";
import {
  SolarDesignPanel,
  SolarFinancePanel,
  SolarProposalGate,
  type LenderProductOption,
  type ProposalVersion,
  type SolarDesignView,
  type SolarFinanceView,
} from "@/components/portal/solar-panels";
import { SolarCustomerPanel, type SolarCustomerView } from "@/components/portal/solar-customer-panel";
import { SolarEnergyPanel, type SolarEnergyView } from "@/components/portal/solar-energy-panel";
import type { ProviderOption } from "@/server/modules/solar/providers";

export type StepId = "customer" | "energy" | "design" | "financing" | "generate";

const STEPS: { id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "customer", label: "1 · Customer", icon: User },
  { id: "energy", label: "2 · Energy", icon: Zap },
  { id: "design", label: "3 · System design", icon: Hammer },
  { id: "financing", label: "4 · Financing", icon: Landmark },
  { id: "generate", label: "5 · Generate & send", icon: Sun },
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
  lenderName,
  lenderPortalUrl,
  lenderCreditInstructions,
  lenderProducts,
  targetNetPpwCents,
  systemSizeKwDc,
  versions,
  layoutAvailable,
  canApproveLayout,
  lat,
  moduleMm,
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
  /** The lender step 1 designed this system for, if one was chosen. */
  lenderName: string | null;
  /** Dealer portal, rep-facing. Never the customer application link. */
  lenderPortalUrl: string | null;
  lenderCreditInstructions: string | null;
  /** That lender's rate sheet — see SolarFinancePanel. */
  lenderProducts: LenderProductOption[];
  targetNetPpwCents: number | null;
  systemSizeKwDc: number;
  versions: ProposalVersion[];
  /** Resolved server-side: the layout file row AND its bytes both exist. */
  layoutAvailable: boolean;
  canApproveLayout: boolean;
  /** Null when the deal has no rooftop coordinate — see SolarLayoutDesigner. */
  lat: number | null;
  moduleMm: { widthMm: number; heightMm: number };
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
          moduleMm={moduleMm}
          moduleRatingW={moduleRatingW}
          initialBlocks={initialBlocks}
          assumptions={assumptions}
        />
        <NextStep label="Next: Financing" onClick={() => setStep("financing")} />
      </StepPanel>

      <StepPanel
        active={step === "financing"}
        title="Financing"
        blurb="The product and its terms travel with the quote the customer signs — pick them here, not on the deal."
      >
        <SolarFinancePanel
          leadId={leadId}
          finance={finance}
          canEdit={canEditDeal}
          lenderName={lenderName}
          lenderPortalUrl={lenderPortalUrl}
          lenderCreditInstructions={lenderCreditInstructions}
          products={lenderProducts}
          targetNetPpwCents={targetNetPpwCents}
          systemSizeKwDc={systemSizeKwDc}
        />
        <NextStep label="Next: Generate & send" onClick={() => setStep("generate")} />
      </StepPanel>

      <StepPanel active={step === "generate"} title="Generate & send">
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
