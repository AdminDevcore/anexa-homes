"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Chapter, DarkRow } from "../primitives";
import { usd, pct } from "../../format";
import type { Doc } from "./doc";

/**
 * WHAT THE CONTRACT IS, AND WHAT COMES OFF IT — as one bar.
 *
 * The ladder is arithmetic a reader checks row by row, and it stays a table
 * underneath for exactly that. What the table cannot do is show PROPORTION: a
 * household reading "$48,400" and "−$14,520" has to hold both in their head to
 * learn that most of the contract is still theirs to pay. One segmented bar
 * says it before the figures are read.
 *
 * Segments are the contract split into what the household actually pays and
 * what is taken off it, so the whole bar is the contract and the parts sum to
 * it exactly. Nothing is scaled to make a segment look bigger than it is.
 *
 * A 2px gap in the plate's own ground between segments, so two adjacent fills
 * never touch and read as one.
 */
function LadderBar({
  contractCents,
  netCents,
  creditCents,
  incentiveCents,
}: {
  contractCents: number;
  netCents: number;
  creditCents: number;
  incentiveCents: number;
}) {
  if (contractCents <= 0) return null;
  const seg = (cents: number) => `${Math.max(0, (cents / contractCents) * 100)}%`;
  const parts = [
    { key: "net", label: "What you pay", cents: netCents, className: "bg-white" },
    { key: "credit", label: "Tax credits", cents: creditCents, className: "bg-[var(--proposal-accent)]" },
    {
      key: "incentive",
      label: "Incentive",
      cents: incentiveCents,
      className: "bg-[var(--proposal-accent)]/45",
    },
  ].filter((p) => p.cents > 0);

  return (
    <div>
      <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded-[3px]">
        {parts.map((p) => (
          <div
            key={p.key}
            className={cn(
              "h-full first:rounded-l-[3px] last:rounded-r-[3px]",
              "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
              p.className,
            )}
            style={{ width: seg(p.cents) }}
            aria-hidden
          />
        ))}
      </div>
      {/* Direct labels, because colour is never the only thing carrying
          identity — and because the segment widths are the argument.

          ON ONE LINE, at reading size. They were stacked figures in 24px
          display type until 2026-08-30, which was the right weight when this
          bar opened the sheet and the only other statement of the same three
          numbers was thirty rows below it. The table now sits directly
          underneath, so the same figures at that size were a heading for a
          table that repeats them — and the fifty pixels they cost were the
          difference between this chapter fitting its sheet and printing a
          second one. */}
      <dl className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        {parts.map((p) => (
          <div key={p.key} className="flex items-baseline gap-2">
            <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
                  p.className,
                )}
                aria-hidden
              />
              {p.label}
            </dt>
            <dd className="font-display text-base font-semibold tabular-nums text-white">
              {usd(p.cents)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * 03 · YOUR INVESTMENT — what the system costs.
 *
 * The old chapter 4 carried the price AND the payment AND the battery credit
 * AND the additional services, ran to two and a half sheets, and printed a
 * `<select>` element into the middle of the PDF. It is now two chapters that
 * each answer one question: this one says what the thing costs, and the next
 * says how the money works.
 *
 * WHAT THIS CHAPTER QUOTES IS THE PRICE — the ordinary one, at the top, on
 * every deal. System price, plus additional work, equals the total, at so many
 * dollars a watt. A household can check every one of those four figures against
 * the last quote they were given, and that is the point of them.
 *
 * On a deal carrying a programme contribution the contract is written for more
 * than that price, and the reconciliation is a SECOND BLOCK underneath: the
 * contract, the federal credits earned on it, the incentive that hands back the
 * remainder, and the price above arrived at again from the other direction.
 *
 * THAT ORDER IS THE 2026-08-30 CHANGE and it is worth recording why, because
 * this page has now been through three arrangements. Until 2026-08-29 it added
 * the contribution to the system price as a line item — $70,000 added to a
 * $58,080 system — which is arithmetic a reader can check and the one reading
 * of the deal that is both intuitive and false. So the contribution went inside
 * the price and the page opened on the contract instead, whole, with the
 * credits bringing it down. That fixed the false reading and introduced a
 * quieter one: the page now opened on "System price $118,400 · $13.45 per watt"
 * for a household quoted $48,400 at $5.50, a figure matching nothing they had
 * been told and nothing they could compare against another quote — the market
 * is three to six dollars a watt — with every credit under it reading as an
 * apology for the number above rather than as the mechanism.
 *
 * The price leads. The contract keeps its block, in full, and nothing is
 * hidden: the same five figures are printed, in the same order, under a heading
 * that says what they are. The funder's submission summary still leads with the
 * contract, because that is the number its file reviewer is checking.
 */
export function ChapterCost({ doc }: { doc: Doc }) {
  const { f, ladder, adjustment, isPurchase, systemPriceCents, showcased } = doc;
  const { quotedTotalCents: totalCents, quotedPpwCents: ppwCents } = doc;

  const creditTotal = ladder ? ladder.credits.reduce((n, c) => n + c.amountCents, 0) : 0;

  /**
   * Whether the total gets a row of its own.
   *
   * Only where it says something the system-price row does not — because there
   * is additional work between them to total UP, or because the two figures
   * genuinely differ. Without either it is the system price again under a
   * second name, and the row above carries the emphasis instead.
   */
  const showTotal =
    totalCents != null && (f.adderTotalCents != null || systemPriceCents !== totalCents);

  return (
    <Chapter
      id="cost"
      index={doc.num("cost")}
      total={doc.total}
      eyebrow="Your investment"
      title="What the system costs"
      lede={
        ladder ? (
          <>
            Your price is at the top. Underneath it is the contract the system is financed against,
            and every credit that brings it back down to that price.
          </>
        ) : undefined
      }
      tone="dark"
      rail={
        <div className="space-y-6">
          {/* THE PROGRAMME THIS DEAL WENT OUT ON, NAMED. Every word is the
              administrator's; the app supplies the layout. */}
          {adjustment && (
            <div className="break-inside-avoid">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                {f.lender ? `${f.lender} — ${adjustment.label}` : adjustment.label}
              </h3>
              <p className="mt-2.5 text-[0.8rem] leading-relaxed text-neutral-400">
                {adjustment.disclosure}
              </p>
              {/* A statement about THIS PAGE's arithmetic — the sentence that
                  says which figure the payment came off, checkable by the
                  reader against the rows beside it. It said the opposite until
                  2026-08-29, when the document moved onto the contract. */}
              <p className="mt-2 text-[0.8rem] leading-relaxed text-neutral-500">
                The payment and amount financed on the next page are calculated from the{" "}
                {usd(adjustment.lenderContractValueCents)} contract.
              </p>
            </div>
          )}
        </div>
      }
    >
      {/* ── the price, checkable row by row ───────────────────────────── */}
      <dl className="break-inside-avoid divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        {isPurchase && systemPriceCents != null && (
          <DarkRow k="System price" v={usd(systemPriceCents)} strong={!showTotal} />
        )}

        {/*
          The extra work, named where we have the names.

          A homeowner reading "Additional work — $14,500" on an $82,660
          contract, alone at their kitchen table with nobody to ask, has one
          obvious question and no way to answer it. Proposals generated before
          v3 carry the total and no lines and keep rendering exactly as they
          did — back-filling names onto one would be inventing a breakdown for
          money nobody itemised at the time.
        */}
        {isPurchase &&
          f.adderTotalCents != null &&
          (f.adders?.length ? (
            <>
              {f.adders.map((a, i) => (
                <DarkRow key={`${a.label}-${i}`} k={a.label} v={usd(a.amountCents)} muted />
              ))}
              <DarkRow k="Additional work" v={usd(f.adderTotalCents)} />
            </>
          ) : (
            <DarkRow k="Additional work" v={usd(f.adderTotalCents)} />
          ))}

        {/* THE TOTAL — the household's own, and only where it says something
            the system-price row does not. See `showTotal`. It was labelled
            "Total contract price" and carried the contract's own figure until
            2026-08-30; the contract now has its own block below, where the word
            means what it says. */}
        {isPurchase && showTotal && <DarkRow k="Total price" v={usd(totalCents!)} strong />}
        {/* PER WATT ON THE PRICE ABOVE, so the two figures divide into each
            other. `f.finalPpwCents` is the same arithmetic on the contract —
            $13.45/W on a system quoted at $5.50 — and it stays with the
            contract, on the funder's summary. */}
        {isPurchase && ppwCents != null && ppwCents > 0 && (
          <DarkRow k="Price per watt" v={`$${(ppwCents / 100).toFixed(2)}/W`} />
        )}

        {/* Third-party block — a lease has a monthly and a PPA has a rate, and
            neither has a system price. Nothing crosses over. */}
        {f.monthlyPaymentCents != null && (
          <DarkRow k="Monthly payment" v={usd(f.monthlyPaymentCents, 2)} strong />
        )}
        {f.rateMillsPerKwh != null && (
          <DarkRow k="Rate" v={`$${(f.rateMillsPerKwh / 1000).toFixed(3)} per kWh`} strong />
        )}

      </dl>

      {/* ── THE CONTRACT, AND WHAT COMES OFF IT ─────────────────────────────
          A block of its own, under the price, on the deals that carry one.

          Every row is arithmetic the reader can check against the one above it,
          which is why the figures are frozen together in `solar-credit-ladder`
          and asserted to subtract before the document is allowed to generate.
          The last row lands back on the price at the top of the sheet — that
          equality IS the ladder's feature, and putting the two within a reader's
          eyeline of each other is the whole reason this block moved down here
          rather than to a page of its own. */}
      {ladder && (
        <section className="mt-6 break-inside-avoid">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
            How it is financed
          </h3>
          {/* NO PARAGRAPH HERE. The rail beside this block already carries the
              partner's own disclosure naming the programme and the contract,
              and the rows below are the arithmetic. A third telling of the same
              thing cost thirty pixels the sheet does not have. */}
          <div className="mt-4">
            <LadderBar
              contractCents={ladder.contractValueCents}
              netCents={ladder.netCostCents}
              creditCents={creditTotal}
              incentiveCents={ladder.incentiveCents}
            />
          </div>

          <dl className="mt-4 break-inside-avoid divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <DarkRow k="Contract value" v={usd(ladder.contractValueCents)} />
            {ladder.credits.map((c) => (
              <DarkRow
                key={c.key}
                k={`${c.label} (${pct(c.pct)})`}
                v={`−${usd(c.amountCents)}`}
                muted
              />
            ))}
            {/* The subtotal, but only where it says something the rows do not.
                With no credits claimed it would repeat the contract value. */}
            {ladder.credits.length > 0 && (
              <DarkRow k="After tax credits" v={usd(ladder.afterCreditsCents)} />
            )}
            {/* DROPPED, not printed at zero, when the credits alone already
                take the contract below the price this system was quoted at —
                there is nothing to hand back, and a "$0 incentive" row reads as
                an offer that was withheld. */}
            {ladder.incentiveCents > 0 && (
              <DarkRow k={ladder.incentiveLabel} v={`−${usd(ladder.incentiveCents)}`} muted />
            )}
            <DarkRow k="What you pay" v={usd(ladder.netCostCents)} strong />
          </dl>

          {/* THE CAVEAT, in the company's own words, and never optional under a
              block of tax-credit arithmetic. A credit is claimed on the reader's
              return and depends on their liability; the rows above are what the
              credits are WORTH, not a discount anybody has applied. Directly
              under the arithmetic rather than in the rail beside it — the rail
              was carrying the partner's disclosure as well and the two together
              ran the sheet over by fifty pixels, which printed a page holding
              one paragraph. */}
          <p className="mt-3.5 break-inside-avoid rounded-xl border border-amber-400/30 bg-amber-400/10 p-3.5 text-[0.82rem] leading-relaxed text-amber-200">
            {ladder.disclaimer}
          </p>
        </section>
      )}

      {/*
        ADDITIONAL SERVICES — the extra work, in sentences rather than as a
        figure in a column. The breakdown above answers "what am I paying for".
        It does not answer "what IS that", and a homeowner reading "Full Service
        Upgrade — $3,500" at their kitchen table has no way to find out. Only
        the lines the company chose to explain appear here.
      */}
      {isPurchase && showcased.length > 0 && (
        <div className="mt-8 break-inside-avoid">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Additional services
          </h3>
          <ul className="mt-3 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            {showcased.map((a, i) => (
              <li
                key={`${a.label}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-white">{a.label}</span>
                  {a.description && (
                    <span className="mt-1 block text-sm leading-relaxed text-neutral-400">
                      {a.description}
                    </span>
                  )}
                </span>
                <span className="font-medium tabular-nums text-white">{usd(a.amountCents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            Included in the total price above — these are not extras billed later.
          </p>
        </div>
      )}
    </Chapter>
  );
}
