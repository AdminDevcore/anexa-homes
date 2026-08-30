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
      <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-[3px]">
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
          identity — and because the segment widths are the argument. */}
      <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        {parts.map((p) => (
          <div key={p.key}>
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
            <dd className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-white">
              {usd(p.cents)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * 04 · YOUR INVESTMENT — what the system costs.
 *
 * The old chapter 4 carried the price AND the payment AND the battery credit
 * AND the additional services, ran to two and a half sheets, and printed a
 * `<select>` element into the middle of the PDF. It is now two chapters that
 * each answer one question: this one says what the thing costs, and the next
 * says how the money works.
 *
 * WHAT THIS CHAPTER QUOTES is the CONTRACT, whole. There was a contribution
 * row here until 2026-08-29 — system price, plus the programme's contribution,
 * equals the contract — and it was arithmetic a reader could check and the
 * wrong thing to put in front of them: printed as a line item it reads as
 * $70,000 added to a $58,080 system, which is the one reading of the deal that
 * is both intuitive and false. The credits bring it back down, below, on the
 * same sheet rather than a page away.
 */
export function ChapterCost({ doc }: { doc: Doc }) {
  const { f, ladder, adjustment, isPurchase, systemPriceCents, showcased } = doc;

  const creditTotal = ladder ? ladder.credits.reduce((n, c) => n + c.amountCents, 0) : 0;

  return (
    <Chapter
      id="cost"
      index={doc.num("cost")}
      total={doc.total}
      eyebrow="Your investment"
      title={ladder ? "One price, and what brings it down" : "What the system costs"}
      lede={
        ladder ? (
          <>
            The contract is written at {usd(ladder.contractValueCents)}. Here is every credit that
            comes off it, and what is left for you.
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
      {ladder && (
        <div className="mb-10">
          <LadderBar
            contractCents={ladder.contractValueCents}
            netCents={ladder.netCostCents}
            creditCents={creditTotal}
            incentiveCents={ladder.incentiveCents}
          />
        </div>
      )}

      {/* ── the price, checkable row by row ───────────────────────────── */}
      <dl className="break-inside-avoid divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        {isPurchase && systemPriceCents != null && (
          <DarkRow
            k="System price"
            v={usd(systemPriceCents)}
            strong={adjustment != null && f.adderTotalCents == null}
          />
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

        {/* THE TOTAL — only where there is something between it and the system
            price for it to total UP. Without additional work it would repeat
            the system price under a second name, and the row above carries the
            emphasis instead. */}
        {isPurchase &&
          f.contractPriceCents != null &&
          (adjustment == null || f.adderTotalCents != null) && (
            <DarkRow
              k={adjustment ? "Total contract price" : "Total price"}
              v={usd(f.contractPriceCents)}
              strong
            />
          )}
        {isPurchase && f.finalPpwCents != null && f.finalPpwCents > 0 && (
          <DarkRow k="Price per watt" v={`$${(f.finalPpwCents / 100).toFixed(2)}/W`} />
        )}

        {/* Third-party block — a lease has a monthly and a PPA has a rate, and
            neither has a system price. Nothing crosses over. */}
        {f.monthlyPaymentCents != null && (
          <DarkRow k="Monthly payment" v={usd(f.monthlyPaymentCents, 2)} strong />
        )}
        {f.rateMillsPerKwh != null && (
          <DarkRow k="Rate" v={`$${(f.rateMillsPerKwh / 1000).toFixed(3)} per kWh`} strong />
        )}

        {/* ── the ladder ─────────────────────────────────────────────────
            Every row is arithmetic the reader can check against the one above
            it, which is why the figures are frozen together in
            `solar-credit-ladder` and asserted to subtract before the document
            is allowed to generate. */}
        {ladder && (
          <>
            {ladder.credits.map((c) => (
              <DarkRow
                key={c.key}
                k={`${c.label} (${pct(c.pct)})`}
                v={`−${usd(c.amountCents)}`}
                muted
              />
            ))}
            {/* The subtotal, but only where it says something the rows do not.
                With no credits claimed it would repeat the contract price. */}
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
          </>
        )}
      </dl>

      {/* THE CAVEAT, in the company's own words, and never optional on a page
          of tax-credit arithmetic. A credit is claimed on the reader's return
          and depends on their liability; the rows above are what the credits
          are WORTH, not a discount anybody has applied. Directly under the
          arithmetic rather than in the rail beside it — the rail was carrying
          the partner's disclosure as well and the two together ran the sheet
          over by fifty pixels, which printed a page holding one paragraph. */}
      {ladder && (
        <p className="mt-5 break-inside-avoid rounded-xl border border-amber-400/30 bg-amber-400/10 p-3.5 text-[0.82rem] leading-relaxed text-amber-200">
          {ladder.disclaimer}
        </p>
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
