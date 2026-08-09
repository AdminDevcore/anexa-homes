"use client";

import Link from "next/link";
import { Presentation } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ProposalVersionList, type ProposalVersion } from "@/components/portal/solar-panels";

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
}: {
  leadId: string;
  product: FinanceProduct | null;
  systemSizeKwDc: number | null;
  offsetPct: number | null;
  contractPriceCents: number | null;
  monthlyPaymentCents: number | null;
  rateMillsPerKwh: number | null;
  versions: ProposalVersion[];
  canBuild: boolean;
  canEdit: boolean;
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

  return (
    <div className="space-y-4">
      {headline.length > 0 ? (
        <p className="text-sm font-medium">{headline.join(" · ")}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No system design yet. Build the proposal to size the system, pick the financing and send it.
        </p>
      )}

      <ProposalVersionList versions={versions} canEdit={canEdit} />

      {canBuild && (
        <Button asChild className="w-full bg-solar text-solar-foreground hover:bg-solar/90 sm:w-auto">
          <Link href={`/portal/leads/${leadId}/solar-proposal`}>
            <Presentation className="size-4" /> Build Proposal
          </Link>
        </Button>
      )}
    </div>
  );
}
