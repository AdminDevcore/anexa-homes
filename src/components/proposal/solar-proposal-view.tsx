"use client";

import * as React from "react";
import { toast } from "sonner";
import { Leaf, TreePine, Factory, Car, Check, Loader2, Lock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SolarProposalSnapshot, SavingsYear } from "@/lib/solar-proposal";
import { SOLAR_TIMELINE, SOLAR_FAQS } from "@/lib/solar-proposal";
import { PROPOSAL_NAV_PX } from "@/lib/proposal";
import { acceptSolarProposalAction } from "@/server/modules/solar/proposal-sign-action";
import { LenderMark } from "@/components/ui/lender-mark";
import { ProposalChrome, type ChromeNavItem } from "./proposal-chrome";

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
 * Money for a chart axis, where the exact figure is stated in words below the
 * plot and only the SCALE has to survive being 10px wide on a phone.
 */
const usdCompact = (cents: number) => {
  const d = Math.round(cents / 100);
  return d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${d}`;
};

/**
 * Percentages a homeowner reads. Whole numbers unless the value genuinely has a
 * fraction — "2.9%" must not become "3%", and "87.0%" must not appear at all.
 */
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * The offset, as a HEADLINE.
 *
 * "71.97% of what your home uses" is false precision on a 25-year projection
 * and reads like a machine talking. The two decimals stay everywhere the number
 * is an assumption being audited; the sentence a homeowner reads gets "72%".
 */
const pctWhole = (n: number) => `${Math.round(n)}%`;

/**
 * The name on the cover, as a person's name.
 *
 * Leads arrive from web forms and canvassing apps with whatever casing the
 * person typed, so "mustafa" is a normal thing to find in the column. Printing
 * it verbatim in 60px display type is the single most obvious tell that a
 * document was machine-made, so the FIRST NAME is cased for display only —
 * nothing is written back, and a name that is already cased is untouched.
 */
function firstName(full: string | null | undefined): string {
  const raw = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!raw) return "";
  // Only fix a name that is entirely lower-case. "McDonald" and "o'Brien" are
  // left exactly as the person wrote them.
  if (raw !== raw.toLowerCase()) return raw;
  return raw.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

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
 * The two series in the cost comparison.
 *
 * Chosen against the document's own paper (#f6f3ee) with the palette validator,
 * not by eye: amber-700 and emerald-700 clear the lightness band, the chroma
 * floor, the normal-vision floor (ΔE 21.9) and 3:1 contrast, and land in the
 * 6–8 protan band that is legal only WITH secondary encoding — which is why
 * both series are named in the legend, totalled in words beneath the plot, and
 * repeated in the table below it. Colour is never the only thing carrying the
 * difference.
 */
const UTILITY_INK = "#b45309";
const SOLAR_INK = "#047857";

/**
 * The customer-facing solar proposal.
 *
 * An editorial DOCUMENT, not a spec sheet: a full-bleed cover, chapters that
 * reveal as they scroll, and a sticky nav that says where you are — the same
 * language as the roofing presentation, because both go out under the same
 * company and a homeowner comparing them should not be able to tell that two
 * different screens produced them.
 *
 * Mobile-first throughout: homeowners read these on a phone, usually standing
 * in a kitchen with a rep. Single column by default, tables become cards, and
 * the accept action is always reachable without hunting.
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
  showComparison = true,
  accentColor,
  chromeOffset = 0,
}: {
  snapshot: SolarProposalSnapshot;
  token: string;
  /**
   * Whether to render the 25-year utility-versus-solar section.
   *
   * A PRESENTATION choice held on the proposal row, not in the snapshot: every
   * figure the customer was quoted stays exactly where it was, and a rep who
   * decides at the table that this household reads the table as a wall of
   * numbers can turn it off without reissuing the document.
   *
   * Defaults true, which is how every proposal sent before the toggle existed
   * was rendered.
   */
  showComparison?: boolean;
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
  /**
   * The brand accent, resolved by the caller from the DEAL's vertical — solar
   * proposals carry the solar brand's colour even when a roofing admin is the
   * one looking at them. Falls back to the house accent.
   */
  accentColor?: string | null;
  /**
   * Pixels of surrounding app chrome already pinned above the document's own
   * nav. The embedder owns this number — the document knows nothing about the
   * portal it may be previewed inside.
   */
  chromeOffset?: number;
}) {
  const s = snapshot;
  const f = s.financing;
  const [signed, setSigned] = React.useState(alreadySigned);
  const isPurchase = f.product === "cash" || f.product === "loan";
  const name = firstName(s.customer.name);

  const hasEquipment = !!(s.system.module || s.system.inverter || s.system.battery);
  const hasLayout = !!(s.layout && layoutImageUrl);

  const navItems: ChromeNavItem[] = (
    [
      ["overview", "Overview", true],
      ["today", "Today", true],
      ["system", "System", true],
      ["layout", "Layout", hasLayout],
      ["cost", "Your cost", true],
      ["savings", "Savings", showComparison],
      ["impact", "Impact", true],
      ["timeline", "Timeline", true],
      ["faq", "FAQ", true],
      ["accept", "Accept", true],
    ] as [string, string, boolean][]
  )
    .filter(([, , show]) => show)
    .map(([id, label]) => ({ id, label }));

  return (
    <div
      id="proposal-root"
      className="min-h-screen bg-[#f6f3ee] text-neutral-900"
      style={{
        ["--proposal-accent" as string]: accentColor || "#F4631E",
        // Everything pinned above a chapter, so a jump link lands the chapter
        // below the chrome instead of behind it.
        ["--proposal-chrome-h" as string]: `${chromeOffset + PROPOSAL_NAV_PX}px`,
      }}
    >
      <PrintStyles />

      {/* Above the sticky nav ON PURPOSE: an internal notice scrolls away, it
          does not follow a rep down a document they are reviewing. */}
      {previewMode && (
        <div className="flex items-start justify-center gap-2 bg-neutral-900 px-4 py-2.5 text-center text-xs text-neutral-300 print:hidden">
          <Lock className="mt-px size-3.5 shrink-0" />
          <span>
            <strong className="font-semibold text-white">Internal preview.</strong> This is exactly
            what the customer would see. Acceptance is disabled and nothing has been sent.
          </span>
        </div>
      )}

      <ProposalChrome
        companyName={s.company.name}
        logoUrl={s.company.logoUrl}
        navItems={navItems}
        offsetTop={chromeOffset}
      />

      {superseded && (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm text-amber-900">
          A newer version of this proposal has been issued. Please ask your consultant for the
          current link.
        </div>
      )}

      {/* ── 1 · COVER ────────────────────────────────────────────────────
          Full-bleed editorial hero. On paper it owns its page: tall enough to
          fill a Letter sheet inside the @page margins, never so tall it spills
          onto a second. */}
      <section
        data-section="cover"
        className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden bg-neutral-950 px-6 py-14 text-white sm:px-10 print:min-h-[9.5in] print:py-16"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/img/solar.jpg"
          alt=""
          className="absolute inset-0 size-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/85 to-neutral-950/30" />

        <div className="reveal-up relative mx-auto w-full max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--proposal-accent)] sm:text-sm">
            Your solar proposal
          </p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
            Own your
            <br />
            power{name ? `, ${name}` : ""}.
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-neutral-300 sm:text-xl">
            {/* "An 8.00 kW", "A 6.40 kW" — the article follows how the number is
                SPOKEN, and 8/11/18 are the sizes that start with a vowel sound. */}
            {article(s.system.sizeKwDc)} {s.system.sizeKwDc.toFixed(2)} kW system for{" "}
            <span className="text-white">{s.customer.address}</span>, designed to cover{" "}
            <strong className="font-semibold text-white">{pctWhole(s.system.offsetPct)}</strong> of
            what your home uses.
          </p>

          <dl className="mt-9 flex flex-wrap gap-x-10 gap-y-3 text-sm text-neutral-400">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.18em]">Prepared</dt>
              <dd className="mt-0.5 font-medium text-white">
                {new Date(s.generatedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.18em]">Reference</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-white">{s.reference}</dd>
            </div>
            {s.representative && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em]">Your consultant</dt>
                <dd className="mt-0.5 font-medium text-white">{s.representative.name}</dd>
              </div>
            )}
          </dl>

          {/* The three numbers that decide it, on the cover. Translucent rather
              than a card, so the photograph still reads as the background. */}
          <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/15 sm:grid-cols-4">
            <CoverStat label="System size" value={`${s.system.sizeKwDc.toFixed(2)} kW`} />
            <CoverStat label="Year-one production" value={kwh(s.system.year1ProductionKwh)} />
            <CoverStat label="Energy offset" value={pctWhole(s.system.offsetPct)} />
            <CoverStat
              label={`${s.savings.years.length}-year net saving`}
              value={usd(s.savings.netSavingsCents)}
              accent
            />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center print:hidden">
          <span className="flex flex-col items-center gap-1 text-[11px] uppercase tracking-[0.3em] text-neutral-400">
            Scroll
            <svg
              className="size-4 animate-bounce"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </section>

      {/* ── 2 · THE HEADLINE ─────────────────────────────────────────────── */}
      <Section id="overview" eyebrow="The headline" title="What this changes">
        {/* The single number that decides it — and it is the HONEST one: what is
            left after paying for the system, not the gross bill reduction. */}
        <div className="overflow-hidden rounded-3xl bg-neutral-950 p-8 text-white sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--proposal-accent)]">
            Projected {s.savings.years.length}-year net saving
          </p>
          <p className="mt-3 font-display text-6xl font-bold leading-none tracking-tight sm:text-8xl">
            {usd(s.savings.netSavingsCents)}
          </p>
          <p className="mt-5 max-w-md leading-relaxed text-neutral-300">
            After paying for the system, versus staying with your utility for the same period.
            {s.savings.paybackYear != null
              ? ` On the assumptions listed, it pays for itself in year ${s.savings.paybackYear}.`
              : ""}
          </p>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FactCard
            i={0}
            k="System size"
            v={`${s.system.sizeKwDc.toFixed(2)} kW`}
            note={s.system.moduleQty > 0 ? `${s.system.moduleQty} panels` : undefined}
          />
          <FactCard
            i={1}
            k="Year-one production"
            v={kwh(s.system.year1ProductionKwh)}
            note="Estimated, at this address"
          />
          <FactCard
            i={2}
            k="Energy offset"
            v={pctWhole(s.system.offsetPct)}
            note="Of what your home uses"
          />
        </dl>
      </Section>

      {/* ── 3 · CURRENT ENERGY PROFILE ───────────────────────────────────── */}
      <Section id="today" eyebrow="Where you are now" title="What you pay for power today">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-start">
          {s.energy.avgMonthlyBillCents != null && (
            <div className="rounded-3xl bg-white p-8 shadow-sm ring-1 ring-neutral-200/60">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Your bill today
              </p>
              <p className="mt-2 font-display text-5xl font-bold leading-none tracking-tight sm:text-6xl">
                {usd(s.energy.avgMonthlyBillCents, 2)}
              </p>
              <p className="mt-2 text-sm text-neutral-500">a month, on average</p>
              {s.energy.currentAnnualCostCents != null && (
                <p className="mt-5 border-t border-neutral-100 pt-4 text-sm text-neutral-600">
                  That is about{" "}
                  <strong className="font-semibold text-neutral-900">
                    {usd(s.energy.currentAnnualCostCents)}
                  </strong>{" "}
                  a year — before the utility raises its rates again.
                </p>
              )}
            </div>
          )}

          <SpecList
            items={[
              ["Utility", s.energy.utilityProvider],
              ["Rate plan", s.energy.ratePlan],
              ["Annual usage", s.energy.annualUsageKwh > 0 ? kwh(s.energy.annualUsageKwh) : null],
              [
                "Estimated annual cost",
                s.energy.currentAnnualCostCents != null
                  ? usd(s.energy.currentAnnualCostCents)
                  : null,
              ],
              [
                "Your current rate",
                s.assumptions.currentRateMillsPerKwh > 0
                  ? `$${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)} per kWh`
                  : null,
              ],
            ]}
          />
        </div>

        <p className="mt-5 text-sm text-neutral-500">
          Your rate is worked out from your own bill and usage — not a regional average.
        </p>
      </Section>

      {/* ── 4 · RECOMMENDED SYSTEM ───────────────────────────────────────── */}
      <Section id="system" eyebrow="The design" title="Your system">
        <dl className="grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2">
          {(
            [
              ["Size", `${s.system.sizeKwDc.toFixed(2)} kW-DC`],
              ["Year-one production", kwh(s.system.year1ProductionKwh)],
              ["Energy offset", `${pctWhole(s.system.offsetPct)} of your usage`],
              [
                "Panels",
                s.system.moduleLabel ? `${s.system.moduleQty} × ${s.system.moduleLabel}` : null,
              ],
              ["Inverter", s.system.inverterLabel],
              ["Battery", s.system.batteryLabel],
              ["Mounting", s.system.mountType === "ground" ? "Ground mount" : "Roof mount"],
              ["Solar resource (TSRF)", s.system.tsrfPct != null ? pct(s.system.tsrfPct) : null],
              ["Utility", s.system.utilityProvider],
              ["Billing programme", s.system.netMeteringProgram],
            ] as [string, string | null][]
          )
            .filter(([, v]) => v)
            .map(([k, v], idx) => (
              <div key={k} data-stagger style={{ ["--i" as string]: idx } as React.CSSProperties}>
                <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">
                  {k}
                </dt>
                <dd className="mt-1.5 text-xl font-medium text-neutral-900">{v}</dd>
              </div>
            ))}
        </dl>

        {hasEquipment && (
          <>
            <p className="mt-14 mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
              Equipment
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <EquipCard i={0} label="Panels" e={s.system.module} unit="W each" />
              <EquipCard i={1} label="Inverter" e={s.system.inverter} unit="W" />
              <EquipCard i={2} label="Battery" e={s.system.battery} unit="Wh" />
            </div>
            <p className="mt-4 text-sm text-neutral-500">
              Manufacturer warranties apply to each component as published by that manufacturer.
              Your written agreement sets out the workmanship warranty in full.
            </p>
          </>
        )}
      </Section>

      {/* ── 5 · PANEL LAYOUT ─────────────────────────────────────────────
          Rendered ONLY when the drawing is genuinely fetchable. Both conditions
          are required: the snapshot recorded a layout AND the caller resolved a
          live URL for it. No layout means no section — never a placeholder,
          never an empty frame, and never the aerial property photo standing in
          for a design that was not done. */}
      {hasLayout && s.layout && (
        <Section id="layout" eyebrow="The array" title="Where the panels go" tone="dark" wide>
          {/* The uploaded drawing, rendered EXACTLY as designed: `object-contain`
              inside an auto-height box, so it is never cropped, stretched or
              repositioned. The panel positions are the design — distorting them
              would misrepresent where the array actually goes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={layoutImageUrl!}
            alt={`${s.layout.preliminary ? "Preliminary panel" : "Panel"} layout for ${s.customer.address}`}
            className="h-auto max-h-[72vh] w-full rounded-2xl bg-neutral-900 object-contain ring-1 ring-white/10"
          />
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-neutral-400">
            {s.layout.preliminary
              ? "Preliminary design. The final layout is confirmed at your site survey and may change once the roof and electrical panel have been measured."
              : "Final design, confirmed by your project team. Minor adjustments can still arise during installation."}
            {s.layout.provider ? ` Produced in ${s.layout.provider}.` : ""}
          </p>
        </Section>
      )}

      {/* ── 6 · PRICING / FINANCING ──────────────────────────────────────── */}
      <Section id="cost" eyebrow="Your investment" title="How you pay for it" tone="dark">
        <PriceHero f={f} isPurchase={isPurchase} />

        <dl className="mt-8 break-inside-avoid divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <DarkRow k="Option" v={PRODUCT_LABEL[f.product] ?? f.product} />
          {f.lender && (
            <DarkRow
              k="Lender"
              v={
                <span className="flex items-center justify-end gap-2">
                  <LenderMark name={f.lender} logoUrl={f.lenderLogoUrl} size="sm" />
                  {f.lender}
                </span>
              }
            />
          )}

          {/* Purchase block — only the figures that belong to cash/loan. */}
          {isPurchase && f.basePriceCents != null && (
            <DarkRow k="System price" v={usd(f.basePriceCents)} />
          )}
          {/*
            The extra work, named where we have the names.

            A homeowner reading "Additional work — $14,500" on an $82,660
            contract, alone at their kitchen table with nobody to ask, has one
            obvious question and no way to answer it. So each line says what it
            bought, and the total sits underneath them.

            Proposals generated before v3 carry the total and no lines, and keep
            rendering exactly as they did — the snapshot is what that customer
            was shown, and back-filling names onto it would be inventing a
            breakdown for money nobody itemised at the time.
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
          {isPurchase && f.contractPriceCents != null && (
            <DarkRow k="Total price" v={usd(f.contractPriceCents)} strong />
          )}
          {isPurchase && f.finalPpwCents != null && f.finalPpwCents > 0 && (
            <DarkRow k="Price per watt" v={`$${(f.finalPpwCents / 100).toFixed(2)}/W`} />
          )}

          {/* Third-party block — a lease has a monthly, a PPA has a rate, and
              neither has a system price. Nothing crosses over. */}
          {f.monthlyPaymentCents != null && (
            <DarkRow k="Monthly payment" v={usd(f.monthlyPaymentCents, 2)} strong />
          )}
          {f.rateMillsPerKwh != null && (
            <DarkRow k="Rate" v={`$${(f.rateMillsPerKwh / 1000).toFixed(3)} per kWh`} strong />
          )}
          {f.escalatorPct != null && <DarkRow k="Annual increase" v={pct(f.escalatorPct)} />}
          {f.termYears != null && <DarkRow k="Term" v={`${f.termYears} years`} />}
          {f.aprPct != null && <DarkRow k="APR" v={pct(f.aprPct)} />}
          {/* A loan's monthly. Labelled "estimated" until a credit approval
              settles it, because quoting an amortised figure as final is how a
              homeowner is surprised at signing. */}
          {f.loanMonthlyPaymentCents != null && (
            <DarkRow
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
            <DarkRow
              k={
                f.loanPaydownMonths != null
                  ? `Monthly if the paydown is not made by month ${f.loanPaydownMonths}`
                  : "Monthly without the paydown"
              }
              v={usd(f.loanMonthlyWithoutPaydownCents, 2)}
            />
          )}
          {f.loanPaydownCents != null && (
            <DarkRow
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
          <p className="mt-6 break-inside-avoid rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-200">
            <strong className="text-amber-100">Read this one twice:</strong> the lower payment
            assumes the paydown shown above is applied to the loan by the month stated. If it is
            not, the payment becomes the higher figure for the rest of the term. Whether you receive
            the federal credit, and how much, depends on your own tax situation.
          </p>
        )}

        {/* Pre-qualification. A LINK to the lender's own application — nothing
            is submitted from here, and no information leaves this page. */}
        {f.applyUrl && (
          <div className="mt-6 flex flex-wrap items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-6 print:hidden">
            {f.lender && <LenderMark name={f.lender} logoUrl={f.lenderLogoUrl} size="lg" />}
            <div className="min-w-[16rem] flex-1">
              <p className="font-display text-xl font-semibold text-white">
                See what you qualify for{f.lender ? ` with ${f.lender}` : ""}
              </p>
              <p className="mt-1 text-sm text-neutral-400">
                Opens {f.lender ?? "the lender"}&rsquo;s own secure application. Nothing is
                submitted from this page.
              </p>
            </div>
            <a
              href={f.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
            >
              Qualify <ExternalLink className="size-4" />
            </a>
          </div>
        )}
      </Section>

      {/* ── 7 · SAVINGS & PROJECTIONS ────────────────────────────────────── */}
      {showComparison && (
        <Section
          id="savings"
          eyebrow="The maths"
          title="Staying with the utility vs going solar"
          wide
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Callout
              i={0}
              label="Estimated utility cost avoided"
              value={usd(s.savings.utilityCostAvoidedCents)}
              note="The part of your electricity bill the system is projected to replace, before paying for it."
            />
            <Callout
              i={1}
              label={`Net ${s.savings.years.length}-year saving`}
              value={usd(s.savings.netSavingsCents)}
              note="What is left after the cost of the system itself."
              tone={s.savings.netSavingsCents >= 0 ? "good" : "warn"}
            />
          </div>

          <p className="mt-8 max-w-2xl leading-relaxed text-neutral-600">
            Assumes your utility rate rises {pct(s.assumptions.utilityEscalationPct)} a year and
            your panels lose {pct(s.assumptions.annualDegradationPct)} output annually. Both are
            estimates, not guarantees.
            {s.savings.paybackYear != null
              ? ` On these assumptions the system pays for itself in year ${s.savings.paybackYear}.`
              : ""}
          </p>

          <CumulativeCostChart
            years={s.savings.years}
            paybackYear={s.savings.paybackYear}
            netSavingsCents={s.savings.netSavingsCents}
          />

          <div className="mt-10 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/60">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <caption className="sr-only">
                  Projected annual cost with the utility compared with going solar
                </caption>
                <thead className="bg-neutral-50 text-left text-xs uppercase tracking-[0.1em] text-neutral-500">
                  <tr>
                    <th scope="col" className="px-5 py-4 font-semibold">
                      Year
                    </th>
                    <th scope="col" className="px-5 py-4 text-right font-semibold">
                      Utility
                    </th>
                    <th scope="col" className="px-5 py-4 text-right font-semibold">
                      With solar
                    </th>
                    <th scope="col" className="px-5 py-4 text-right font-semibold">
                      Cumulative saved
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {s.savings.years
                    .filter((y) => y.year === 1 || y.year % 5 === 0)
                    .map((y) => (
                      <tr key={y.year} className="break-inside-avoid transition-colors hover:bg-neutral-50">
                        <td className="px-5 py-3.5 tabular-nums text-neutral-500">{y.year}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                          {usd(y.utilityCostCents)}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                          {usd(y.solarCostCents)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-neutral-900">
                          {usd(y.cumulativeSavingsCents)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            &ldquo;With solar&rdquo; includes any grid power you still buy, plus what you pay for
            the system in that year.
          </p>
        </Section>
      )}

      {/* ── 8 · ENVIRONMENTAL ────────────────────────────────────────────── */}
      <Section id="impact" eyebrow="Beyond the bill" title="What this does for the planet">
        <p className="max-w-2xl text-lg leading-relaxed text-neutral-600">
          Over the {s.savings.years.length} years modelled, your system is projected to generate{" "}
          <strong className="font-semibold text-neutral-900">
            {kwh(s.savings.years.reduce((n, y) => n + y.productionKwh, 0))}
          </strong>{" "}
          of electricity that does not have to be burned into existence.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Impact
            i={0}
            icon={Leaf}
            value={s.environmental.tonsCo2Avoided.toLocaleString()}
            label="tons CO₂ avoided"
          />
          <Impact
            i={1}
            icon={TreePine}
            value={s.environmental.treesEquivalent.toLocaleString()}
            label="trees planted, equivalent"
          />
          <Impact
            i={2}
            icon={Factory}
            value={s.environmental.poundsCoalAvoided.toLocaleString()}
            label="lbs coal not burned"
          />
          <Impact
            i={3}
            icon={Car}
            value={s.environmental.milesNotDriven.toLocaleString()}
            label="miles not driven"
          />
        </div>
      </Section>

      {/* ── 9 · PROCESS ──────────────────────────────────────────────────── */}
      <Section id="timeline" eyebrow="The plan" title="What happens next">
        <ol className="relative space-y-1">
          <span
            className="pointer-events-none absolute bottom-8 left-[24px] top-8 w-0.5 bg-gradient-to-b from-[var(--proposal-accent)] via-[var(--proposal-accent)]/60 to-[var(--proposal-accent)]/15 print:hidden"
            aria-hidden
          />
          {SOLAR_TIMELINE.map((step, i) => (
            <li
              key={step.key}
              data-stagger
              style={{ ["--i" as string]: i } as React.CSSProperties}
              className="group relative flex items-start gap-5 rounded-xl px-3 py-3.5 transition-colors hover:bg-white"
            >
              <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--proposal-accent)] text-lg font-bold text-white shadow-md ring-4 ring-[#f6f3ee] transition-transform duration-300 group-hover:scale-110 group-hover:ring-white">
                {i + 1}
              </span>
              <div className="pt-1.5">
                <p className="text-lg font-semibold text-neutral-900">{step.title}</p>
                <p className="mt-0.5 leading-relaxed text-neutral-600">{step.blurb}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-neutral-500">
          No dates are scheduled yet — your site survey is booked once you go ahead.
        </p>
      </Section>

      {/* ── 10 · FAQs ────────────────────────────────────────────────────── */}
      <Section id="faq" eyebrow="FAQ" title="Common questions">
        <div className="grid gap-3 sm:grid-cols-2">
          {SOLAR_FAQS.map((faq, i) => (
            <div
              key={faq.q}
              data-stagger
              style={{ ["--i" as string]: i } as React.CSSProperties}
              className="break-inside-avoid rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60"
            >
              <p className="font-display text-lg font-semibold leading-snug text-neutral-900">
                {faq.q}
              </p>
              <p className="mt-2 leading-relaxed text-neutral-600">{faq.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 11 · NEXT STEP ───────────────────────────────────────────────── */}
      <section
        data-section="accept"
        data-reveal
        className="relative overflow-hidden bg-neutral-950 px-6 py-24 text-white sm:px-10 print:py-10"
      >
        <div className="mx-auto w-full max-w-xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--proposal-accent)] sm:text-sm">
            Let&rsquo;s get started
          </p>
          <h2 className="mt-3 font-display text-4xl font-bold leading-tight sm:text-6xl">
            Ready to go ahead?
          </h2>

          <div className="mt-10 text-left">
            {signed ? (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-center text-emerald-100">
                <Check className="size-5 shrink-0" />
                Accepted — thank you. Your consultant will be in touch to book the site survey.
              </div>
            ) : superseded ? (
              <p className="text-center text-neutral-400">
                This version has been replaced and can no longer be accepted.
              </p>
            ) : previewMode ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-neutral-400 print:hidden">
                Acceptance is disabled in preview. The customer would sign here.
              </div>
            ) : (
              <AcceptForm token={token} onSigned={() => setSigned(true)} />
            )}
          </div>
        </div>
      </section>

      {/* ── 12 · COMPANY, REPRESENTATIVE & DISCLOSURES ───────────────────── */}
      <footer className="bg-[#efeae2] px-6 py-16 sm:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
            Who is doing the work
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
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

          <div className="mt-12 space-y-3 border-t border-neutral-300/70 pt-8">
            <h2 className="font-display text-sm font-semibold text-neutral-700">
              Important disclosures
            </h2>
            <p className="text-[11px] leading-relaxed text-neutral-500">{s.disclaimers.estimate}</p>
            <details className="text-[11px] text-neutral-500">
              <summary className="cursor-pointer font-medium">
                Assumptions used in this proposal
              </summary>
              <ul className="mt-2 space-y-0.5">
                {/*
                  The document lists the assumptions its numbers came from, so it
                  has to name the model that actually produced them. Printing "1,450
                  kWh per kW per year" under a figure that was simulated per plane
                  against a real weather record is a false sentence in the one
                  section whose whole job is to be true.
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
                <li>Panel degradation: {pct(s.assumptions.annualDegradationPct)} per year</li>
                <li>Utility rate increase: {pct(s.assumptions.utilityEscalationPct)} per year</li>
                {s.assumptions.currentRateMillsPerKwh > 0 && (
                  <li>
                    Current utility rate: $
                    {(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)} per kWh, derived from
                    your bill
                  </li>
                )}
              </ul>
            </details>
            <p className="text-[11px] text-neutral-500">
              Proposal {s.reference} · prepared {new Date(s.generatedAt).toLocaleDateString()} by{" "}
              {s.company.name}
              {s.company.phone ? ` · ${s.company.phone}` : ""}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Chapters and primitives
   ════════════════════════════════════════════════════════════════════════ */

/** Editorial chapter. `tone="dark"` makes a dramatic full-width dark chapter. */
function Section({
  id,
  title,
  eyebrow,
  children,
  tone = "light",
  wide = false,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  tone?: "light" | "dark";
  wide?: boolean;
}) {
  const dark = tone === "dark";
  return (
    <section
      data-section={id}
      data-reveal
      className={cn(
        "relative overflow-hidden px-6 py-20 sm:px-10 sm:py-28 print:py-8",
        dark ? "bg-neutral-950 text-neutral-100" : "bg-transparent text-neutral-900"
      )}
    >
      <div className={cn("relative mx-auto w-full", wide ? "max-w-5xl" : "max-w-3xl")}>
        {eyebrow && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--proposal-accent)]">
            {eyebrow}
          </p>
        )}
        <h2
          className={cn(
            "mb-10 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl",
            dark ? "text-white" : "text-neutral-900"
          )}
        >
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function CoverStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-neutral-950/55 px-4 py-4 backdrop-blur-sm sm:px-5 sm:py-5">
      <div
        className={cn(
          "font-display text-xl font-semibold leading-tight tracking-tight sm:text-2xl",
          accent ? "text-[var(--proposal-accent)]" : "text-white"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-neutral-400">{label}</div>
    </div>
  );
}

function FactCard({ i, k, v, note }: { i: number; k: string; v: string; note?: string }) {
  return (
    <div
      data-stagger
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
    >
      <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-2 font-display text-3xl font-semibold tracking-tight text-neutral-900">
        {v}
      </dd>
      {note && <p className="mt-1 text-sm text-neutral-500">{note}</p>}
    </div>
  );
}

/** A quiet label→value list. Rows with no value never render. */
function SpecList({ items }: { items: [string, string | null | undefined][] }) {
  const rows = items.filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-neutral-200/70 overflow-hidden rounded-2xl bg-white/60 px-6 ring-1 ring-neutral-200/60">
      {rows.map(([k, v], idx) => (
        <div
          key={k}
          data-stagger
          style={{ ["--i" as string]: idx } as React.CSSProperties}
          className="flex items-baseline justify-between gap-6 py-4"
        >
          <dt className="text-sm text-neutral-500">{k}</dt>
          <dd className="text-right font-medium text-neutral-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function EquipCard({
  i,
  label,
  e,
  unit,
}: {
  i: number;
  label: string;
  e: { manufacturer: string | null; model: string; ratingW: number | null; qty: number } | null;
  unit: string;
}) {
  if (!e) return null;
  return (
    <div
      data-stagger
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/60"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">{label}</p>
      <p className="mt-2 font-medium leading-snug text-neutral-900">
        {[e.manufacturer, e.model].filter(Boolean).join(" ")}
      </p>
      <p className="mt-2 text-sm tabular-nums text-neutral-500">
        {e.ratingW ? `${e.ratingW.toLocaleString()} ${unit}` : "—"}
        {e.qty > 0 ? ` · ${e.qty} total` : ""}
      </p>
    </div>
  );
}

/**
 * The one price the customer actually asks about, at the top of the money
 * chapter — the monthly on anything financed, the contract on a cash purchase,
 * the rate on a PPA. Everything else stays in the breakdown beneath it.
 */
function PriceHero({
  f,
  isPurchase,
}: {
  f: SolarProposalSnapshot["financing"];
  isPurchase: boolean;
}) {
  let label: string;
  let value: string;
  let note: string;

  if (f.loanMonthlyPaymentCents != null) {
    label = f.loanPaymentApproved ? "Your monthly payment" : "Your estimated monthly payment";
    value = usd(f.loanMonthlyPaymentCents, 2);
    note = f.loanPaymentApproved
      ? "Your lender's own figure, from an approval."
      : "Amortised from the quoted product. Your lender's approval settles the final figure.";
  } else if (f.monthlyPaymentCents != null) {
    label = "Your monthly payment";
    value = usd(f.monthlyPaymentCents, 2);
    note = f.termYears != null ? `Over a ${f.termYears}-year term.` : "";
  } else if (f.rateMillsPerKwh != null) {
    label = "What you pay per kWh";
    value = `$${(f.rateMillsPerKwh / 1000).toFixed(3)}`;
    note = "You pay for the power the system makes, not for the system.";
  } else if (isPurchase && f.contractPriceCents != null) {
    label = "Your total price";
    value = usd(f.contractPriceCents);
    note = "That is your all-in price for the system shown, installed.";
  } else {
    return null;
  }

  return (
    <div className="break-inside-avoid rounded-3xl bg-[var(--proposal-accent)] p-8 text-white sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/80">{label}</p>
      <p className="mt-3 font-display text-6xl font-bold leading-none tracking-tight sm:text-8xl">
        {value}
      </p>
      {note && <p className="mt-5 max-w-md leading-relaxed text-white/85">{note}</p>}
    </div>
  );
}

function DarkRow({
  k,
  v,
  strong,
  muted,
}: {
  k: string;
  v: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-6 px-5 py-3.5",
        strong && "bg-white/[0.06]"
      )}
    >
      <dt className={cn("text-neutral-300", muted && "pl-4 text-sm text-neutral-400")}>{k}</dt>
      <dd
        className={cn(
          "text-right font-medium tabular-nums text-white",
          strong && "font-display text-lg font-bold",
          muted && "text-sm text-neutral-300"
        )}
      >
        {v}
      </dd>
    </div>
  );
}

function Callout({
  i,
  label,
  value,
  note,
  tone,
}: {
  i: number;
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn";
}) {
  return (
    <div
      data-stagger
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className={cn(
        "rounded-2xl p-6 shadow-sm ring-1",
        tone === "good"
          ? "bg-emerald-50 ring-emerald-200"
          : tone === "warn"
            ? "bg-amber-50 ring-amber-200"
            : "bg-white ring-neutral-200/60"
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl",
          tone === "good"
            ? "text-emerald-700"
            : tone === "warn"
              ? "text-amber-800"
              : "text-neutral-900"
        )}
      >
        {value}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">{note}</p>
    </div>
  );
}

function Impact({
  i,
  icon: Icon,
  value,
  label,
}: {
  i: number;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div
      data-stagger
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-neutral-200/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
    >
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Icon className="size-5" />
      </span>
      <div className="mt-3 font-display text-2xl font-semibold tracking-tight text-neutral-900">
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-tight text-neutral-500">{label}</div>
    </div>
  );
}

function ContactCard({
  title,
  subtitle,
  lines,
}: {
  title: string;
  subtitle?: string;
  lines: (string | null | undefined)[];
}) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60">
      {subtitle && (
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">
          {subtitle}
        </p>
      )}
      <p className="mt-1 font-display text-lg font-semibold text-neutral-900">{title}</p>
      <ul className="mt-2 space-y-0.5 text-sm text-neutral-600">
        {shown.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The comparison chart
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Utility vs solar, as CUMULATIVE spend over the modelled horizon.
 *
 * Deliberately not the per-year bars this used to draw. On a cash or loan deal
 * year one carries the whole contract price, so a chart scaled to the largest
 * single year rendered one enormous bar and twenty-four slivers — the argument
 * was invisible in the picture that existed to make it.
 *
 * Running totals fix that and tell the real story besides: two rising lines,
 * the solar one stepping up front and then flattening, the utility one
 * compounding past it. Where they cross is the payback year, and the gap at the
 * right-hand edge IS the net saving quoted at the top of the document.
 *
 * All text lives in HTML around the plot rather than inside the SVG, so nothing
 * shrinks to 5px when the chart scales down on a phone.
 */
function CumulativeCostChart({
  years,
  paybackYear,
  netSavingsCents,
}: {
  years: SavingsYear[];
  paybackYear: number | null;
  netSavingsCents: number;
}) {
  const W = 720;
  const H = 260;
  const PAD_T = 10;
  const PAD_B = 10;

  const { utilityPts, solarPts, utilityTotal, solarTotal, span } = React.useMemo(() => {
    let u = 0;
    let s = 0;
    const uPts: [number, number][] = [];
    const sPts: [number, number][] = [];
    for (const y of years) {
      u += y.utilityCostCents;
      s += y.solarCostCents;
      uPts.push([y.year, u]);
      sPts.push([y.year, s]);
    }
    return {
      utilityPts: uPts,
      solarPts: sPts,
      utilityTotal: u,
      solarTotal: s,
      span: Math.max(u, s, 1),
    };
  }, [years]);

  if (years.length < 2) return null;

  const lastYear = years[years.length - 1].year;
  const x = (year: number) => ((year - 1) / (lastYear - 1)) * W;
  const y = (cents: number) => H - PAD_B - (cents / span) * (H - PAD_T - PAD_B);
  const pctX = (year: number) => (x(year) / W) * 100;
  const pctY = (cents: number) => (y(cents) / H) * 100;

  const path = (pts: [number, number][]) =>
    pts.map(([yr, c], i) => `${i === 0 ? "M" : "L"}${x(yr).toFixed(1)} ${y(c).toFixed(1)}`).join(" ");

  /**
   * The gap between the lines, split AT THE CROSSOVER.
   *
   * One flat emerald wash over the whole gap would have tinted the years before
   * payback — when the solar line is still the higher of the two — the colour
   * this document uses for money kept. Those years are the opposite of a
   * saving, so they get the utility's own colour and the wash only turns green
   * once the customer is genuinely ahead. The crossing point is interpolated
   * rather than snapped to a year boundary, so the two washes meet exactly
   * where the lines do.
   */
  const bands: { ahead: boolean; d: string }[] = [];
  {
    let cur: { ahead: boolean; pts: [number, number, number][] } | null = null;
    const close = () => {
      if (cur && cur.pts.length > 1) {
        const fwd = cur.pts
          .map(([yr, u], i) => `${i === 0 ? "M" : "L"}${x(yr).toFixed(1)} ${y(u).toFixed(1)}`)
          .join(" ");
        const back = [...cur.pts]
          .reverse()
          .map(([yr, , sv]) => `L${x(yr).toFixed(1)} ${y(sv).toFixed(1)}`)
          .join(" ");
        bands.push({ ahead: cur.ahead, d: `${fwd} ${back} Z` });
      }
    };
    for (let i = 0; i < utilityPts.length; i++) {
      const [yr, u] = utilityPts[i];
      const sv = solarPts[i][1];
      const ahead = u >= sv;
      if (cur && cur.ahead !== ahead) {
        // Where the two lines actually cross, between this point and the last.
        const [pYr, pU] = utilityPts[i - 1];
        const pS = solarPts[i - 1][1];
        const denom = pU - pS - (u - sv);
        const t = denom === 0 ? 0 : (pU - pS) / denom;
        const cx = pYr + t * (yr - pYr);
        const cv = pU + t * (u - pU);
        cur.pts.push([cx, cv, cv]);
        close();
        cur = { ahead, pts: [[cx, cv, cv]] };
      } else if (!cur) {
        cur = { ahead, pts: [] };
      }
      cur.pts.push([yr, u, sv]);
    }
    close();
  }

  const ticks = years.map((yr) => yr.year).filter((n) => n === 1 || n % 5 === 0 || n === lastYear);

  /** Edge-aware alignment, so the first and last labels stay inside the card. */
  const align = (p: number) =>
    p <= 2 ? "translate-x-0" : p >= 98 ? "-translate-x-full" : "-translate-x-1/2";

  return (
    <figure className="mt-10">
      <figcaption className="mb-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <span className="text-sm font-semibold text-neutral-900">
          What you will have spent, year by year
        </span>
        <span className="text-xs text-neutral-500">
          Running totals over {years.length} years, including any grid power still bought.
        </span>
      </figcaption>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/60 sm:p-7">
        {/* The payback flag gets its own row so it never sits on the data. */}
        <div className="relative mb-1 h-6 pl-12">
          {paybackYear != null && (
            <span
              className={cn(
                "absolute top-0 whitespace-nowrap rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white",
                align(pctX(paybackYear))
              )}
              style={{ left: `${pctX(paybackYear)}%` }}
            >
              Pays for itself · year {paybackYear}
            </span>
          )}
        </div>

        <div className="relative pl-12">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Cumulative cost over ${years.length} years: staying with the utility reaches ${usd(utilityTotal)}, going solar reaches ${usd(solarTotal)}.`}
          >
            {/* Recessive grid — quarters of the range, nothing more. */}
            {[0.25, 0.5, 0.75, 1].map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={y(span * t)}
                y2={y(span * t)}
                stroke="#e7e2da"
                strokeWidth={1}
              />
            ))}
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#d6d0c6" strokeWidth={1} />

            {bands.map((b, i) => (
              <path
                key={i}
                d={b.d}
                fill={b.ahead ? SOLAR_INK : UTILITY_INK}
                fillOpacity={b.ahead ? 0.1 : 0.07}
              />
            ))}

            {paybackYear != null && (
              <line
                x1={x(paybackYear)}
                x2={x(paybackYear)}
                y1={PAD_T - 6}
                y2={y(0)}
                stroke="#a8a29e"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}

            <path
              d={path(utilityPts)}
              fill="none"
              stroke={UTILITY_INK}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path(solarPts)}
              fill="none"
              stroke={SOLAR_INK}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* End markers, ringed in the surface colour so they sit on top of
                the lines cleanly. */}
            <circle
              cx={x(lastYear)}
              cy={y(utilityTotal)}
              r={5}
              fill={UTILITY_INK}
              stroke="#ffffff"
              strokeWidth={2}
            />
            <circle
              cx={x(lastYear)}
              cy={y(solarTotal)}
              r={5}
              fill={SOLAR_INK}
              stroke="#ffffff"
              strokeWidth={2}
            />
          </svg>

          {/* The y scale, in HTML — inside the SVG it would shrink with the
              viewBox and be unreadable on a phone. */}
          {[0, 0.5, 1].map((t) => (
            <span
              key={t}
              className="absolute left-0 w-10 -translate-y-1/2 text-right text-[10px] tabular-nums text-neutral-400"
              style={{ top: `${pctY(span * t)}%` }}
            >
              {usdCompact(span * t)}
            </span>
          ))}
        </div>

        {/* X axis, in HTML so it stays legible at any width. */}
        <div className="relative mt-2 h-4 pl-12">
          {ticks.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute text-[11px] tabular-nums text-neutral-400",
                align(pctX(t))
              )}
              style={{ left: `${pctX(t)}%` }}
            >
              {t === 1 ? "Yr 1" : t}
            </span>
          ))}
        </div>

        {/* Legend and direct totals in one row — identity is never colour alone. */}
        <dl className="mt-7 grid gap-4 border-t border-neutral-100 pt-5 sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-2 text-xs font-medium text-neutral-500">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: UTILITY_INK }}
                aria-hidden
              />
              Staying with the utility
            </dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-neutral-900">
              {usd(utilityTotal)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-xs font-medium text-neutral-500">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: SOLAR_INK }}
                aria-hidden
              />
              Going solar
            </dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-neutral-900">
              {usd(solarTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-500">The difference</dt>
            <dd
              className={cn(
                "mt-1 font-display text-xl font-semibold tabular-nums",
                netSavingsCents >= 0 ? "text-emerald-700" : "text-amber-800"
              )}
            >
              {usd(netSavingsCents)}
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        The shaded gap is the difference between the two. It is amber while the system is still
        paying itself back{paybackYear != null ? `, and green from year ${paybackYear} on` : ""}.
      </p>
    </figure>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Acceptance & print
   ════════════════════════════════════════════════════════════════════════ */

function AcceptForm({ token, onSigned }: { token: string; onSigned: () => void }) {
  const [name, setName] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Please type your full name.");
    if (!agreed) return toast.error("Please confirm you have read the proposal.");
    setBusy(true);
    try {
      const res = await acceptSolarProposalAction(token, name.trim());
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      toast.success("Proposal accepted");
      onSigned();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      // Always released, whatever the action did. A busy flag left latched on a
      // throw is a form the customer can no longer submit and cannot see why.
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-6 text-neutral-900 shadow-xl sm:p-7">
      <div className="space-y-1.5">
        <label htmlFor="sig" className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">
          Type your full name to accept
        </label>
        <input
          id="sig"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          autoComplete="name"
          className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 font-display text-xl outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
      </div>
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-neutral-500">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-neutral-900"
        />
        I have read this proposal and understand the figures are estimates, not a guarantee, and
        that financing is subject to credit approval.
      </label>
      <button
        onClick={submit}
        disabled={busy}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Accept this proposal
      </button>
    </div>
  );
}

/**
 * Print rules that belong to THIS document.
 *
 * The heavy lifting — print-color-adjust on every descendant of #proposal-root,
 * the chapter break rules, the zero page margin — lives in globals.css and now
 * applies here too, because this document finally carries that id. What is left
 * is the one thing globals cannot know: the assumptions block is a <details>,
 * and a printed proposal has to show what is inside it.
 */
function PrintStyles() {
  return (
    <style>{`
      @media print {
        html, body { background: #fff !important; }
        details { display: block; }
        details > summary { display: none; }
        a[href]::after { content: ""; }
      }
    `}</style>
  );
}
