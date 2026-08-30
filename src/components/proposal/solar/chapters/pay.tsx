"use client";

import * as React from "react";
import { Chapter, SpecList } from "../primitives";
import { LenderMark } from "@/components/ui/lender-mark";
import { PaymentMenu } from "../../payment-menu";
import { BatteryCredit } from "../../battery-credit";
import { usd, pct, perKwh, loanTermLabel } from "../../format";
import {
  optionMonthlyCents,
  quotedTotalCents,
  type ProposalPaymentOption,
} from "@/lib/solar-proposal";
import type { Doc } from "./doc";

const PRODUCT_LABEL: Record<string, string> = {
  cash: "Cash purchase",
  loan: "Solar loan",
  lease: "Lease",
  ppa: "Power purchase agreement",
};

/**
 * 04 · THE TERMS — how the money works.
 *
 * Split out of the old chapter 4, which carried the price, the payment, the
 * battery credit and the additional services on one sheet that ran to two and a
 * half and printed a `<select>` element into the middle of the PDF.
 *
 * THE MENU DOES NOT PRINT. It is a control, and a control in a document is a
 * dead thing with a chevron on it — the rendered PDF carried an unchecked radio
 * circle and a dropdown arrow beside a lender's name. On screen the rep keeps
 * the switcher; on paper the quoted terms are set as type, and the alternatives
 * are listed as a strip that says what each one costs without pretending to be
 * clickable.
 */
