"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Sun, Leaf, TreePine, Factory, Check, Loader2, ChevronDown, Lock, ExternalLink,
} from "lucide-react";
import type { SolarProposalSnapshot, SavingsYear } from "@/lib/solar-proposal";
import { SOLAR_TIMELINE, SOLAR_FAQS } from "@/lib/solar-proposal";
import { acceptSolarProposalAction } from "@/server/modules/solar/proposal-sign-action";

/**
 * Money, always from cents. `maximumFractionDigits: 0` on the big numbers so a
 * 25-year projection does not read as false precision to the cent.
 */
const usd = (cents: number, digits = 0) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

const kwh = (n: number) => `${Math.round(n).toLocaleString()} kWh`;

/**
 * Percentages a homeowner reads. Whole numbers unless the value genuinely has a
 * fraction — "2.9%" must not become "3%", and "87.0%" must not appear at all.
 */
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * "An 8.00 kW system", "A 6.40 kW system".
 *
 * Driven by how the leading digits are SPOKEN, not by the first character: 8 is
 * "eight", 11 is "eleven" and 18 is "eighteen", all vowel sounds; every other
 * leading digit is a consonant sound. Small thing, but it is the first sentence
 * a homeowner reads.
 */
function article(kw: number): "A" | "An" {
  const whole = Math.floor(kw);
  if (whole === 8 || whole === 11 || whole === 18) return "An";
  // 80–89 and 800–899 are "eighty…"/"eight hundred…" — also vowel sounds.
  const lead = String(whole);
  if (lead.startsWith("8") || lead.startsWith("11") || lead.startsWith("18")) return "An";
  return "A";
}

const PRODUCT_LABEL: Record<string, string> = {
  cash: "Cash purchase",
  loan: "Solar loan",
  lease: "Solar lease",
  ppa: "Power purchase agreement",
};

/**
 * The customer-facing solar proposal.
 *
 * Mobile-first throughout: homeowners read these on a phone, usually standing
 * in a kitchen with a rep. Single column by default, tables become stacked
 * rows, and the accept action is always reachable without hunting.
 *
 * Every figure comes from the FROZEN snapshot — nothing is recomputed here, so
 * what the customer sees is exactly what was generated for them, whatever the
 * company's assumptions do afterwards.
 *
 * Two rules govern what appears:
 *   1. A section with no data is OMITTED, never rendered empty. There is no
 *      "$0 federal credit" tile and no broken image.
 *   2. Nothing internal is shown. Cost, margin, commission and the dealer fee
 *      are all in the snapshot's source rows and none of them reach this file.
 */
