"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  buildCreditLadder,
  CREDIT_HINT,
  CREDIT_LABEL,
  type CreditClaims,
  type CreditRates,
} from "@/lib/solar-credit-ladder";
import { setSolarCreditClaimsAction } from "@/server/modules/solar/actions";

/**
 * WHAT THIS PROPOSAL CLAIMS ON THE HOUSEHOLD'S TAX RETURN, on the deal, live.
 *
 * Every purchase deal makes such a claim: the document's tax-credit switch
 * shows the same system with the federal credits applied, and the three
 * tick-boxes here decide which credits that is. They used to be tucked behind
 * a partner-programme card, so on an ordinary deal they were invisible AND
 * ticked — a document quoting fifty percent to a household that qualifies for
 * thirty, with nothing on the rep's screen saying so.
 *
 * WHY A SEPARATE CARD RATHER THAN TWO MORE ROWS ON THE PRICE CARD ABOVE.
 *
 * Every figure on that card is one number seen from a different angle: base,
 * adders, gross, the price the ladder arrives at. They are rungs of one ladder
 * and a rep reads them as a ladder. What the household nets once their own
 * return pays them back is not another rung — it is the other end of a journey
 * through the federal credits, and putting it in the same list is how a rep
 * loses track of which figure the customer's payment is quoted on.
 *
 * THE TICK-BOXES ARE THE REP'S. Whether this roof sits in an energy community,
 * and whether these modules meet the sourcing threshold, are facts about the
 * job that only the person selling it knows. The PERCENTAGES are not — those
 * are statute, and are set once in Settings → Solar.
 *
 * LIVE, like everything else on this step: the ladder is built by the same
 * `buildCreditLadder` the generated document uses, so what a rep sees before
 * saving is what the proposal will freeze.
 */
export function CreditClaimsCard({
  leadId,
  customerContractCents,
  creditRates,
  claims: initialClaims,
  canEdit,
}: {
  leadId: string;
  /** What the system was priced at — the figure the credits come off. */
  customerContractCents: number;
  /** The company's percentages, from Settings → Solar. */
  creditRates: CreditRates;
  /** Which credits this job earns, as last saved. */
  claims: CreditClaims;
  canEdit: boolean;
}) {
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

  /**
   * The ladder as the customer's own page will draw it — same call, same
   * arithmetic, so a rep is never shown a ladder the document then draws
   * differently. `buildCreditLadder` drops the incentive row on its own rather
   * than printing a zero.
   */
  const ladder = buildCreditLadder({
    contractValueCents: customerContractCents,
    quotedPriceCents: customerContractCents,
    rates: creditRates,
    claims,
  });

  const fieldset = (
    <CreditClaimsFieldset
      claims={claims}
      creditRates={creditRates}
      canEdit={canEdit}
      saving={saving}
      error={error}
      onToggle={toggle}
      note="This is what the proposal's tax-credit switch claims on their behalf. It does not change the price or the payment they were quoted."
    />
  );

  return (
    <section
      aria-labelledby="credit-claims-heading"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/40 px-4 py-2.5">
        <h3
          id="credit-claims-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Federal tax credits
        </h3>
        <span className="text-[11px] text-muted-foreground">
          Percentages set in Settings → Solar
        </span>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
            What the switch shows
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The proposal quotes the price and payment below. Its tax-credit switch shows this
            same deal with the credits already applied — the customer is never quoted the lower
            figure by default.
          </p>
          {ladder ? (
            <dl className="mt-3 space-y-1 text-sm">
              <Row k="Price" v={money(ladder.contractValueCents)} />
              {ladder.credits.map((c) => (
                <Row
                  key={c.key}
                  k={`${c.label} (${c.pct}%)`}
                  v={`−${money(c.amountCents)}`}
                  muted
                />
              ))}
              <Row k="Net cost after credits" v={money(ladder.netCostCents)} strong />
            </dl>
          ) : (
            <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              No credit is being claimed on this deal, so the proposal shows the price and the
              payment and offers no switch at all.
            </p>
          )}
        </div>

        <div className="lg:border-l lg:border-border/70 lg:pl-5">{fieldset}</div>
      </div>
    </section>
  );
}

/**
 * WHICH CREDITS THIS JOB EARNS.
 *
 * Editable, because the two bonuses are conditional on the address and on the
 * equipment and only the person selling the job knows. Unticking one does not
 * change the price or the payment the household was quoted — what moves is
 * what the document CLAIMS on somebody's return.
 */
function CreditClaimsFieldset({
  claims,
  creditRates,
  canEdit,
  saving,
  error,
  onToggle,
  note,
}: {
  claims: CreditClaims;
  creditRates: CreditRates;
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  onToggle: (key: keyof CreditClaims) => void;
  note: string;
}) {
  return (
    <fieldset>
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
              onChange={() => onToggle(key)}
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
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
    </fieldset>
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
        strong && "font-semibold",
        strong && "border-t border-border pt-1.5",
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
