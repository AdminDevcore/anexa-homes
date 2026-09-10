"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  buildCreditLadder,
  CREDIT_HINT,
  CREDIT_LABEL,
  SIGN_TODAY_LABEL,
  type CreditClaims,
  type CreditRates,
} from "@/lib/solar-credit-ladder";
import {
  setSolarCreditClaimsAction,
  setSolarSignTodayCreditAction,
} from "@/server/modules/solar/actions";

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
  signTodayCreditCents,
  canEdit,
}: {
  leadId: string;
  /** What the system was priced at — the figure the credits come off. */
  customerContractCents: number;
  /** The company's percentages, from Settings → Solar. */
  creditRates: CreditRates;
  /** Which credits this job earns, as last saved. */
  claims: CreditClaims;
  /** The closing credit typed on this deal, cents. Zero on nearly all. */
  signTodayCreditCents: number;
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
   * THE TYPED CREDIT, held as the text in the box rather than as cents.
   *
   * A number kept in cents and formatted back on every keystroke fights the
   * person typing it — "1500" becomes "$1,500" becomes an un-editable string
   * the moment they try to delete a digit. The box holds what they typed; the
   * ladder beside it reads the parsed value live; the save happens when they
   * leave the field.
   */
  const [signDraft, setSignDraft] = React.useState(() => centsToInput(signTodayCreditCents));
  const [seenSign, setSeenSign] = React.useState(signTodayCreditCents);
  if (seenSign !== signTodayCreditCents) {
    setSeenSign(signTodayCreditCents);
    setSignDraft(centsToInput(signTodayCreditCents));
  }
  const signCents = inputToCents(signDraft);

  /** On blur, and only when it actually moved — no save for a visit. */
  const commitSign = () => {
    if (signCents === signTodayCreditCents) {
      // Re-normalise what is in the box anyway: "1,500." and "1500" are the
      // same amount, and the field should settle on one of them.
      setSignDraft(centsToInput(signTodayCreditCents));
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await setSolarSignTodayCreditAction({ leadId, cents: signCents });
      if (!res.ok) {
        setSignDraft(centsToInput(signTodayCreditCents));
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
    signTodayCreditCents: signCents,
  });

  const fieldset = (
    <CreditClaimsFieldset
      claims={claims}
      creditRates={creditRates}
      canEdit={canEdit}
      saving={saving}
      error={error}
      onToggle={toggle}
      signDraft={signDraft}
      onSignChange={setSignDraft}
      onSignCommit={commitSign}
      note="This is what the proposal's tax-credit switch claims on their behalf. Neither the credits nor the closing credit change the price or the payment they were quoted."
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
          Credits &amp; incentives
        </h3>
        <span className="text-[11px] text-muted-foreground">
          Credit percentages set in Settings → Solar
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
              {/* Last, because it comes off last — and only where one was
                  typed. A "$0" row on the ordinary deal is a discount the
                  household can see was considered and withheld. */}
              {ladder.signTodayCents > 0 && (
                <Row
                  k={ladder.signTodayLabel}
                  v={`−${money(ladder.signTodayCents)}`}
                  muted
                />
              )}
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
 * equipment and only the person selling the job knows. Switching one off does
 * not change the price or the payment the household was quoted — what moves is
 * what the document CLAIMS on somebody's return.
 *
 * A SWITCH PER CREDIT, NOT A TICK-BOX. A tick-box reads as a form somebody
 * fills in and submits; these three are live settings on the deal that re-price
 * the ladder beside them the moment they move, and the document's own
 * tax-credit control is a switch too. Same gesture on the rep's screen as on
 * the customer's page.
 */
function CreditClaimsFieldset({
  claims,
  creditRates,
  canEdit,
  saving,
  error,
  onToggle,
  signDraft,
  onSignChange,
  onSignCommit,
  note,
}: {
  claims: CreditClaims;
  creditRates: CreditRates;
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  onToggle: (key: keyof CreditClaims) => void;
  /** What is in the closing-credit box, as typed. */
  signDraft: string;
  onSignChange: (v: string) => void;
  onSignCommit: () => void;
  note: string;
}) {
  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
        Credits this job earns
      </legend>
      <div className="mt-2 divide-y divide-border/60">
        {(["itc", "energyCommunity", "domesticContent"] as const).map((key) => (
          <CreditToggle
            key={key}
            label={`${CREDIT_LABEL[key]} (${rateFor(creditRates, key)}%)`}
            hint={CREDIT_HINT[key]}
            on={claims[key]}
            disabled={!canEdit || saving}
            readOnly={!canEdit}
            onToggle={() => onToggle(key)}
          />
        ))}
        {/* AN AMOUNT, NOT A SWITCH, and last in the list. The three above are
            facts about the job that are either true or not; this is the rep's
            own money on this deal, and how much of it is the whole decision.
            In the same list because a household reads one column of things
            coming off their price, not a federal list and a private one. */}
        <SignTodayField
          value={signDraft}
          disabled={!canEdit || saving}
          readOnly={!canEdit}
          onChange={onSignChange}
          onCommit={onSignCommit}
        />
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

/**
 * One credit, on or off.
 *
 * The label carries the percentage because that is what the switch is worth —
 * a rep flipping "Energy community bonus (10%)" can see the ten points leave
 * the ladder on the left. `htmlFor` on the label so the words are the target
 * too: three small switches in a narrow column are a poor click area on their
 * own, and the text is what a rep is reading when they decide.
 */
function CreditToggle({
  label,
  hint,
  on,
  disabled,
  readOnly,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  /** Also true mid-save, so a second click cannot race the first. */
  disabled: boolean;
  /** No permission to edit — dim the row, rather than look momentarily busy. */
  readOnly: boolean;
  onToggle: () => void;
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0",
        readOnly && "opacity-70"
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            "block text-[12px] font-medium leading-snug text-foreground",
            !readOnly && "cursor-pointer"
          )}
        >
          {label}
        </label>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        size="sm"
        checked={on}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="mt-0.5 data-checked:bg-solar"
      />
    </div>
  );
}

/**
 * THE CLOSING CREDIT, typed.
 *
 * Shaped like the switch rows above it — label, hint, control hard right — so
 * the four read as one list rather than three settings and a form field. The
 * dollar sign lives inside the box rather than in the label, because what the
 * rep is typing IS dollars and a bare number in a column of percentages is
 * exactly the ambiguity that gets a $1,500 credit entered as 1,500%.
 *
 * Saves on blur, not per keystroke: mid-typing, "15" is a real amount and
 * would be written as $15.
 */
function SignTodayField({
  value,
  disabled,
  readOnly,
  onChange,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  readOnly: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0",
        readOnly && "opacity-70"
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            "block text-[12px] font-medium leading-snug text-foreground",
            !readOnly && "cursor-pointer"
          )}
        >
          {SIGN_TODAY_LABEL}
        </label>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Your own credit for signing today. Comes off what they net, never off the price.
        </p>
      </div>
      <div className="relative mt-0.5 shrink-0">
        <span
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground"
        >
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          placeholder="0"
          aria-label={SIGN_TODAY_LABEL}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          // Enter saves without leaving the field, which is how a rep who is
          // still looking at the ladder expects it to land.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="h-8 w-28 rounded-md border border-input bg-background pl-5 pr-2 text-right text-[12px] tabular-nums outline-none focus:border-solar focus:ring-1 focus:ring-solar disabled:opacity-60"
        />
      </div>
    </div>
  );
}

/**
 * What a rep typed, in cents.
 *
 * Forgiving on the way in — "$1,500", "1500", "1,500.00" are one amount — and
 * zero for anything that is not a number, because the alternative is a NaN
 * threaded into a ladder a household reads.
 */
function inputToCents(v: string): number {
  const n = Number(v.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 100), 100_000_00);
}

/** And back out: plain digits, no separators to fight the next keystroke. */
function centsToInput(cents: number): string {
  if (!cents) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
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