export function SolarProposalView({
  snapshot,
  token,
  alreadySigned,
  superseded,
  previewMode = false,
  layoutImageUrl = null,
}: {
  snapshot: SolarProposalSnapshot;
  token: string;
  alreadySigned: boolean;
  superseded: boolean;
  /**
   * Where to fetch the panel layout, resolved by the CALLER — the portal uses
   * the authenticated file route, the customer's copy the token-scoped one.
   *
   * Null means the drawing is not available (never uploaded, deleted, or its
   * bytes are gone) and the whole section is omitted. The component never
   * builds this URL itself, because doing so would mean guessing whether the
   * file still exists and emitting an <img> that resolves to a broken icon in
   * front of a homeowner.
   */
  layoutImageUrl?: string | null;
  /**
   * Renders the document exactly as the customer would see it, with acceptance
   * DISABLED. Used to inspect a proposal before signing is switched on — the
   * one thing a preview must never do is let someone accidentally accept.
   */
  previewMode?: boolean;
}) {
  const s = snapshot;
  const f = s.financing;
  const [signed, setSigned] = React.useState(alreadySigned);
  const isPurchase = f.product === "cash" || f.product === "loan";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 print:max-w-none print:px-0 print:py-0 sm:px-6 sm:py-12">
      <PrintStyles />

      {previewMode && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 print:hidden">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Internal preview.</strong> This is exactly what the customer would see.
            Acceptance is disabled and nothing has been sent.
          </span>
        </div>
      )}

      {superseded && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          A newer version of this proposal has been issued. Please ask your consultant for the
          current link.
        </div>
      )}

      {/* ── 1 · Cover ────────────────────────────────────────────────────── */}
      <header className="text-center">
        {s.company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.company.logoUrl} alt={s.company.name} className="mx-auto mb-6 h-10 w-auto" />
        )}
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">
          Your solar proposal
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">
          Own your power{s.customer.name ? `, ${s.customer.name.split(" ")[0]}` : ""}.
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
          {/* "An 8.00 kW", "A 6.40 kW" — the article follows how the number is
              SPOKEN, and 8/11/18 are the sizes that start with a vowel sound. */}
          {article(s.system.sizeKwDc)} {s.system.sizeKwDc.toFixed(2)} kW system for{" "}
          {s.customer.address}, designed to cover{" "}
          <strong>{pct(s.system.offsetPct)}</strong> of what your home uses.
        </p>

        <dl className="mx-auto mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            <dt>Prepared</dt>
            <dd className="font-medium text-foreground">
              {new Date(s.generatedAt).toLocaleDateString("en-US", {
                year: "numeric", month: "long", day: "numeric",
              })}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Reference</dt>
            <dd className="font-medium text-foreground">{s.reference}</dd>
          </div>
          {s.representative && (
            <div className="flex gap-1.5">
              <dt>Your consultant</dt>
              <dd className="font-medium text-foreground">{s.representative.name}</dd>
            </div>
          )}
        </dl>

        {/* The single number that decides it — and it is the HONEST one: what is
            left after paying for the system, not the gross bill reduction. */}
        <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">
            Projected {s.savings.years.length}-year net saving
          </p>
          <p className="mt-1 font-display text-4xl font-semibold text-emerald-700">
            {usd(s.savings.netSavingsCents)}
          </p>
          <p className="mt-1.5 text-xs text-emerald-900">
            After paying for the system, versus staying with your utility for the same period.
          </p>
        </div>
      </header>

      {/* ── Headline numbers ─────────────────────────────────────────────── */}
      <section aria-label="Summary" className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="System size" value={`${s.system.sizeKwDc.toFixed(2)} kW`} />
        <Stat label="Year-one production" value={kwh(s.system.year1ProductionKwh)} />
        <Stat label="Energy offset" value={pct(s.system.offsetPct)} />
        <Stat
          label={`${s.savings.years.length}-year net saving`}
          value={usd(s.savings.netSavingsCents)}
          tone={s.savings.netSavingsCents >= 0 ? "good" : undefined}
        />
      </section>

      {/* ── 2 · Current energy profile ───────────────────────────────────── */}
      <Section title="What you pay for power today">
        <dl className="divide-y divide-border text-sm">
          {s.energy.utilityProvider && <Row k="Utility" v={s.energy.utilityProvider} />}
          {s.energy.ratePlan && <Row k="Rate plan" v={s.energy.ratePlan} />}
          {s.energy.annualUsageKwh > 0 && <Row k="Annual usage" v={kwh(s.energy.annualUsageKwh)} />}
          {s.energy.avgMonthlyBillCents != null && (
            <Row k="Average monthly bill" v={usd(s.energy.avgMonthlyBillCents, 2)} />
          )}
          {s.energy.currentAnnualCostCents != null && (
            <Row k="Estimated annual cost" v={usd(s.energy.currentAnnualCostCents)} />
          )}
          {s.assumptions.currentRateMillsPerKwh > 0 && (
            <Row
              k="Your current rate"
              v={`$${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)} per kWh`}
            />
          )}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Your rate is worked out from your own bill and usage — not a regional average.
        </p>
      </Section>

      {/* ── 3 · Recommended system ───────────────────────────────────────── */}
      <Section title="Your system">
        <dl className="divide-y divide-border text-sm">
          <Row k="Size" v={`${s.system.sizeKwDc.toFixed(2)} kW-DC`} />
          <Row k="Year-one production" v={kwh(s.system.year1ProductionKwh)} />
          <Row k="Energy offset" v={`${pct(s.system.offsetPct)} of your usage`} />
          {s.system.moduleLabel && <Row k="Panels" v={`${s.system.moduleQty} × ${s.system.moduleLabel}`} />}
          {s.system.inverterLabel && <Row k="Inverter" v={s.system.inverterLabel} />}
          {s.system.batteryLabel && <Row k="Battery" v={s.system.batteryLabel} />}
          <Row k="Mounting" v={s.system.mountType === "ground" ? "Ground mount" : "Roof mount"} />
          {s.system.tsrfPct != null && (
            <Row k="Solar resource (TSRF)" v={pct(s.system.tsrfPct)} />
          )}
          {s.system.utilityProvider && <Row k="Utility" v={s.system.utilityProvider} />}
          {s.system.netMeteringProgram && <Row k="Billing programme" v={s.system.netMeteringProgram} />}
        </dl>
      </Section>

      {/* ── 4 · Panel layout ─────────────────────────────────────────────── */}
      {/* Rendered ONLY when the drawing is genuinely fetchable. Both conditions
          are required: the snapshot recorded a layout AND the caller resolved a
          live URL for it. No layout means no section — never a placeholder,
          never an empty frame, and never the aerial property photo standing in
          for a design that was not done. */}
      {s.layout && layoutImageUrl && (
        <Section title="Where the panels go">
          {/* The uploaded drawing, rendered EXACTLY as designed: `object-contain`
              inside an auto-height box, so it is never cropped, stretched or
              repositioned. The panel positions are the design — distorting them
              would misrepresent where the array actually goes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={layoutImageUrl}
            alt={`${s.layout.preliminary ? "Preliminary panel" : "Panel"} layout for ${s.customer.address}`}
            className="h-auto max-h-[70vh] w-full rounded-xl border border-border bg-muted/30 object-contain"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {s.layout.preliminary
              ? "Preliminary design. The final layout is confirmed at your site survey and may change once the roof and electrical panel have been measured."
              : "Final design, confirmed by your project team. Minor adjustments can still arise during installation."}
            {s.layout.provider ? ` Produced in ${s.layout.provider}.` : ""}
          </p>
        </Section>
      )}

      {/* ── 5 · Equipment ────────────────────────────────────────────────── */}
      {(s.system.module || s.system.inverter || s.system.battery) && (
        <Section title="Equipment">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">Component</th>
                  <th scope="col" className="py-2 font-medium">Make &amp; model</th>
                  <th scope="col" className="py-2 text-right font-medium">Spec</th>
                  <th scope="col" className="py-2 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                <EquipRow label="Panels" e={s.system.module} unit="W each" />
                <EquipRow label="Inverter" e={s.system.inverter} unit="W" />
                <EquipRow label="Battery" e={s.system.battery} unit="Wh" />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Manufacturer warranties apply to each component as published by that manufacturer. Your
            written agreement sets out the workmanship warranty in full.
          </p>
        </Section>
      )}

      {/* ── 6 · Pricing / financing ──────────────────────────────────────── */}
      <Section title="How you pay for it">
        <dl className="divide-y divide-border text-sm">
          <Row k="Option" v={PRODUCT_LABEL[f.product] ?? f.product} />
          {f.lender && <Row k="Lender" v={f.lender} />}

          {/* Purchase block — only the figures that belong to cash/loan. */}
          {isPurchase && f.basePriceCents != null && (
            <Row k="System price" v={usd(f.basePriceCents)} />
          )}
          {isPurchase && f.adderTotalCents != null && (
            <Row k="Additional work" v={usd(f.adderTotalCents)} />
          )}
          {isPurchase && f.contractPriceCents != null && (
            <Row k="Total price" v={usd(f.contractPriceCents)} strong />
          )}
          {isPurchase && f.finalPpwCents != null && f.finalPpwCents > 0 && (
            <Row k="Price per watt" v={`$${(f.finalPpwCents / 100).toFixed(2)}/W`} />
          )}

          {/* Third-party block — a lease has a monthly, a PPA has a rate, and
              neither has a system price. Nothing crosses over. */}
          {f.monthlyPaymentCents != null && (
            <Row k="Monthly payment" v={usd(f.monthlyPaymentCents, 2)} strong />
          )}
          {f.rateMillsPerKwh != null && (
            <Row k="Rate" v={`$${(f.rateMillsPerKwh / 1000).toFixed(3)} per kWh`} strong />
          )}
          {f.escalatorPct != null && <Row k="Annual increase" v={pct(f.escalatorPct)} />}
          {f.termYears != null && <Row k="Term" v={`${f.termYears} years`} />}
          {f.aprPct != null && <Row k="APR" v={pct(f.aprPct)} />}
          {/* A loan's monthly. Labelled "estimated" until a credit approval
              settles it, because quoting an amortised figure as final is how a
              homeowner is surprised at signing. */}
          {f.loanMonthlyPaymentCents != null && (
            <Row
              k={f.loanPaymentApproved ? "Monthly payment" : "Estimated monthly payment"}
              v={usd(f.loanMonthlyPaymentCents, 2)}
              strong
            />
          )}

          {/* The payment if the paydown is never made, directly beneath the one
              that assumes it is. Printing only the low figure is the most
              misleading thing a solar document can do — a customer who never
              applies the credit finds out from a bank statement. */}
          {f.loanMonthlyWithoutPaydownCents != null && (
            <Row
              k={
                f.loanPaydownMonths != null
                  ? `Monthly if the paydown is not made by month ${f.loanPaydownMonths}`
                  : "Monthly without the paydown"
              }
              v={usd(f.loanMonthlyWithoutPaydownCents, 2)}
            />
          )}
          {f.loanPaydownCents != null && (
            <Row
              k={
                f.loanPaydownMonths != null
                  ? `Paydown due by month ${f.loanPaydownMonths}`
                  : "Paydown"
              }
              v={usd(f.loanPaydownCents)}
            />
          )}
        </dl>

        {f.loanPaydownCents != null && (
          <p className="mt-3 text-xs text-muted-foreground">
            The lower payment assumes the paydown shown above is applied to the loan by the month
            stated. If it is not, the payment becomes the higher figure for the rest of the term.
            Whether you receive the federal credit, and how much, depends on your own tax situation.
          </p>
        )}

        {/* Pre-qualification. A LINK to the lender's own application — nothing
            is submitted from here, and no information leaves this page. */}
        {f.applyUrl && (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 print:hidden">
            <p className="text-sm font-medium">
              See what you qualify for{f.lender ? ` with ${f.lender}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opens {f.lender ?? "the lender"}&rsquo;s own secure application. Nothing is submitted
              from this page.
            </p>
            <a
              href={f.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Qualify <ExternalLink className="size-4" />
            </a>
          </div>
        )}
      </Section>

      {/* ── 7 · Savings & projections ────────────────────────────────────── */}
      <Section title="Staying with the utility vs going solar">
        <div className="grid gap-3 sm:grid-cols-2">
          <Callout
            label="Estimated utility cost avoided"
            value={usd(s.savings.utilityCostAvoidedCents)}
            note="The part of your electricity bill the system is projected to replace, before paying for it."
          />
          <Callout
            label={`Net ${s.savings.years.length}-year saving`}
            value={usd(s.savings.netSavingsCents)}
            note="What is left after the cost of the system itself."
            tone={s.savings.netSavingsCents >= 0 ? "good" : "warn"}
          />
        </div>

        <p className="mt-4 mb-3 text-sm text-muted-foreground">
          Assumes your utility rate rises {pct(s.assumptions.utilityEscalationPct)} a year and your
          panels lose {pct(s.assumptions.annualDegradationPct)} output annually. Both are estimates,
          not guarantees.
          {s.savings.paybackYear != null
            ? ` On these assumptions the system pays for itself in year ${s.savings.paybackYear}.`
            : ""}
        </p>

        {/* Visual first — most people read the bars and skip the table. */}
        <SavingsBars years={s.savings.years} />

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <caption className="sr-only">
              Projected annual cost with the utility compared with going solar
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 font-medium">Year</th>
                <th scope="col" className="py-2 text-right font-medium">Utility</th>
                <th scope="col" className="py-2 text-right font-medium">With solar</th>
                <th scope="col" className="py-2 text-right font-medium">Cumulative saved</th>
              </tr>
            </thead>
            <tbody>
              {s.savings.years
                .filter((y) => y.year === 1 || y.year % 5 === 0)
                .map((y) => (
                  <tr key={y.year} className="border-b border-border/60">
                    <td className="py-2">{y.year}</td>
                    <td className="py-2 text-right tabular-nums">{usd(y.utilityCostCents)}</td>
                    <td className="py-2 text-right tabular-nums">{usd(y.solarCostCents)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {usd(y.cumulativeSavingsCents)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          &ldquo;With solar&rdquo; includes any grid power you still buy, plus what you pay for the
          system in that year.
        </p>
      </Section>

      {/* ── Environmental ────────────────────────────────────────────────── */}
      <Section title="What this does for the planet">
        <p className="mb-3 text-sm text-muted-foreground">
          Over the {s.savings.years.length} years modelled, your system is projected to generate{" "}
          <strong>{kwh(s.savings.years.reduce((n, y) => n + y.productionKwh, 0))}</strong>{" "}
          of electricity that does not have to be burned into existence.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Impact icon={Leaf} value={s.environmental.tonsCo2Avoided.toLocaleString()} label="tons CO₂ avoided" />
          <Impact icon={TreePine} value={s.environmental.treesEquivalent.toLocaleString()} label="trees planted, equivalent" />
          <Impact icon={Factory} value={s.environmental.poundsCoalAvoided.toLocaleString()} label="lbs coal not burned" />
          <Impact icon={Sun} value={s.environmental.milesNotDriven.toLocaleString()} label="miles not driven" />
        </div>
      </Section>

      {/* ── 8 · Process ──────────────────────────────────────────────────── */}
      <Section title="What happens next">
        <ol className="space-y-3">
          {SOLAR_TIMELINE.map((step, i) => (
            <li key={step.key} className="flex gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.blurb}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          No dates are scheduled yet — your site survey is booked once you go ahead.
        </p>
      </Section>

      {/* ── FAQs ─────────────────────────────────────────────────────────── */}
      <Section title="Common questions">
        <div className="divide-y divide-border">
          {SOLAR_FAQS.map((faq) => (
            <details key={faq.q} className="group py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                {faq.q}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ── 11 · Next step ───────────────────────────────────────────────── */}
      <Section title="Ready to go ahead?">
        {signed ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <Check className="size-5 shrink-0" />
            Accepted — thank you. Your consultant will be in touch to book the site survey.
          </div>
        ) : superseded ? (
          <p className="text-sm text-muted-foreground">
            This version has been replaced and can no longer be accepted.
          </p>
        ) : previewMode ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground print:hidden">
            Acceptance is disabled in preview. The customer would sign here.
          </div>
        ) : (
          <AcceptForm token={token} onSigned={() => setSigned(true)} />
        )}
      </Section>

      {/* ── 9 · Company & representative ─────────────────────────────────── */}
      <Section title="Who is doing the work">
        <dl className="divide-y divide-border text-sm">
          {s.company.name && <Row k="Company" v={s.company.name} />}
          {s.company.address && <Row k="Address" v={s.company.address} />}
          {s.company.phone && <Row k="Phone" v={s.company.phone} />}
          {s.company.email && <Row k="Email" v={s.company.email} />}
          {s.representative && <Row k="Your consultant" v={s.representative.name} />}
          {s.representative?.phone && <Row k="Consultant phone" v={s.representative.phone} />}
          {s.representative?.email && <Row k="Consultant email" v={s.representative.email} />}
        </dl>
      </Section>

      {/* ── 10 · Disclosures ─────────────────────────────────────────────── */}
      <footer className="mt-10 space-y-3 border-t border-border pt-6">
        <h2 className="font-display text-sm font-semibold">Important disclosures</h2>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {s.disclaimers.estimate}
        </p>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-medium">Assumptions used in this proposal</summary>
          <ul className="mt-2 space-y-0.5">
            <li>
              Production: {s.assumptions.kwhPerKwYear} kWh per kW per year,{" "}
              {Math.round((1 - s.assumptions.derateFactor) * 100)}% system losses
              {s.system.tsrfPct != null ? `, ${pct(s.system.tsrfPct)} solar resource (TSRF)` : ""}
            </li>
            <li>Panel degradation: {pct(s.assumptions.annualDegradationPct)} per year</li>
            <li>Utility rate increase: {pct(s.assumptions.utilityEscalationPct)} per year</li>
            {s.assumptions.currentRateMillsPerKwh > 0 && (
              <li>
                Current utility rate: ${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)} per
                kWh, derived from your bill
              </li>
            )}
          </ul>
        </details>
        <p className="text-[11px] text-muted-foreground">
          Proposal {s.reference} · prepared{" "}
          {new Date(s.generatedAt).toLocaleDateString()} by {s.company.name}
          {s.company.phone ? ` · ${s.company.phone}` : ""}
        </p>
      </footer>
    </main>
  );
}

/**
 * Print rules.
 *
 * Chrome drops background colours by default, which bleaches every tinted panel
 * on this page — the savings callout in particular becomes white text on white.
 * `print-color-adjust: exact` is what keeps the document readable on paper, and
 * the break rules stop a section splitting across a page mid-table.
 */
function PrintStyles() {
  return (
    <style>{`
      @media print {
        html, body { background: #fff !important; }
        * { print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
        section, table, ol, .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        h1, h2 { break-after: avoid; page-break-after: avoid; }
        details { display: block; }
        details > summary { display: none; }
        a[href]::after { content: ""; }
      }
    `}</style>
  );
}

function AcceptForm({ token, onSigned }: { token: string; onSigned: () => void }) {
  const [name, setName] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Please type your full name.");
    if (!agreed) return toast.error("Please confirm you have read the proposal.");
    setBusy(true);
    const res = await acceptSolarProposalAction(token, name.trim());
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    toast.success("Proposal accepted");
    onSigned();
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <label htmlFor="sig" className="text-xs font-medium">
          Type your full name to accept
        </label>
        <input
          id="sig"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          autoComplete="name"
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 font-display text-lg"
        />
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        I have read this proposal and understand the figures are estimates, not a guarantee, and
        that financing is subject to credit approval.
      </label>
      <button
        onClick={submit}
        disabled={busy}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Accept this proposal
      </button>
    </div>
  );
}

/**
 * Utility vs solar, as bars. Scaled to the largest year in either series so the
 * divergence is visible at a glance — which is the whole argument.
 */
function SavingsBars({ years }: { years: SavingsYear[] }) {
  const shown = years.filter((y) => y.year === 1 || y.year % 5 === 0);
  const max = Math.max(...shown.map((y) => Math.max(y.utilityCostCents, y.solarCostCents)), 1);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-muted-foreground/40" /> Utility
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> With solar
        </span>
      </div>
      {shown.map((y) => (
        <div key={y.year} className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Yr {y.year}</span>
          <div className="space-y-1">
            <div className="h-3 rounded-sm bg-muted">
              <div
                className="h-3 rounded-sm bg-muted-foreground/40"
                style={{ width: `${Math.max(2, (y.utilityCostCents / max) * 100)}%` }}
              />
            </div>
            <div className="h-3 rounded-sm bg-muted">
              <div
                className="h-3 rounded-sm bg-emerald-500"
                style={{ width: `${Math.max(2, (y.solarCostCents / max) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-border p-3 text-center">
      <div
        className={`font-display text-lg font-semibold sm:text-xl ${tone === "good" ? "text-emerald-700" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Callout({
  label, value, note, tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn";
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === "good"
          ? "border-emerald-200 bg-emerald-50"
          : tone === "warn"
            ? "border-amber-200 bg-amber-50"
            : "border-border"
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl font-semibold ${
          tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-800" : ""
        }`}
      >
        {value}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

function EquipRow({
  label, e, unit,
}: {
  label: string;
  e: { manufacturer: string | null; model: string; ratingW: number | null; qty: number } | null;
  unit: string;
}) {
  if (!e) return null;
  return (
    <tr className="border-b border-border/60">
      <th scope="row" className="py-2 text-left font-normal text-muted-foreground">{label}</th>
      <td className="py-2">{[e.manufacturer, e.model].filter(Boolean).join(" ")}</td>
      <td className="py-2 text-right tabular-nums">
        {e.ratingW ? `${e.ratingW.toLocaleString()} ${unit}` : "—"}
      </td>
      <td className="py-2 text-right tabular-nums">{e.qty > 0 ? e.qty : "—"}</td>
    </tr>
  );
}

function Impact({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-border p-3 text-center">
      <Icon className="mx-auto size-5 text-emerald-700" />
      <div className="mt-1.5 font-display text-lg font-semibold">{value}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`text-right font-medium ${strong ? "font-display text-base font-semibold" : ""}`}>
        {v}
      </dd>
    </div>
  );
}
