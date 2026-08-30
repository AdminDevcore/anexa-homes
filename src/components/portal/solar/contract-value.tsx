"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  reconcileContract,
  type LenderContractAdjustment,
} from "@/lib/solar-contract-adjustment";
import {
  buildCreditLadder,
  CREDIT_HINT,
  CREDIT_LABEL,
  type CreditClaims,
  type CreditRates,
} from "@/lib/solar-credit-ladder";
import { setSolarCreditClaimsAction } from "@/server/modules/solar/actions";

/**
 * The two prices on a deal whose partner runs a programme contribution, side by
 * side, said in the rep's own vocabulary.
 *
 * WHY A SEPARATE CARD RATHER THAN TWO MORE ROWS ON THE PRICE CARD ABOVE.
 *
 * Every figure on that card is one number seen from a different angle: base,
 * adders, gross, the price the ladder arrives at. They are rungs of one ladder
 * and a rep reads them as a ladder. What the household ends up paying is not
 * another rung — it is the other end of a journey through the federal credits,
 * and putting it in the same list is how a rep loses track of which figure the
 * customer's payment is quoted on.
 *
 * WHAT THIS CARD SAID BEFORE 2026-08-29, AND WHY IT CHANGED. It used to head
 * its left column "Customer pricing — every payment and saving on the proposal
 * is worked out from it" and its right "not what the customer owes, and never
 * quoted to them as a price". Both sentences are now false: the document quotes
 * the CONTRACT, the payment comes off the contract, and the credits bring the
 * household back to the quoted price on a page of their own. A rep reading the
 * old card would have talked a customer through a proposal that says something
 * else, which is a worse failure than having no card at all.
 *
 * THE CONTRACT IS READ-ONLY, AND NOT BY ACCIDENT. The adjustment is a term of
 * the partner's programme, not a lever on this deal: it is set once in
 * Settings → Lenders by somebody with permission to change settings. THE
 * CREDIT TICK-BOXES ARE NOT — whether this roof sits in an energy community,
 * and whether these modules meet the sourcing threshold, are facts about the
 * job that only the person selling it knows.
 *
 * LIVE, like everything else on this step. It prices what is currently on
 * screen through the same `reconcileContract` the generated document uses, so
 * what a rep sees before saving is what the proposal will freeze.
 */
