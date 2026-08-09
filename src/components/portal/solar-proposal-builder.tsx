"use client";

import * as React from "react";
import { ArrowRight, Hammer, Landmark, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  SolarDesignPanel,
  SolarFinancePanel,
  SolarProposalGate,
  type ProposalVersion,
  type SolarDesignView,
  type SolarFinanceView,
} from "@/components/portal/solar-panels";

type EquipmentOption = { id: string; label: string; ratingW: number | null };

type StepId = "design" | "financing" | "generate";

const STEPS: { id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "design", label: "1 · System design", icon: Hammer },
  { id: "financing", label: "2 · Financing", icon: Landmark },
  { id: "generate", label: "3 · Generate & send", icon: Sun },
];

/**
 * The three things that make a solar proposal, in the order they happen.
 *
 * Every step stays MOUNTED and is hidden with `display:none` rather than
 * unmounted on switch. The panels hold their edits in local state behind an
 * explicit Save button, so unmounting step 1 to show step 2 would throw away a
 * design a rep had typed but not yet saved — silently, which is the worst way
 * to lose work. Three small forms cost nothing to keep in the tree.
 */
export function SolarProposalBuilder({
  leadId,
  canEditDeal,
  canCreateProposal,
  design,
  finance,
  itcDisclaimer,
  federalItcPct,
  modules,
  inverters,
  batteries,
  versions,
}: {
  leadId: string;
  /** Editing the design and its financing is a Lead permission... */
  canEditDeal: boolean;
  /** ...while generating a customer-facing proposal is its own. */
  canCreateProposal: boolean;
  design: SolarDesignView;
  finance: SolarFinanceView;
  itcDisclaimer: string;
  federalItcPct: number | null;
  modules: EquipmentOption[];
  inverters: EquipmentOption[];
  batteries: EquipmentOption[];
  versions: ProposalVersion[];
}) {
  const [step, setStep] = React.useState<StepId>("design");

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

      <StepPanel active={step === "design"} title="System design">
        <SolarDesignPanel
          leadId={leadId}
          design={design}
          modules={modules}
          inverters={inverters}
          batteries={batteries}
          canEdit={canEditDeal}
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
          itcDisclaimer={itcDisclaimer}
          federalItcPct={federalItcPct}
          canEdit={canEditDeal}
        />
        <NextStep label="Next: Generate & send" onClick={() => setStep("generate")} />
      </StepPanel>

      <StepPanel active={step === "generate"} title="Generate & send">
        <SolarProposalGate leadId={leadId} canEdit={canCreateProposal} versions={versions} />
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
