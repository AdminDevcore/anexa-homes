"use client";

import * as React from "react";
import { Leaf, TreePine, Factory, Car } from "lucide-react";
import { SOLAR_FAQS, IMPACT_SOURCES } from "@/lib/solar-proposal";
import { Impact, SourceLink, ContactCard } from "../primitives";
import { SavingsScrubber } from "../../savings-scrubber";
import { usd, kwh, pct, loanTermLabel } from "../../format";
import type { Doc } from "./doc";

/**
 * 09 · BACK MATTER — the evidence.
 *
 * Everything the document is required to say and nothing it is trying to argue.
 * The year-by-year table, every assumption, the battery programme's terms, the
 * questions, the EPA equivalences and the disclosures.
 *
 * WHY THIS EXISTS AT ALL. None of it was removed from the document — it was
 * moved off the sheets that make the case. The comparison chapter used to carry
 * the chart, the lifetime figure, the programme block, an assumptions
 * paragraph, a scrubber, a thirty-row table and four footnotes, and it printed
 * as three sheets of which two had no chapter mark on them. A reader met the
 * argument and the audit trail in the same breath and got a worse version of
 * both.
 *
 * It carries NO chapter mark, deliberately. The numbering is a promise about
 * how much argument is left, and this is not argument.
 */
export function BackMatter({ doc }: { doc: Doc }) {
  const { s, sv, f, option, vpp, vppAnnualCents, vppUpfrontCents, vppPayer } = doc;
  const lifetimeKwh = sv.years.reduce((n, y) => n + y.productionKwh, 0);

  return (
    <footer
      data-backmatter
      data-colophon
      className="bg-[#efeae2] px-6 py-16 text-neutral-900 sm:px-10"
    >
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
          The detail behind the figures
        </p>

        {/* ── year by year ───────────────────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            {sv.years.length} years, one year at a time
          </h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-neutral-600">
            Assumes your utility rate rises {pct(s.assumptions.utilityEscalationPct)} a year and
            your panels lose {pct(s.assumptions.annualDegradationPct)} output annually. Both are
            estimates, not guarantees.
          </p>

          {/* Some households read the table as the proof and some read it as a
              wall of numbers; the scrubber is the same model, one year at a
              time. Screen only — on paper the table IS the scrubber. */}
          <div className="print:hidden">
            <SavingsScrubber
              years={sv.years}
              paybackYear={sv.paybackYear}
              vpp={vpp}
              monthlyCents={option.monthlyCents}
            />
          </div>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">
                Projected annual cost with the utility compared with going solar
              </caption>
              <thead className="border-b border-neutral-900/15 text-left text-[11px] uppercase tracking-[0.12em] text-neutral-500">
                <tr>
                  <th scope="col" className="py-2.5 pr-4 font-semibold">
                    Year
                  </th>
                  <th scope="col" className="py-2.5 pr-4 text-right font-semibold">
                    If you stay with the utility
                  </th>
                  <th scope="col" className="py-2.5 pr-4 text-right font-semibold">
                    If you go solar
                  </th>
                  <th scope="col" className="py-2.5 text-right font-semibold">
                    Kept so far
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900/8">
                {sv.years
                  .filter((y) => y.year === 1 || y.year % 5 === 0)
                  .map((y) => (
                    <tr key={y.year} className="break-inside-avoid">
                      <td className="py-2.5 pr-4 tabular-nums text-neutral-500">{y.year}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-700">
                        {usd(y.utilityCostCents)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-700">
                        {usd(y.solarCostCents)}
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-neutral-900">
                        {usd(y.cumulativeSavingsCents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* HOW TO READ THE COLUMN. One template literal per sentence rather
              than prose with expressions sitting in it: where a literal ends in
              a space and an expression follows, the JSX transform keeps only
              ONE of the two spaces and attaches it to the text BEFORE, so
              `all {n} years above` compiles to "all 25years above". */}
          <div className="mt-3 max-w-[72ch] space-y-1.5 text-xs leading-relaxed text-neutral-500">
            <p>
              {`“If you go solar” is the power you still buy from the utility, plus what you pay for the system that year${
                vppAnnualCents > 0
                  ? `, less the ${usd(vppAnnualCents)} a year your battery earns from ${vppPayer}`
                  : ""
              }.`}
            </p>
            {sv.years.some((y) => y.solarCostCents < 0) && (
              <p>
                {`Where that column is a minus figure, the battery is earning more than the power you still buy costs — your electricity pays you that year instead of costing you.`}
              </p>
            )}
            {/* WHAT YEAR ONE MEANS, and it is not the same sentence for both.
                Bought outright, the whole price really does land in year one.
                Financed, it never does — the years carry the payments. */}
            {sv.years[0] != null &&
              sv.years[0].solarPaymentCents > 0 &&
              sv.years[1]?.solarPaymentCents === 0 && (
                <p>
                  {`Year 1 carries the whole price of the system, ${usd(sv.years[0].solarPaymentCents)}, because it is bought outright. Every year after it shows only what the power costs.`}
                </p>
              )}
            {option.monthlyCents != null &&
              sv.years[0] != null &&
              sv.years[0].solarPaymentCents > 0 && (
                <p>
                  {`You pay for the system in twelve payments of ${usd(option.monthlyCents, 2)} a year${
                    f.loanTermMonths != null && f.loanTermMonths > 0
                      ? `, for ${loanTermLabel(f.loanTermMonths)}`
                      : ""
                  } — never the whole price in one year. ${
                    f.loanTermMonths != null &&
                    f.loanTermMonths > 0 &&
                    f.loanTermMonths < sv.years.length * 12
                      ? `From year ${Math.floor(f.loanTermMonths / 12) + 1} it is paid off, and the column shows only what the power costs.`
                      : ""
                  }`.trim()}
                </p>
              )}
            {/* A TERM LONGER THAN THE TABLE. The rows stop at the horizon and a
                30-year loan does not, so the total above is everything the
                household pays inside the window the table draws — not
                everything they pay. */}
            {option.monthlyCents != null &&
              f.loanTermMonths != null &&
              f.loanTermMonths > sv.years.length * 12 && (
                <p>
                  {`Your loan runs ${loanTermLabel(f.loanTermMonths)}, which is longer than the ${sv.years.length} years shown here. The ${
                    f.loanTermMonths - sv.years.length * 12
                  } payments after the last row — about ${usd(
                    (f.loanTermMonths - sv.years.length * 12) * option.monthlyCents,
                  )} — are not in the totals above.`}
                </p>
              )}
          </div>
        </section>

        {/* ── the battery programme ──────────────────────────────────────── */}
        {vpp.length > 0 && (
          <section className="mt-14 break-inside-avoid border-t border-neutral-900/12 pt-10">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              The battery programme, counted above
            </h2>
            <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-neutral-600">
              Its payments are already inside every figure in this document, so without this the
              savings would simply be larger than the arithmetic on the page explains.
            </p>
            <div className="mt-5 space-y-3">
              {vpp.map((v) => (
                <div key={`${v.provider}-${v.programme}`}>
                  <p className="font-display text-lg font-semibold">
                    {v.programme}
                    {v.annualCents > 0 && (
                      <span className="ml-2 tabular-nums">{usd(v.annualCents)}/yr</span>
                    )}
                  </p>
                  {/* An enrolment, not a cheque from the wires company. */}
                  <p className="mt-0.5 text-sm leading-relaxed text-neutral-600">
                    Your battery is enrolled on {v.provider}&rsquo;s network and paid for letting
                    them draw on it when the grid is short
                    {v.batteryQty > 1 ? ` (${v.batteryQty} batteries)` : ""}
                    {v.upfrontCents > 0 ? `, plus ${usd(v.upfrontCents)} when you enrol` : ""}.
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-neutral-900/10 pt-4">
              <span className="text-sm text-neutral-600">
                {`Over the ${sv.years.length} years above${
                  vppAnnualCents > 0
                    ? ` — ${usd(vppAnnualCents)} a year × ${sv.years.length}${
                        vppUpfrontCents > 0 ? `, plus ${usd(vppUpfrontCents)} to enrol` : ""
                      }`
                    : ""
                }`}
              </span>
              <span className="font-display text-2xl font-bold tabular-nums">
                {/* Straight off the model, so it agrees with the table to the
                    cent. Safe to read directly: a snapshot old enough to lack
                    this total is old enough to have no `vpp` either. */}
                {usd(sv.vppCreditTotalCents)}
              </span>
            </div>
            <p className="mt-4 max-w-[68ch] text-xs leading-relaxed text-neutral-500">
              {`Counted for all ${sv.years.length} years above at today’s rate. Enrolment is between you and ${
                vpp.length === 1 ? vpp[0].provider : "your provider"
              }, and the programme’s terms are theirs to change — these payments are an estimate on the same footing as the rest of this document, not a guarantee.`}
            </p>
          </section>
        )}

        {/* ── what it does beyond the bill ───────────────────────────────── */}
        <section className="mt-14 break-inside-avoid border-t border-neutral-900/12 pt-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            And what it does beyond the bill
          </h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-neutral-600">
            Over the {sv.years.length} years modelled, your system is projected to generate{" "}
            <strong className="font-semibold text-neutral-900">{kwh(lifetimeKwh)}</strong> of
            electricity that does not have to be burned into existence.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
            <Impact
              i={0}
              icon={Leaf}
              value={s.environmental.tonsCo2Avoided.toLocaleString()}
              label="tons CO₂ avoided"
              source={IMPACT_SOURCES.co2}
            />
            <Impact
              i={1}
              icon={TreePine}
              value={s.environmental.treesEquivalent.toLocaleString()}
              label="trees planted, equivalent"
              source={IMPACT_SOURCES.trees}
            />
            <Impact
              i={2}
              icon={Factory}
              value={s.environmental.poundsCoalAvoided.toLocaleString()}
              label="lbs coal not burned"
              source={IMPACT_SOURCES.coal}
            />
            <Impact
              i={3}
              icon={Car}
              value={s.environmental.milesNotDriven.toLocaleString()}
              label="miles not driven"
              source={IMPACT_SOURCES.miles}
            />
          </div>

          {/*
            The only one of these that is about money, and the only one that is
            a CLAIM rather than an arithmetic equivalence. Shown only when the
            company has set a figure it is willing to stand behind, and only on
            OWNED systems: a lease or a PPA is somebody else's equipment on your
            roof, and the studies behind this number are about houses that own
            theirs.
          */}
          {s.assumptions.homeValueUpliftPct != null &&
            s.assumptions.homeValueUpliftPct > 0 &&
            doc.isPurchase && (
              <div className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-neutral-900/12 pt-6">
                <div className="min-w-[16rem] flex-1">
                  <p className="font-display text-lg font-semibold tracking-tight">
                    And it stays with the house
                  </p>
                  <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-neutral-600">
                    Homes with an owned solar system have sold for a premium over comparable homes
                    without one. Your own market, condition and buyer decide what that is worth
                    here — it is not a guarantee, and no part of this proposal depends on it.
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl font-semibold leading-none tracking-tight">
                    {pct(s.assumptions.homeValueUpliftPct)}
                  </p>
                  <p className="mt-1.5 text-sm text-neutral-500">estimated value increase</p>
                  <SourceLink source={IMPACT_SOURCES.homeValue} />
                </div>
              </div>
            )}
        </section>

        {/* ── questions ──────────────────────────────────────────────────── */}
        <section className="mt-14 border-t border-neutral-900/12 pt-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Common questions</h2>
          <dl className="mt-5 divide-y divide-neutral-900/10 border-y border-neutral-900/12">
            {SOLAR_FAQS.map((faq) => (
              <div key={faq.q} className="break-inside-avoid py-3.5">
                <dt className="font-medium text-neutral-900">{faq.q}</dt>
                <dd className="mt-1 max-w-[72ch] text-sm leading-relaxed text-neutral-600">
                  {faq.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── who is doing the work ──────────────────────────────────────── */}
        <section className="mt-14 border-t border-neutral-900/12 pt-10">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
            Who is doing the work
          </h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <ContactCard
              title={s.company.name}
              lines={[s.company.address, s.company.phone, s.company.email]}
            />
            {s.representative && (
              <ContactCard
                title={s.representative.name}
                subtitle="Your consultant"
                lines={[s.representative.phone, s.representative.email]}
              />
            )}
          </div>
        </section>

        {/* ── disclosures ────────────────────────────────────────────────── */}
        <section data-colophon-legal className="mt-12 space-y-3 border-t border-neutral-300/70 pt-8">
          <h2 className="font-display text-sm font-semibold text-neutral-700">
            Important disclosures
          </h2>
          <p className="text-[11px] leading-relaxed text-neutral-500">{s.disclaimers.estimate}</p>
          <div className="text-[11px] text-neutral-500">
            <p className="font-medium">Assumptions used in this proposal</p>
            <ul className="mt-2 space-y-0.5">
              {/*
                The document lists the assumptions its numbers came from, so it
                has to name the model that actually produced them. Printing
                "1,450 kWh per kW per year" under a figure that was simulated
                per plane against a real weather record is a false sentence in
                the one section whose whole job is to be true.
              */}
              {s.assumptions.yieldBasis ? (
                <li>
                  Production: simulated for this address by PVWatts (National Laboratory of the
                  Rockies) against the
                  {s.assumptions.yieldBasis.station
                    ? ` ${s.assumptions.yieldBasis.station} `
                    : " local "}
                  weather record, using each roof plane&apos;s own direction and pitch and{" "}
                  {Math.round((1 - s.assumptions.derateFactor) * 100)}% system losses
                  {s.assumptions.yieldBasis.arrays < s.assumptions.yieldBasis.totalArrays
                    ? ` (${s.assumptions.yieldBasis.arrays} of ${s.assumptions.yieldBasis.totalArrays} arrays; the rest use a regional average of ${s.assumptions.kwhPerKwYear} kWh per kW per year)`
                    : ""}
                </li>
              ) : (
                <li>
                  Production: {s.assumptions.kwhPerKwYear} kWh per kW per year,{" "}
                  {Math.round((1 - s.assumptions.derateFactor) * 100)}% system losses
                  {s.system.tsrfPct != null
                    ? `, ${pct(s.system.tsrfPct)} solar resource (TSRF)`
                    : ""}
                </li>
              )}
              {/*
                Only when the SNAPSHOT carries it. A proposal built before the
                margin existed was quoted at full model output, and printing
                this on it would describe a haircut its number never took.
              */}
              {(s.assumptions.productionMarginPct ?? 0) > 0 && (
                <li>
                  Every production figure above is then quoted{" "}
                  {s.assumptions.productionMarginPct}% under what that model returns, so the system
                  is expected to meet or beat what you were shown.
                </li>
              )}
              <li>Panel degradation: {pct(s.assumptions.annualDegradationPct)} per year</li>
              <li>Utility rate increase: {pct(s.assumptions.utilityEscalationPct)} per year</li>
              {(s.assumptions.utilityMeterFeeCents ?? 0) > 0 && (
                <li>
                  Utility meter fee: {usd(s.assumptions.utilityMeterFeeCents, 2)} a month, kept in
                  the bill you still pay after solar because your utility charges it whatever the
                  system produces
                </li>
              )}
              {s.assumptions.currentRateMillsPerKwh > 0 && (
                <li>
                  Current utility rate: ${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)}{" "}
                  per kWh, derived from your bill
                </li>
              )}
            </ul>
          </div>
          <p className="text-[11px] text-neutral-500">
            Proposal {s.reference} · prepared {new Date(s.generatedAt).toLocaleDateString()} by{" "}
            {s.company.name}
            {s.company.phone ? ` · ${s.company.phone}` : ""}
          </p>
        </section>
      </div>
    </footer>
  );
}