export function ChapterPay({
  doc,
  onSelect,
  showPaymentOptions,
}: {
  doc: Doc;
  onSelect: (key: string) => void;
  showPaymentOptions: boolean;
}) {
  const { s, f, option, options, vpp, credits } = doc;
  const utility = s.energy.utilityProvider ?? "your utility";
  const offerMenu = showPaymentOptions && options.length > 1;

  /** The headline figure, under the scenario the switch is currently on. */
  const monthly = doc.monthlyCents;

  return (
    <Chapter
      id="pay"
      index={doc.num("pay")}
      total={doc.total}
      eyebrow="The terms"
      title={monthly != null ? "What you pay each month" : "What you pay"}
      lede={
        <>
          {PRODUCT_LABEL[f.product] ?? f.product}
          {f.lender ? ` with ${f.lender}` : ""}
          {f.lenderProductLabel ? ` · ${f.lenderProductLabel}` : ""}.
        </>
      }
      rail={
        <div className="space-y-5">
          {/* THE UNCLAIMED-CREDIT WARNING USED TO LIVE HERE, and does not any
              more. On these programmes the credit is claimed and applied as a
              matter of course once the contract is signed, so a red-boxed
              "unless it never happens" beside the payment was warning the
              household about a branch of the deal that does not occur — and it
              was the third time the same sentence appeared on the sheet. No
              caption replaced it either — see the note beside the headline. */}
          {/* The paydown warning. It is the single most consequential sentence
              on this sheet, and it sits beside the two figures it is about. */}
          {f.loanPaydownCents != null && (
            <p className="break-inside-avoid rounded-xl border border-amber-500/40 bg-amber-50 p-3.5 text-[0.8rem] leading-relaxed text-amber-900">
              <strong className="font-semibold">Read this one twice:</strong> the lower payment
              assumes the paydown shown is applied to the loan by the month stated. If it is not,
              the payment becomes the higher figure for the rest of the term.
            </p>
          )}

          {/* WHAT THE HOUSEHOLD ENDS UP OWNING, in this partner's own words.
              Here because a rep can switch the comparison chapter off, and a
              claim about ownership, term, transfer and buyout is not something
              a document may lose along with a table. */}
          {f.ownershipNote && (
            <div className="break-inside-avoid">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                What you own
              </h3>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-neutral-600">
                {f.ownershipNote}
              </p>
            </div>
          )}

          {options.length > 1 && showPaymentOptions && (
            <div className="break-inside-avoid">
              <AlternativesStrip
                options={options}
                selectedKey={option.key}
                creditsApplied={!!credits?.on}
              />
              <p className="mt-3 text-[0.8rem] leading-relaxed text-neutral-500">
                Every option is priced for this system and this address. They differ in what the
                money costs, not in what gets installed — the panels, the inverter and the
                production are the same whichever you choose.
              </p>
            </div>
          )}
        </div>
      }
    >
      {/* ── the figure, and the bill that does not go away ────────────────
          Side by side, not stacked. A proposal that shows a monthly payment and
          stops there implies the utility bill went to zero, and it never does —
          so the sentence that says otherwise sits level with the number it
          qualifies rather than underneath it, where a reader who has already
          seen what they wanted to see never reaches it. */}
      <div className="grid gap-x-10 gap-y-5 @[40rem]:grid-cols-[auto_minmax(0,1fr)] @[40rem]:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            {monthly != null
              ? f.loanPaymentApproved
                ? "Your monthly payment"
                : "Estimated monthly payment"
              : "Due at completion"}
          </p>
          <p className="mt-2 font-display text-[clamp(2.6rem,5.6vw,3.9rem)] font-semibold leading-none tracking-[-0.035em] tabular-nums text-neutral-950">
            {/* On cash the headline IS the price — the household's own, the
                same figure the cost sheet leads on. See `quotedTotalCents`. */}
            {monthly != null ? usd(monthly, 0) : usd(quotedTotalCents(f) ?? 0)}
            {monthly != null && (
              <span className="ml-1 font-sans text-lg font-medium text-neutral-400">/mo</span>
            )}
          </p>
          {/* NO CAPTION NAMING THE OTHER SCENARIO. It used to read "With your
              federal tax credits applied. Until they are claimed and applied to
              the loan, the payment is $355.78 a month." — a sentence that hands
              a household two payments and asks them to hold both. The switch is
              the choice: whichever way it is thrown, this sheet quotes THAT
              deal completely — its payment, its amount financed, its thirty
              years — and says nothing about the other one. */}
        </div>
        <div>
          {/* An offset under 100% means grid power is still bought every month,
              and even at full offset the utility bills its standing meter
              charge — which is why this figure is grid power PLUS that fee and
              cannot read $0. */}
          <p className="text-[0.92rem] leading-relaxed text-neutral-600">
            plus about{" "}
            <strong className="font-semibold tabular-nums text-neutral-900">
              {usd(option.postSolarMonthlyCents, 0)}
            </strong>{" "}
            a month that {utility} still bills you — the grid power the system does not cover, and
            their fixed meter charge, which is billed whatever your roof produces.
          </p>
          {f.lender && (
            <div className="mt-3 flex items-center gap-2.5">
              <LenderMark name={f.lender} logoUrl={f.lenderLogoUrl} size="md" />
              <span className="text-sm font-medium text-neutral-600">{f.lender}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── the terms ───────────────────────────────────────────────────── */}
      <div className="mt-6">
        <SpecList
          dense
          /* Option, Lender and Price per watt used to be rows here. The first
             two are the lede of this very chapter — "Solar loan with Amos
             Capital Fund" — and the third is on the cost sheet, in the table
             the contract price is read from. Three rows of a table restating
             what is already on the page is how a document gets long without
             getting clearer, and dropping them is what let this chapter fit a
             sheet again. */
          items={[
            [
              "Term",
              f.termYears != null
                ? `${f.termYears} years`
                : f.loanTermMonths != null && f.loanTermMonths > 0
                  ? loanTermLabel(f.loanTermMonths)
                  : null,
            ],
            ["APR", f.aprPct != null ? pct(f.aprPct) : null],
            ["Annual increase", f.escalatorPct != null ? pct(f.escalatorPct) : null],
            [
              "Rate",
              f.rateMillsPerKwh != null ? perKwh(f.rateMillsPerKwh) : null,
            ],
            /* WHAT THE PAYMENT DIVIDES INTO. Shown only where it says something
               the price chapter does not: on a deal carrying a programme
               contribution, and on the rare deal with money down. Elsewhere it
               is the total price again under a second name. */
            /* WHAT THE PAYMENT DIVIDES INTO, under the scenario on screen —
               `doc.financedAmountCents`, never the snapshot's own field, which
               is the contract whichever way the switch is thrown. It printed
               $128,080 beside a $161.33 payment until 2026-08-30. */
            [
              "Amount financed",
              doc.financedAmountCents != null &&
              (doc.adjustment != null ||
                doc.financedAmountCents !== f.contractPriceCents)
                ? usd(doc.financedAmountCents)
                : null,
            ],
          ]}
        />
      </div>

      {/* The payment if the paydown is never made, directly beneath the one
          that assumes it is. Printing only the low figure is the most
          misleading thing a solar document can do — a customer who never
          applies the credit finds out from a bank statement. */}
      {(f.loanMonthlyWithoutPaydownCents != null || f.loanPaydownCents != null) && (
        <div className="mt-6">
          <SpecList
            items={[
              [
                f.loanPaydownMonths != null
                  ? `Monthly if the paydown is not made by month ${f.loanPaydownMonths}`
                  : "Monthly without the paydown",
                f.loanMonthlyWithoutPaydownCents != null
                  ? usd(f.loanMonthlyWithoutPaydownCents, 2)
                  : null,
              ],
              [
                f.loanPaydownMonths != null
                  ? `Paydown due by month ${f.loanPaydownMonths}`
                  : "Paydown",
                f.loanPaydownCents != null ? usd(f.loanPaydownCents) : null,
              ],
            ]}
          />
        </div>
      )}

      {/* WHAT THE BATTERY EARNS, next to the payment it offsets. Here rather
          than in the comparison chapter because this is the chapter about what
          the household pays each month, and because a rep can turn that chapter
          off — the credit was priced into this deal either way and must not
          disappear with a table. */}
      {vpp.length > 0 && (
        <div className="mt-5">
          <BatteryCredit
            vpp={vpp}
            monthlyCents={doc.monthlyCents}
            lender={f.lender}
            /* This chapter is PAPER. The card was written for the dark cost
               sheet and printed pale grey on cream when it moved here. */
            tone="paper"
          />
        </div>
      )}

      {/* The menu is a CONTROL, so it never prints — see the note above. */}
      {options.length > 1 && showPaymentOptions && (
        <div className="mt-10 print:hidden">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Change how you pay
          </p>
          <PaymentMenu
            options={options}
            selectedKey={option.key}
            onSelect={onSelect}
            showMenu={offerMenu}
            creditsApplied={!!credits?.on}
          />
        </div>
      )}
    </Chapter>
  );
}

