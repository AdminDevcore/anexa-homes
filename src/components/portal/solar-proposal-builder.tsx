"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Hammer, Landmark, Maximize2, Sun, User, Zap,
} from "lucide-react";
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

type Step = {
  id: StepId;
  /** The rail's word for it. The ordinal is drawn, never typed into the label. */
  label: string;
  title: string;
  blurb?: string;
  icon: React.ComponentType<{ className?: string }>;
};

const STEPS: Step[] = [
  {
    id: "customer",
    label: "Customer",
    title: "Customer",
    blurb: "Check we are quoting the right person at the right house before anything else.",
    icon: User,
  },
  {
    id: "energy",
    label: "Energy",
    title: "Energy",
    blurb:
      "What the house uses and what they pay for it — from their usage, or from their bill and rate.",
    icon: Zap,
  },
  {
    id: "design",
    label: "System design",
    title: "System design",
    blurb: "The array on the roof, and the size and output that follow from it.",
    icon: Hammer,
  },
  {
    id: "financing",
    label: "Financing",
    title: "Price & financing",
    blurb:
      "What we charge for this system, and every way the customer could pay for it. Both travel with the quote they sign.",
    icon: Landmark,
  },
  {
    id: "generate",
    label: "Review & send",
    title: "Review & send",
    icon: Sun,
  },
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
  defaultBasePpwCents,
  minPpwCents,
  maxPpwCents,
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
  /** The company's base price per watt, which a deal nobody has priced opens on. */
  defaultBasePpwCents: number | null;
  /** The company's price band. Outside it warns; it never blocks a save. */
  minPpwCents: number;
  maxPpwCents: number;
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
  const index = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-5">
      <StepRail active={step} onSelect={setStep} />

      {/* WHAT is being quoted, on every step that spends it. A rep pricing a
          system needs the size and the offset on screen; the two steps that
          collect them have their own, better figures a few inches down. */}
      {(step === "financing" || step === "generate") && (
        <SystemBanner
          leadId={leadId}
          systemSizeKwDc={systemSizeKwDc}
          year1ProductionKwh={year1ProductionKwh}
          annualUsageKwh={energy?.annualUsageKwh ?? null}
          onOpenEnergy={() => setStep("energy")}
        />
      )}

      {STEPS.map((s, i) => (
        <StepPanel
          key={s.id}
          active={step === s.id}
          ordinal={i + 1}
          step={s}
          prev={i > 0 ? STEPS[i - 1] : null}
          next={i < STEPS.length - 1 ? STEPS[i + 1] : null}
          onGo={setStep}
        >
          {s.id === "customer" && (
            <SolarCustomerPanel
              leadId={leadId}
              customer={customer}
              hasLayout={hasLayout}
              canEdit={canEditDeal}
            />
          )}
          {s.id === "energy" && (
            <SolarEnergyPanel
              leadId={leadId}
              energy={energy}
              utilities={utilities}
              retailers={retailers}
              year1ProductionKwh={year1ProductionKwh}
              canEdit={canEditDeal}
            />
          )}
          {s.id === "design" && (
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
          )}
          {s.id === "financing" && (
            <SolarFinancePanel
              leadId={leadId}
              finance={finance}
              canEdit={canEditDeal}
              lenders={lenders}
              lenderId={lenderId}
              products={lenderProducts}
              defaultBasePpwCents={defaultBasePpwCents}
              minPpwCents={minPpwCents}
              maxPpwCents={maxPpwCents}
              adderCatalogue={adderCatalogue}
              adderLines={adderLines}
              systemSizeKwDc={systemSizeKwDc}
              year1ProductionKwh={year1ProductionKwh}
              annualDegradationPct={annualDegradationPct}
              onOpenDesign={() => setStep("design")}
            />
          )}
          {s.id === "generate" && (
            <SolarProposalGate
              leadId={leadId}
              customerEmail={customer.email}
              customerPhone={customer.phone}
              canEdit={canCreateProposal}
              versions={versions}
              onOpenStep={setStep}
            />
          )}
        </StepPanel>
      ))}

      <p className="text-center text-[11px] text-muted-foreground">
        Step {index + 1} of {STEPS.length}
        {" · "}
        nothing is sent to the customer until Review &amp; send
      </p>
    </div>
  );
}

/**
 * The five steps as a rail rather than five pills.
 *
 * The pills said "1 · Customer" through "5 · Review & send" and were otherwise
 * identical, so the ordinals were the only thing carrying the sequence and they
 * were doing it in body text. Drawing the number in its own disc, with a rule
 * running between the discs, says "these happen in order and you are here"
 * without a word — and leaves the label free to be the label.
 *
 * Every step stays clickable. This is a builder, not a wizard: a rep who needs
 * to change the bill mid-quote goes back to Energy and returns, and gating a
 * step behind the one before it would only invent a wall the data does not have.
 */
function StepRail({ active, onSelect }: { active: StepId; onSelect: (id: StepId) => void }) {
  const activeIndex = STEPS.findIndex((s) => s.id === active);

  return (
    <nav aria-label="Proposal steps" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-center gap-1">
        {STEPS.map((s, i) => {
          const current = s.id === active;
          const behind = i < activeIndex;
          return (
            <li key={s.id} className="flex items-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-1 h-px w-5 shrink-0 sm:w-8",
                    behind || current ? "bg-solar/50" : "bg-border"
                  )}
                />
              )}
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                onClick={() => onSelect(s.id)}
                className={cn(
                  "group inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  current
                    ? "bg-solar/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {/* Decorative. The ordinal is already carried structurally by
                    the <ol> and by aria-current, and leaving it in the
                    accessible name makes every step announce as "4 Financing"
                    — a number read as part of a word. */}
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors",
                    current
                      ? "bg-solar text-solar-foreground"
                      : behind
                        ? "bg-solar/15 text-solar"
                        : "bg-muted text-muted-foreground group-hover:bg-background"
                  )}
                >
                  {i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
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
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-4 py-3">
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
 *
 * The footer moves BOTH ways now. A one-way "Next" is fine for a form nobody
 * revisits; this is a quote, and the commonest move on the financing step is
 * back to the roof and forward again.
 */
function StepPanel({
  active,
  ordinal,
  step,
  prev,
  next,
  onGo,
  children,
}: {
  active: boolean;
  ordinal: number;
  step: Step;
  prev: Step | null;
  next: Step | null;
  onGo: (id: StepId) => void;
  children: React.ReactNode;
}) {
  return (
    <section hidden={!active} className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border/70 px-5 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-solar/10 text-solar">
          <step.icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{step.title}</h2>
          {step.blurb && <p className="mt-0.5 text-sm text-muted-foreground">{step.blurb}</p>}
        </div>
        <span className="ml-auto hidden shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground sm:block">
          Step {ordinal}
        </span>
      </header>

      <div className="space-y-5 p-5">{children}</div>

      {(prev || next) && (
        <footer className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-5 py-3">
          {prev ? (
            <Button variant="ghost" size="sm" onClick={() => onGo(prev.id)}>
              <ArrowLeft className="size-4" /> {prev.label}
            </Button>
          ) : (
            <span />
          )}
          {next && (
            <Button variant="outline" size="sm" onClick={() => onGo(next.id)}>
              {next.label} <ArrowRight className="size-4" />
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}
