"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, DollarSign, Pencil, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  postDealFeedAction,
  upsertSolarCommissionAction,
} from "@/server/modules/solar/cockpit-actions";
import {
  FinancingTermsPanel,
  type FinancingTerms,
} from "@/components/portal/solar/financing-terms";
import type { SystemDriftRow } from "@/lib/solar-system-of-record";

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdc = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

// The stage bar used to live here. Nothing about it was solar-specific, so it
// now serves both verticals from `deal-stage-bar.tsx` (DealStageBar).

// ---------------------------------------------------------------------------
// 1 · System & money
// ---------------------------------------------------------------------------

/** What the rep is owed on this deal. One row, because it pays once. */
export type CommissionLite = {
  amountCents: number;
  trigger: string | null;
  expectedAt: string | null;
  paidAt: string | null;
};

/** What the commission pays on, unless somebody types something else. */
const DEFAULT_TRIGGER = "M1 funding";

/**
 * What the pay engine says this deal is currently worth to its rep.
 *
 * ESTIMATED, and the word is on the screen. It is what the sale is worth today,
 * not a promise about a cheque: a later deduction or bonus changes the PAYROLL
 * and never comes back and rewrites this. The two disagreeing is normal, and
 * both are true.
 *
 * `fromSnapshot` is the honest half of it. Once a deal is SIGNED the figure
 * comes from the terms frozen at signing and stops moving with the rep's
 * profile; before that it is priced off the profile as it stands today and will
 * move if either changes. A rep reading a number is entitled to know which of
 * those two he is looking at.
 */
export type CommissionEstimate =
  | { state: "estimate"; grossCents: number; netCents: number; basis: string; fromSnapshot: boolean }
  | { state: "needs_review" }
  | { state: "unavailable"; reason: string };

export type SystemMoney = {
  /**
   * WHAT THIS DEAL IS — the signed proposal wherever there is one.
   *
   * These four figures and the equipment under them used to be read straight
   * off the live SolarDesign while the System info slide read them off the
   * frozen proposal, so one deal showed two systems on two tabs of the same
   * page: 24 panels / 10.56 kW / $58,080 here against 25 / 11.00 / $60,500
   * there. Both now come from `resolveReportedSystem`, which is the only way
   * two cards can be guaranteed to agree — by being the same numbers.
   */
  reported: {
    sourceKind: "proposal" | "design";
    /** "Version 13 · signed · Aug 27, 2026", from the server's own formatter. */
    sourceLabel: string;
    sizeKwDc: number;
    year1ProductionKwh: number;
    offsetPct: number;
    moduleLabel: string | null;
    moduleQty: number;
    inverterLabel: string | null;
    batteryLabel: string | null;
    batteryQty: number;
    /** Already money-formatted: a lease reads "/mo", a PPA "/kWh". */
    priceLabel: string;
    /**
     * THE SECOND PRICE ON THE SAME DOCUMENT, cents: what is left of it once
     * the household claims the federal credits this job earns.
     *
     * It sits under the contract on the cost tile rather than replacing it,
     * because both are true and a deal has to be able to state either — the
     * contract is what gets signed, submitted and paid commission on, and the
     * net is what the household finances and what every payment quoted on this
     * deal is worked out from.
     *
     * Null on a lease and a PPA, which own nothing and claim nothing; on a deal
     * a rep has unticked every credit on; and on any proposal frozen before the
     * ladder existed, where the honest answer is that the document does not say.
     */
    netAfterCreditsCents: number | null;
  };
  /**
   * What has moved on the drawing since that version was frozen. Empty on a
   * deal nobody has redrawn — which is the normal case, and the case in which
   * none of this shows.
   */
  drift: SystemDriftRow[];
  product: string | null;
  systemWatts: number;
  basePpwCents: number;
  adderPpwCents: number;
  adderTotalCents: number;
  /**
   * The storage on this job at its catalogue price, which rides ON TOP of the
   * per-watt rate — see `PurchaseInput.batteryPriceCents`. Zero on a deal
   * without one, and on a storage-only deal, where the battery IS the base.
   *
   * It is a rung in its own right because GROSS = BASE + ADDERS + BATTERY. Left
   * off the screen the ladder does not add up to its own total.
   */
  batteryPriceCents: number;
  /** How many, for the rung's label. */
  batteryQty: number;
  grossPpwCents: number;
  grossPriceCents: number;
  dealerFeePct: number;
  dealerFeeCents: number;
  dealerFeePpwCents: number;
  finalPpwCents: number;
  contractPriceCents: number;
  /** The partner's stated final $/W, cents. Null when it publishes none. */
  maxFinalPpwCents: number | null;
  /** Whether that figure is a ceiling or this partner's flat price. */
  finalPpwMode: "cap" | "flat";
  /** True when that rule is what set this price, rather than the base. */
  cappedByLender: boolean;
  lenderName: string | null;
  /**
   * The credits this deal claims and what it leaves the household paying —
   * the rest of the price ladder, on today's design and today's tick-boxes.
   *
   * Null wherever there is nothing to claim. `buildCreditLadder` returns no
   * ladder rather than a ladder of zeroes, and this follows it: a run of "$0"
   * credit rows on a cash deal claiming none is a page inventing an argument.
   */
  credits: {
    lines: { key: string; label: string; pct: number; amountCents: number }[];
    /** The rep's own closing money on this job. Zero shows no row. */
    signTodayCents: number;
    signTodayLabel: string;
    /** The bottom line: the price with all of it taken off. */
    netCostCents: number;
    /** That, per installed watt. Zero on a storage job, which has none. */
    netPpwCents: number;
  } | null;
};