export function ContractValueCard({
  leadId,
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
  creditRates,
  claims: initialClaims,
  canEdit,
}: {
  leadId: string;
  lenderName: string | null;
  /** The partner's programme, as configured. Null renders nothing at all. */
  adjustment: LenderContractAdjustment | null;
  systemSizeKwDc: number;
  /** The price divided by the watts, as the ladder computed it. */
  customerFinalPpwCents: number | null;
  /** The system at sticker, the fee already in it. Adders excluded. */
  customerSystemPriceCents: number;
  /** The extra work as the customer's own breakdown reads it. */
  adderStickerCents: number;
  /** What the system was PRICED at — the ladder's target, not the contract. */
  customerContractCents: number;
  monthlyCents: number | null;
  termMonths: number | null;
  aprPct: number | null;
  /** The company's percentages, from Settings → Solar. */
  creditRates: CreditRates;
  /** Which credits this job earns, as last saved. */
  claims: CreditClaims;
  canEdit: boolean;
}) {
  const reconciliation = reconcileContract({
    customerObligationCents: customerContractCents,
    adjustment,
    lenderName,
  });

  /**
   * OPTIMISTIC, and deliberately so: the tick-boxes re-price the ladder beside
   * them the instant they are clicked, and the save lands behind it. A round
   * trip before the figures move makes three connected numbers look broken.
   * A failed save puts the box back and says why — see `toggle`.
   */
  const [claims, setClaims] = React.useState<CreditClaims>(initialClaims);
  const [seen, setSeen] = React.useState(initialClaims);
  if (seen !== initialClaims) {
    setSeen(initialClaims);
    setClaims(initialClaims);
  }
  const [error, setError] = React.useState<string | null>(null);
  const [saving, startSave] = React.useTransition();

  const toggle = (key: keyof CreditClaims) => {
    const next = { ...claims, [key]: !claims[key] };
    setClaims(next);
    setError(null);
    startSave(async () => {
      const res = await setSolarCreditClaimsAction({
        leadId,
        claimItc: next.itc,
        claimEnergyCommunity: next.energyCommunity,
        claimDomesticContent: next.domesticContent,
      });
      if (!res.ok) {
        // Put it back. A tick-box that stays ticked after a failed save is a
        // rep quoting a credit the deal does not carry.
        setClaims(claims);
        setError(res.error);
      }
    });
  };

  const ladder = reconciliation
    ? buildCreditLadder({
        contractValueCents: reconciliation.lenderContractValueCents,
        quotedPriceCents: reconciliation.customerObligationCents,
        rates: creditRates,
        claims,
      })
    : null;

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
          The contract, and what they actually pay
        </h3>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          Contribution set in Settings → Lenders
        </span>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        {/* WHAT THE HOUSEHOLD SIGNS FOR — first, because it is the figure on
            every page of the document and the one the payment comes off. */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            The contract they sign
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            What the proposal quotes on every page. The payment, the amount financed and the price
            per watt are all worked out from it.
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <Row k="System size" v={`${systemSizeKwDc.toFixed(2)} kW`} />
            <Row k="System price" v={money(customerSystemPriceCents)} />
            {adderStickerCents !== 0 && <Row k="Add-ons" v={money(adderStickerCents)} />}
            <Row k={reconciliation.label} v={`+${money(reconciliation.adjustmentCents)}`} />
            <Row
              k="Contract price"
              v={money(reconciliation.lenderContractValueCents)}
              strong
            />
            {/* The $/W the DOCUMENT prints, which is the contract over the
                watts — not the rate the rep priced at. Shown because a rep
                asked about $12.50/W by a customer needs to have seen it here
                first. */}
            {systemSizeKwDc > 0 && (
              <Row
                k="Price per watt on the contract"
                v={`$${(
                  reconciliation.lenderContractValueCents /
                  100 /
                  (systemSizeKwDc * 1000)
                ).toFixed(2)}/W`}
                muted
              />
            )}
            {monthlyCents != null && (
              <Row
                k="Monthly on the contract"
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
            {customerFinalPpwCents != null && customerFinalPpwCents > 0 && (
              <Row
                k="Priced at"
                v={`$${(customerFinalPpwCents / 100).toFixed(2)}/W · ${money(customerContractCents)}`}
                muted
              />
            )}
          </dl>
        </div>

        {/* THE LADDER, exactly as the customer's own page will draw it — so a
            rep is never surprised by what the proposal prints, and can answer
            the one question a large contract raises before it is asked. */}
        <div className="lg:border-l lg:border-border/70 lg:pl-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            What they actually pay
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The credits come off the contract above, and whatever is left over lands back on the
            deal as the signing incentive. This is its own page on the proposal.
          </p>

          {ladder ? (
            <>
              <dl className="mt-3 space-y-1 text-sm">
                <Row k="Contract price" v={money(ladder.contractValueCents)} />
                {ladder.credits.map((c) => (
                  <Row
                    key={c.key}
                    k={`${c.label} (${c.pct}%)`}
                    v={`−${money(c.amountCents)}`}
                    muted
                  />
                ))}
                {ladder.incentiveCents > 0 && (
                  <Row k={ladder.incentiveLabel} v={`−${money(ladder.incentiveCents)}`} muted />
                )}
                <Row k="What they pay" v={money(ladder.netCostCents)} strong />
              </dl>

              {/* THE ONE THING THE CUSTOMER'S PAGE DOES NOT SAY. On a system
                  big enough that the credits alone clear the price, there is
                  nothing to hand back — the household nets better than quoted,
                  which is fine, but it usually means the partner's contribution
                  is too small for a job this size and somebody should know. */}
              {ladder.shortfallCents > 0 && (
                <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                  The credits alone already take this contract{" "}
                  <strong>{money(ladder.shortfallCents)}</strong> below the{" "}
                  {money(customerContractCents)} you priced it at, so there is no signing incentive
                  to show. The customer&rsquo;s page ends at {money(ladder.netCostCents)}.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              No credit is being quoted on this deal, so the proposal shows the contract and the{" "}
              {reconciliation.label.toLowerCase()} and nothing else.
            </p>
          )}

          {/* WHICH CREDITS THIS JOB EARNS. Editable, because the two bonuses
              are conditional on the address and the equipment and only the
              person selling it knows. Unticking one does not change what the
              household pays — the incentive absorbs it — it changes what the
              document CLAIMS on their behalf. */}
          <fieldset className="mt-4 border-t border-border/70 pt-3">
            <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
              Credits this job earns
            </legend>
            <div className="mt-2 space-y-2">
              {(["itc", "energyCommunity", "domesticContent"] as const).map((key) => (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 text-[12px] leading-snug",
                    !canEdit && "cursor-default opacity-70"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 shrink-0 accent-[var(--solar)]"
                    checked={claims[key]}
                    disabled={!canEdit || saving}
                    onChange={() => toggle(key)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">
                      {CREDIT_LABEL[key]} ({rateFor(creditRates, key)}%)
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">{CREDIT_HINT[key]}</span>
                  </span>
                </label>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-2 text-[11px] text-destructive">
                {error}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Unticking one does not change what they pay — the incentive grows by the same amount.
              It changes what the proposal claims on their tax return.
            </p>
          </fieldset>

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {reconciliation.disclosure}
          </p>
        </div>
      </div>
    </section>
  );
}

/** The company's percentage for one credit. */
function rateFor(rates: CreditRates, key: keyof CreditClaims): number {
  return key === "itc"
    ? rates.itcPct
    : key === "energyCommunity"
      ? rates.energyCommunityPct
      : rates.domesticContentPct;
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
