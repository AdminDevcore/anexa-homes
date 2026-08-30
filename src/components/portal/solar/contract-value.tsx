"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  reconcileContract,
  type LenderContractAdjustment,
} from "@/lib/solar-contract-adjustment";

/**
 * The two prices on a deal whose partner runs a programme contribution, side by
 * side, said in the rep's own vocabulary.
 *
 * WHY A SEPARATE CARD RATHER THAN TWO MORE ROWS ON THE PRICE CARD ABOVE.
 *
 * Every figure on that card is one number seen from a different angle: base,
 * adders, gross, the customer's final price. They are rungs of one ladder, and
 * a rep reads them as a ladder. The contract value is NOT another rung — it is
 * a different number about a different party's liability, and putting it in the
 * same list is how a rep ends up quoting a household $118,400.
 *
 * So the split is the whole design. Two columns, each with a heading naming
 * whose money it is, and the customer's side leads because that is the side a
 * rep says out loud. The reconciliation on the right adds up in front of them
 * — value, less the contribution, equals the obligation — so the relationship
 * between the two is visible rather than asserted.
 *
 * READ-ONLY, AND NOT BY ACCIDENT. The adjustment is a term of the partner's
 * programme, not a lever on this deal: it is set once in Settings → Lenders by
 * somebody with permission to change settings, and no control on this screen
 * touches it. That is stated on the card rather than merely implemented,
 * because a figure with no visible control looks like something that failed to
 * load.
 *
 * LIVE, like everything else on this step. It prices what is currently on
 * screen through the same `reconcileContract` the generated document uses, so
 * what a rep sees before saving is what the proposal will freeze.
 */
export function ContractValueCard({
  lenderName,
  adjustment,
  systemSizeKwDc,
  customerFinalPpwCents,
  customerSystemPriceCents,
  adderStickerCents,
  customerContractCents,
  monthlyCents,
  termMonths,
  aprPct,
}: {
  lenderName: string | null;
  /** The partner's programme, as configured. Null renders nothing at all. */
  adjustment: LenderContractAdjustment | null;
  systemSizeKwDc: number;
  /** The contract divided by the watts — what the homeowner really pays a watt. */
  customerFinalPpwCents: number | null;
  /** The system at sticker, the fee already in it. Adders excluded. */
  customerSystemPriceCents: number;
  /** The extra work as the customer's own breakdown reads it. */
  adderStickerCents: number;
  /** What the household signs for. The number every payment comes off. */
  customerContractCents: number;
  monthlyCents: number | null;
  termMonths: number | null;
  aprPct: number | null;
}) {
  const reconciliation = reconcileContract({
    customerObligationCents: customerContractCents,
    adjustment,
    lenderName,
  });

  // Nothing to say. A partner with no programme, one switched off, one whose
  // start date has not arrived, or one configured halfway — the last of which
  // the readiness report is meanwhile blocking generation over, with a message
  // that names the missing field.
  if (!reconciliation) return null;

  return (
    <section
      aria-labelledby="contract-value-heading"
      className="overflow-hidden rounded-xl border border-solar/40 bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-solar/30 bg-solar/5 px-4 py-2.5">
        <h3
          id="contract-value-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Two prices on this deal
        </h3>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          Set in Settings → Lenders
        </span>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        {/* THE CUSTOMER'S SIDE, first and always first. */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            Customer pricing
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            What this household is obligated to pay. Every payment and saving on the proposal is
            worked out from it.
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <Row k="System size" v={`${systemSizeKwDc.toFixed(2)} kW`} />
            {customerFinalPpwCents != null && customerFinalPpwCents > 0 && (
              <Row k="Customer price per watt" v={`$${(customerFinalPpwCents / 100).toFixed(2)}/W`} />
            )}
            <Row k="Customer system price" v={money(customerSystemPriceCents)} />
            {adderStickerCents !== 0 && (
              <Row k="Customer-selected add-ons" v={money(adderStickerCents)} />
            )}
            <Row k="Customer obligation" v={money(customerContractCents)} strong />
            {/* Nothing on this screen takes money off the top, so the financed
                amount and the obligation are the same figure. Stated anyway,
                because it is the number the proposal's payment divides into and
                the one a reader will check the monthly against. */}
            <Row k="Customer-financed amount" v={money(customerContractCents)} muted />
            {monthlyCents != null && (
              <Row
                k="Customer monthly payment"
                v={`${money(monthlyCents, 2)}${termMonths ? ` × ${termMonths}` : ""}`}
                strong
              />
            )}
            {(termMonths != null || aprPct != null) && (
              <Row
                k="Term and rate"
                v={[
                  termMonths ? `${termMonths} payments` : null,
                  aprPct != null ? `${aprPct}% APR` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                muted
              />
            )}
          </dl>
        </div>

        {/* THE PARTNER'S SIDE. Same three figures the customer's document
            reconciles, so a rep is never surprised by what the proposal prints. */}
        <div className="lg:border-l lg:border-border/70 lg:pl-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            {lenderName ? `${lenderName} pricing` : "Lender pricing"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            What the partner&rsquo;s paper is written at. Not what the customer owes, and never
            quoted to them as a price.
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <Row
              k="Adjusted contract value"
              v={money(reconciliation.lenderContractValueCents)}
              strong
            />
            <Row k={reconciliation.label} v={`−${money(reconciliation.adjustmentCents)}`} />
            <Row
              k="Customer's resulting obligation"
              v={money(reconciliation.customerObligationCents)}
              strong
            />
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {reconciliation.disclosure}
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({
  k,
  v,
  muted,
  strong,
}: {
  k: string;
  v: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "border-t border-border pt-1.5 font-semibold",
        muted && "text-muted-foreground"
      )}
    >
      <dt className={cn(!strong && !muted && "text-muted-foreground")}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

const money = (cents: number, digits = 0) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