/**
 * The money on a solar deal: what is being sold, at what price, financed by
 * whom, and what the rep makes on it.
 *
 * TWO COLUMNS, NOT ONE STACK. This ran four blocks deep — stat tiles, a spec
 * list, the price ladder, two payment schedules — and then the page added the
 * lender's terms underneath, so the slide was close to two screens tall and
 * the lender's decision (what a coordinator opens it for) sat well below the
 * price (what a rep opens it for). Neither half is long on its own; side by
 * side the whole thing lands in one view.
 */
export function SolarSystemMoneyPanel({
  leadId,
  money,
  financing,
  commission,
  estimate,
  canEdit,
}: {
  leadId: string;
  money: SystemMoney | null;
  /** The lender's own terms. Rendered here rather than as a section below. */
  financing: FinancingTerms | null;
  commission: CommissionLite | null;
  /** The engine's own figure. Null when the viewer may not see rep pay. */
  estimate: CommissionEstimate | null;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-5">
      {money && (
        <>
          {/* Provenance first, in the same words and the same colours the
              System info slide uses. Four numbers with no document named
              against them is exactly how this page came to show two systems
              and look like neither was wrong. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                money.reported.sourceKind === "proposal"
                  ? "border-solar/40 bg-solar/10 text-solar"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              )}
            >
              {money.reported.sourceKind === "proposal" ? "As proposed" : "Working design"}
            </span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {money.reported.sourceLabel}
            </span>
          </div>

          {/* Hairline grid rather than four floating tiles: gap-px over a
              border-coloured backdrop draws one strip on any number of rows, so
              the wrapped 2×2 on a phone reads as the same object as the 1×4. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            <Metric label="System size" value={`${money.reported.sizeKwDc.toFixed(2)} kW`} />
            <Metric
              label="Year-1 production"
              value={`${money.reported.year1ProductionKwh.toLocaleString()} kWh`}
            />
            <Metric label="Offset" value={`${Math.round(money.reported.offsetPct)}%`} />
            {/* TWO PRICES, ONE TILE. The contract leads because it is what was
                signed and what everything downstream — the lender's file, the
                deal's value, the rep's commission — is measured on. The net
                follows it because it is what the household actually pays and
                what the payment on their document is quoted from, and a rep
                asked "so what does it cost them" should not have to open the
                proposal to answer. Dropped where the two are the same figure:
                on a deal claiming nothing there is no ladder at all, the field
                is null, and the tile is the one number it has always been. */}
            <Metric
              label="System cost"
              value={money.reported.priceLabel}
              accent
              sub={
                money.reported.netAfterCreditsCents != null
                  ? `${usd(money.reported.netAfterCreditsCents)} after credits`
                  : undefined
              }
            />
          </div>

          <DriftNotice rows={money.drift} />
        </>
      )}

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <div className="space-y-5">
          {money ? (
            <>
              {/* The equipment as REPORTED, so this list and the System info
                  slide's cannot name different hardware. A battery taken off
                  the drawing after signing does not vanish from the deal — the
                  customer signed for it, and the drift notice above says it
                  moved. */}
              <Block label="System">
                <dl className="divide-y divide-border text-sm">
                  {money.reported.moduleLabel && (
                    <SpecRow
                      k="Modules"
                      v={`${money.reported.moduleQty} × ${money.reported.moduleLabel}`}
                    />
                  )}
                  {money.reported.inverterLabel && (
                    <SpecRow k="Inverter" v={money.reported.inverterLabel} />
                  )}
                  {money.reported.batteryLabel && (
                    <SpecRow
                      k="Battery"
                      v={
                        money.reported.batteryQty > 1
                          ? `${money.reported.batteryQty} × ${money.reported.batteryLabel}`
                          : money.reported.batteryLabel
                      }
                    />
                  )}
                </dl>
              </Block>

              {/*
                The price ladder, rung by rung. Every figure derives from what
                is already stored on the design and finance rows — nothing new
                is entered here.

                THE DEALER FEE IS NOT ON THIS SCREEN, and the gross it is
                measured against went with it. The arithmetic is untouched —
                base plus adders plus the battery is still grossed up by the
                lender's cut to reach the final price, and `money.dealerFeeCents`
                still carries it for anything that needs it — but the deal page
                shows what the job sells for, not what the lender takes out of
                it. Gross had to go too: final minus gross IS the fee, so
                leaving that rung standing would have hidden the label and
                published the number. The percentage is still set, and still
                read, on the partner's rate sheet in Settings → Lenders.
              */}
              <Block label="Pricing breakdown">
                <dl data-testid="pricing-breakdown" className="divide-y divide-border text-sm">
                  <SpecRow k="Base price" v={`${usdc(money.basePpwCents)}/W`} />
                  <SpecRow
                    k="Adders"
                    v={`${usdc(money.adderPpwCents)}/W${money.adderTotalCents > 0 ? ` · ${usd(money.adderTotalCents)}` : ""}`}
                  />
                  {/* Only where there is one — the same rule the builder's own
                      ladder uses. A "$0" battery rung on the four deals in five
                      without storage is a row a rep reads to learn nothing. No
                      $/W: a rate per watt is a price for an ARRAY, and the
                      whole reason this line exists is that no arithmetic over
                      installed watts can charge for a Powerwall. */}
                  {money.batteryPriceCents > 0 && (
                    <SpecRow
                      k={money.batteryQty > 1 ? `Batteries × ${money.batteryQty}` : "Battery"}
                      v={usd(money.batteryPriceCents)}
                    />
                  )}
                  <div className="flex items-center justify-between gap-4 py-1.5 font-semibold">
                    <dt>Final price</dt>
                    <dd className="tabular-nums text-solar">
                      {usdc(money.finalPpwCents)}/W · {usd(money.contractPriceCents)}
                    </dd>
                  </div>
                  {/*
                    THE LADDER DOES NOT END AT THE CONTRACT ANY MORE.

                    The credits come off the price and the household finances
                    what is left, so the contract is the price they SIGN and the
                    net is the price they PAY — and a breakdown that stopped at
                    the first was quoting a rep a figure that no payment on the
                    deal, on the shelf or on the customer's own document divides
                    into. Same rungs, same arithmetic, same order the builder's
                    card and the proposal both draw them in.

                    These rows change nothing downstream: the contract above is
                    still what the lender is submitted, what the deal is valued
                    at and what the rep is paid on.
                  */}
                  {money.credits && (
                    <>
                      {money.credits.lines.map((c) => (
                        <SpecRow
                          key={c.key}
                          k={`${c.label} (${c.pct}%)`}
                          v={`−${usd(c.amountCents)}`}
                        />
                      ))}
                      {/* Only where a rep actually offered one. A "$0 sign
                          today credit" is a discount the reader can see was
                          considered and withheld. */}
                      {money.credits.signTodayCents > 0 && (
                        <SpecRow
                          k={money.credits.signTodayLabel}
                          v={`−${usd(money.credits.signTodayCents)}`}
                        />
                      )}
                      <div className="flex items-center justify-between gap-4 py-1.5 font-semibold">
                        <dt>After credits</dt>
                        <dd className="tabular-nums text-solar">
                          {money.credits.netPpwCents > 0 && (
                            <>{usdc(money.credits.netPpwCents)}/W · </>
                          )}
                          {usd(money.credits.netCostCents)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                {/* The one thing left that a rep still cannot read off the
                    rungs: the battery is a catalogue PRICE, not a rate over
                    installed watts, so it does not move with the $/W above it.
                    Said once here rather than as a hint on the row. */}
                {money.batteryPriceCents > 0 && (
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    The battery is billed at its catalogue price, on top of what the array itself
                    is priced per watt.
                  </p>
                )}
                {/* WHAT THE NET IS AND IS NOT. Two prices on one ladder invite
                    exactly one misreading — that we invoice the lower one — and
                    it is the misreading that ends up in front of a homeowner.
                    Said here, once, rather than hinted at on the row. */}
                {money.credits && (
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    The credits are claimed on the household&rsquo;s own federal return, not
                    taken off our invoice. The contract stays{" "}
                    {usd(money.contractPriceCents)} — the net is what they finance, and what the
                    payment on their proposal is quoted from.
                  </p>
                )}
                {/* WHICH SYSTEM THIS LADDER PRICED. The rungs are the company's
                    own arithmetic and were never frozen into the customer's
                    document, so they can only ever price the current drawing.
                    Silent, that puts a second contract total on the same card as
                    the one above it — which is the whole defect this notice
                    exists to close. */}
                {money.drift.length > 0 && (
                  <p className="mt-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-500">
                    Priced on the current drawing ({(money.systemWatts / 1000).toFixed(2)} kW),
                    not on the version above. Rebuild the proposal to quote this price.
                  </p>
                )}
                {/* A LADDER THE PARTNER SET HAS TO SAY SO. Once the partner's
                    figure decides the price, the base is solved backwards out of
                    it — a rep who typed $3.00/W in the builder reads $1.93/W
                    here. Unexplained that looks like the page has lost the
                    price; named, it is the partner's own rate doing exactly what
                    it was set to do.

                    A FLAT partner is not "held" at anything, it simply sells at
                    one number, and a notice that says "held" invites a rep to go
                    looking for the price it was held down FROM. */}
                {money.cappedByLender && money.maxFinalPpwCents != null && (
                  <p className="mt-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-500">
                    {money.finalPpwMode === "flat" ? (
                      <>
                        {money.lenderName ?? "This lender"} sells at a flat{" "}
                        {usdc(money.maxFinalPpwCents)}/W, fee and adders included — the base above
                        is what is left of it, not a price typed on this deal.
                      </>
                    ) : (
                      <>
                        Held at {money.lenderName ?? "this lender"}&rsquo;s ceiling of{" "}
                        {usdc(money.maxFinalPpwCents)}/W, fee and adders included. The base above
                        is what survives it — not the price typed on the deal.
                      </>
                    )}
                  </p>
                )}
              </Block>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add a system design and financing with <strong>Build Proposal</strong> and the
              numbers appear here.
            </p>
          )}
        </div>

        <div className="space-y-5">
          {financing && (
            <Block label="Financing & lender">
              <FinancingTermsPanel terms={financing} />
            </Block>
          )}
          <Block label="Rep commission">
            <RepCommission leadId={leadId} row={commission} estimate={estimate} canEdit={canEdit} />
          </Block>
        </div>
      </div>
    </div>
  );
}

/** A titled run of rows. Small caps, no rule — the rows carry the structure. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * What the rep makes on this deal.
 *
 * ONE FIGURE. This was two M1/M2 tranches beside two financier draws — four
 * slots, on the assumption that a solar rep is paid down as the lender funds.
 * He is not: he is paid out in full, once. Three of the four were a schedule
 * with nothing to put in it, and every deal in production had all four empty,
 * which made a finished deal look permanently half-entered.
 *
 * The financier's side is not typed here at all. When the lender pays is
 * already the pipeline stage the payroll gate reads (M1 Funding); a second,
 * hand-kept copy of it could only ever disagree with the one that releases the
 * money.
 */
function RepCommission({
  leadId,
  row,
  estimate,
  canEdit,
}: {
  leadId: string;
  row: CommissionLite | null;
  estimate: CommissionEstimate | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return <CommissionForm leadId={leadId} existing={row} onDone={() => setEditing(false)} />;
  }

  const paid = !!row?.paidAt;
  const trigger = row?.trigger?.trim() || DEFAULT_TRIGGER;
  const typed = !!row?.amountCents;
  const est = estimate?.state === "estimate" ? estimate : null;

  /* WHICH FIGURE LEADS.
   *
   * A typed amount always does — somebody put it there deliberately and the
   * screen must not argue with them. With nothing typed the engine's estimate
   * takes the slot, because "Not set" on a fully designed and priced deal is
   * the page declining to answer a question it can answer. */
  const headline = typed ? usd(row!.amountCents) : est ? usd(est.netCents) : "Not set";

  const sub = paid
    ? `Paid ${new Date(row!.paidAt!).toLocaleDateString()}`
    : row?.expectedAt
      ? `Due ${new Date(row.expectedAt).toLocaleDateString()} · pays on ${trigger}`
      : `Pays on ${trigger}`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full",
            paid ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
          )}
        >
          {paid ? <Check className="size-3.5" /> : <DollarSign className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-baseline gap-2 text-sm font-semibold tabular-nums",
              !typed && !est && "font-medium text-muted-foreground"
            )}
          >
            {headline}
            {!typed && est && (
              <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Estimated
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit commission"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>

      <EstimateNote estimate={estimate} typedCents={typed ? row!.amountCents : null} />
    </div>
  );
}

/**
 * The line under the figure that says where it came from.
 *
 * It is deliberately wordy about the SIGNED case. "Estimated" beside a number
 * that can still move means something quite different from the same word beside
 * one that is now fixed by a snapshot, and a rep who cannot tell the two apart
 * will read the first as a promise.
 */
function EstimateNote({
  estimate,
  typedCents,
}: {
  estimate: CommissionEstimate | null;
  typedCents: number | null;
}) {
  if (!estimate) return null;

  if (estimate.state === "needs_review") {
    return (
      <p className="px-1 text-[11px] text-amber-700 dark:text-amber-400">
        This deal signed without resolvable pay terms. An admin has to establish them before it can
        be estimated or paid — payroll will not guess from today&rsquo;s settings.
      </p>
    );
  }

  if (estimate.state === "unavailable") {
    return <p className="px-1 text-[11px] text-muted-foreground">{estimate.reason}</p>;
  }

  const basis = estimate.fromSnapshot
    ? "From the terms frozen when this deal was signed — it no longer moves with the rep's settings."
    : "Priced on the rep's current settings. It will move if the design, the price or those settings change.";

  /* A typed figure that disagrees with the engine is worth saying out loud
     rather than quietly showing the typed one and hiding the other. */
  const disagrees = typedCents != null && Math.abs(typedCents - estimate.netCents) >= 100;

  return (
    <div className="space-y-0.5 px-1 text-[11px] text-muted-foreground">
      {disagrees && (
        <p>
          Engine estimate: <span className="tabular-nums">{usd(estimate.netCents)}</span> — the
          figure above was entered by hand.
        </p>
      )}
      {estimate.grossCents !== estimate.netCents && (
        <p>
          <span className="tabular-nums">{usd(estimate.grossCents)}</span> before the company&rsquo;s
          lead deduction.
        </p>
      )}
      <p>{basis}</p>
    </div>
  );
}

function CommissionForm({
  leadId,
  existing,
  onDone,
}: {
  leadId: string;
  existing: CommissionLite | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState(
    existing?.amountCents ? (existing.amountCents / 100).toString() : ""
  );
  const [trigger, setTrigger] = React.useState(existing?.trigger ?? DEFAULT_TRIGGER);
  const [expected, setExpected] = React.useState(
    existing?.expectedAt ? existing.expectedAt.slice(0, 10) : ""
  );
  const [paid, setPaid] = React.useState(!!existing?.paidAt);

  async function save() {
    setBusy(true);
    // The flag is cleared in a finally: a server action that throws used to
    // leave it latched on, and the form stayed dead until a reload.
    try {
      const res = await upsertSolarCommissionAction({
        leadId,
        amountCents: Math.round(Number(amount || 0) * 100),
        trigger: trigger.trim() || null,
        expectedAt: expected ? new Date(expected).toISOString() : null,
        paid,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Commission saved");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3" data-testid="commission-form">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-[11px] text-muted-foreground">Amount ($)</span>
          <input
            aria-label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[11px] text-muted-foreground">Expected date</span>
          <input
            aria-label="Expected date"
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
      </div>
      <label className="block space-y-0.5">
        <span className="text-[11px] text-muted-foreground">Pays when</span>
        <input
          aria-label="Pays when"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          aria-label="Paid"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
          className="size-4"
        />
        Paid
        <span className="text-muted-foreground">
          — stamps today&rsquo;s date; unticking clears it, so the two never drift
        </span>
      </label>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One drift figure, in the unit it is read in. */
function driftValue(row: SystemDriftRow, n: number) {
  switch (row.unit) {
    case "kw":
      return `${n.toFixed(2)} kW`;
    case "kwh":
      return `${Math.round(n).toLocaleString()} kWh`;
    case "pct":
      return `${Math.round(n)}%`;
    case "cents":
      return usd(n);
    case "count":
      return `${n}`;
  }
}

/**
 * THE DRAWING HAS MOVED SINCE THE VERSION ABOVE, and by how much.
 *
 * Shown only when the two really differ, which on a deal nobody has reopened
 * is never. It exists because the fix for this page reporting two systems was
 * to report ONE — and a card that silently drops the other number is a worse
 * bug than the one it replaced: a rep who redraws a roof would see nothing
 * change anywhere and conclude the builder had not saved.
 *
 * So the frozen figure leads, the working one follows it, and the sentence
 * says which is which. It is not styled as an error: a design moving after a
 * signature is a normal thing that happens on a normal deal, and it needs
 * somebody to decide between reissuing the proposal and putting the drawing
 * back — not a red banner implying the page is broken.
 */
function DriftNotice({ rows }: { rows: SystemDriftRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
        The drawing has changed since this version
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        These figures are what the customer was quoted. The roof as it is drawn today differs —
        rebuild the proposal to sell the new one, or put the drawing back.
      </p>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="text-[11px]">
            <dt className="uppercase tracking-wider text-muted-foreground">{r.label}</dt>
            <dd className="tabular-nums">
              <span className="font-semibold">{driftValue(r, r.proposed)}</span>
              <span className="mx-1 text-muted-foreground">&rarr;</span>
              <span className="text-amber-700 dark:text-amber-400">
                {driftValue(r, r.working)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * One figure in the strip, with an optional second reading UNDER it.
 *
 * The sub-line sits between the value and the label rather than beside the
 * value: a tile is read top-down, and the whole point of the second figure is
 * that it is a consequence of the first, not an alternative to it.
 */
function Metric({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div
        className={cn(
          "font-display text-base font-semibold tabular-nums",
          accent && "text-solar"
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="truncate text-[11px] font-medium tabular-nums text-muted-foreground">
          {sub}
        </div>
      )}
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 · Activity feed
// ---------------------------------------------------------------------------

export type FeedPost = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

/**
 * One stream, like roofing's notes.
 *
 * This feed used to be split three ways — Internal / External / Customer —
 * with a picker on the composer and a filter row above the list. Two of those
 * audiences do not exist: there is no customer portal, so nothing here was ever
 * shown to a homeowner, and "external" and "customer" only ever differed in the
 * colour of their badge. Three tabs to say one thing made every post a small
 * decision with no consequence, and made the feed read as a place you could
 * accidentally publish something. Everything posted here is staff-only.
 *
 * Rows written under the old channels keep their value in the database and
 * still appear in the stream; the column simply stopped being a UI concept.
 */
export function SolarActivityFeed({
  leadId,
  posts,
  canPost,
}: {
  leadId: string;
  posts: FeedPost[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await postDealFeedAction({ leadId, body: body.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.mentioned ? `Posted · ${res.mentioned} notified` : "Posted");
    setBody("");
    router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="solar-activity-feed">
      {canPost && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write an update. Use @Name to notify someone by email."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">Staff only — notes never leave the portal.</p>
            <Button size="sm" onClick={post} disabled={busy || !body.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Post
            </Button>
          </div>
        </div>
      )}

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{p.author}</span>
                <span className="text-muted-foreground">
                  {new Date(p.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The quick-action pill row that used to sit here is gone.
//
// Five pills under the header (View proposal / Edit design / Upload files /
// Tasks / Invite homeowner) each duplicated a control that already lives with
// the thing it acts on, one screen further down: the System Design card, the
// Contracts & documents card, the Review & send card, the activity feed's
// follow-up. Two entry points to one action is a maintenance tax and a reading
// tax. "Invite homeowner" was not moved but DELETED, along with its server
// action — this product has no customer-facing portal, so there is nowhere to
// invite a homeowner to.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The "Deferred" panel is gone.
//
// It held one card, "Project AI assistant — Coming soon", which described work
// belonging to a different programme. A coming-soon tile on a deal page is a
// permanent advert for something a rep cannot use: it takes up the same room as
// working tools and trains people to skip that part of the page. If the
// assistant ships, it earns its place then.
// ---------------------------------------------------------------------------