/**
 * The alternatives as TYPE rather than as a control.
 *
 * The menu above is hidden on paper, and a printed document that simply loses
 * the other options is a worse record of what was offered than the one it
 * replaced. This is the same list, stated: what each one is called, and what it
 * costs a month.
 */
function AlternativesStrip({
  options,
  selectedKey,
  creditsApplied,
}: {
  options: ProposalPaymentOption[];
  selectedKey: string;
  /**
   * Read on EVERY row, not only the quoted one: a strip that switched the
   * chosen option's payment and left the alternatives at their unswitched
   * figures would be inviting a comparison between two different scenarios.
   */
  creditsApplied: boolean;
}) {
  return (
    <div className="break-inside-avoid">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        Every way you can pay
      </p>
      <dl className="mt-2.5 divide-y divide-neutral-900/8 border-y border-neutral-900/12">
        {options.map((o) => {
          const monthly = optionMonthlyCents(o, creditsApplied);
          return (
            <div
              key={o.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5"
            >
              <dt className="text-[0.8rem] text-neutral-600">
                {o.label}
                {o.key === selectedKey && (
                  <span className="ml-2 rounded-full bg-[var(--proposal-accent)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--proposal-accent)]">
                    quoted
                  </span>
                )}
              </dt>
              <dd className="text-right text-[0.85rem] font-medium tabular-nums text-neutral-900">
                {monthly != null
                  ? `${usd(monthly, 0)}/mo`
                  : /* The price, not the paper — see `quotedTotalCents`. */
                    usd(quotedTotalCents(o.financing) ?? 0)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
