"use client";

import Link from "next/link";
import { Presentation } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProposalVersionList, type ProposalVersion } from "@/components/portal/solar-panels";
import {
  SOLAR_PROPOSAL_STATE_CTA,
  SOLAR_PROPOSAL_STATE_LABEL,
  SOLAR_PROPOSAL_STATE_TONE,
  type SolarProposalState,
} from "@/lib/solar-proposal-state";

const PRODUCT_LABEL: Record<FinanceProduct, string> = {
  cash: "Cash",
  loan: "Loan",
  lease: "Lease",
  ppa: "PPA",
};

function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Where a solar deal's proposal stands, on the deal page.
 *
 * The design, the financing and generation used to sit here as three full
 * cards. They are the proposal's INPUTS and moved into the builder with it —
 * but "what did we quote, and did they open it" is a question you ask of the
 * deal, so the headline and the version list stay. Nothing here writes.
 */
export function SolarProposalStrip({
  leadId,
  state,
  blockingCount,
  product,
  systemSizeKwDc,
  offsetPct,
  /** Cash and loan only: the system price. A lease and a PPA have none. */
  contractPriceCents,
  /** Lease only: the fixed monthly. */
  monthlyPaymentCents,
  /** PPA only: price per kWh, in tenths of a cent. */
  rateMillsPerKwh,
  versions,
  canBuild,
  canEdit,
  canApprove = false,
}: {
  leadId: string;
  /** Where the proposal stands. Derived — see lib/solar-proposal-state.ts. */
  state: SolarProposalState;
  /** How many blocking issues stand between this deal and a proposal. */
  blockingCount: number;
  product: FinanceProduct | null;
  systemSizeKwDc: number | null;
  offsetPct: number | null;
  contractPriceCents: number | null;
  monthlyPaymentCents: number | null;
  rateMillsPerKwh: number | null;
  versions: ProposalVersion[];
  canBuild: boolean;
  canEdit: boolean;
  /**
   * Whether this user may declare which version the deal sold. Admins only —
   * everyone else still sees the approved badge, which is the useful half and
   * is not privileged information.
   */
  canApprove?: boolean;
}) {
  // One headline the way the customer would hear it: a lease is a monthly, a
  // PPA is a rate, a purchase is a price. Quoting a PPA a contract price is how
  // a proposal ends up saying something the paperwork doesn't.
  const price =
    product === "ppa"
      ? rateMillsPerKwh
        ? `$${(rateMillsPerKwh / 1000).toFixed(3)}/kWh`
        : null
      : product === "lease"
        ? monthlyPaymentCents
          ? `${usd(monthlyPaymentCents)}/mo`
          : null
        : contractPriceCents
          ? usd(contractPriceCents)
          : null;

  const headline = [
    product ? PRODUCT_LABEL[product] : null,
    systemSizeKwDc ? `${systemSizeKwDc.toFixed(2)} kW-DC` : null,
    price,
    offsetPct ? `${offsetPct.toFixed(0)}% offset` : null,
  ].filter(Boolean);

  // "View proposal" has to go somewhere different from "Build proposal": once
  // one exists, the thing a rep wants is to READ it, and the internal preview
  // does that without recording a customer view or handling the share token.
  const generated = state === "generated" || state === "sent" || state === "viewed" || state === "accepted";
  const href = generated
    ? `/portal/leads/${leadId}/solar-proposal/preview`
    : `/portal/leads/${leadId}/solar-proposal`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-proposal-state={state}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            TONE_CLASS[SOLAR_PROPOSAL_STATE_TONE[state]]
          )}
        >
          {SOLAR_PROPOSAL_STATE_LABEL[state]}
        </span>
        {state === "draft" && blockingCount > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {blockingCount} {blockingCount === 1 ? "thing" : "things"} left to fix
          </span>
        )}
      </div>

      {headline.length > 0 ? (
        <p className="text-sm font-medium">{headline.join(" · ")}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No system design yet. Build the proposal to size the system, pick the financing and send it.
        </p>
      )}

      <ProposalVersionList versions={versions} canEdit={canEdit} canApprove={canApprove} />

      {canBuild && (
        <Button asChild className="w-full bg-solar text-solar-foreground hover:bg-solar/90 sm:w-auto">
          <Link href={href}>
            <Presentation className="size-4" /> {SOLAR_PROPOSAL_STATE_CTA[state]}
          </Link>
        </Button>
      )}
    </div>
  );
}

const TONE_CLASS: Record<"neutral" | "progress" | "ready" | "done", string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-sky-100 text-sky-700",
  ready: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-700",
};
