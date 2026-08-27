"use client";

import * as React from "react";
import { Leaf, TreePine, Factory, Car, Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SolarProposalSnapshot, ProposalPaymentOption } from "@/lib/solar-proposal";
import {
  SOLAR_TIMELINE,
  SOLAR_FAQS,
  IMPACT_SOURCES,
  postSolarUtilityCents,
} from "@/lib/solar-proposal";
import { coverPitch, lifetimeFigure, lifetimeNote, monthlyToday } from "@/lib/solar-proposal-pitch";
import { PROPOSAL_NAV_PX } from "@/lib/proposal";
import { LenderMark } from "@/components/ui/lender-mark";
import { ProposalChrome, type ChromeNavItem } from "../proposal-chrome";
import { PaymentMenu } from "../payment-menu";
import { SavingsScrubber } from "../savings-scrubber";
import { BatteryCredit } from "../battery-credit";
import { YearChart } from "../year-chart";
import { CompareCards } from "../compare-cards";
import { HowItWorks } from "../how-it-works";
import { ArrayMap } from "../array-map";
import { RepBar, type RepContext } from "../rep-bar";
import { usd, kwh, pct, pctWhole } from "../format";
import { Chapter, Stat, SpecList, DarkRow, EquipCard, Impact, SourceLink, ContactCard } from "./primitives";
import { Cover, BillSwap } from "./cover";
import { CumulativeCostChart } from "./chart";
import { AcceptForm, PrintStyles } from "./accept";
import { useDeckKeys } from "./deck";

/**
 * The customer-facing solar proposal.
 *
 * An editorial DOCUMENT read as a deck: seven chapters on warm paper, each one
 * a snap target so a rep advancing on a tablet lands on a composed screen while
 * a homeowner on a phone just scrolls.
 *
 * It was twelve chapters. The twelve repeated themselves — the lifetime figure
 * appeared four times and the system specs three — and gave equal weight to
 * everything, which is the same as giving weight to nothing. Seven chapters,
 * each figure stated once, in the order a household actually asks:
 *
 *   1 Cover · 2 Today → Tomorrow · 3 Your system · 4 Your cost
 *   5 Over N years · 6 What happens next · 7 Accept
 *
 * Every figure comes from the FROZEN snapshot — nothing is recomputed here, so
 * what the customer sees is exactly what was generated for them, whatever the
 * company's assumptions do afterwards.
 *
 * Two rules govern what appears:
 *   1. A chapter with no data is OMITTED, never rendered empty. There is no
 *      "$0 federal credit" tile and no broken image.
 *   2. Nothing internal is shown. Cost, margin, commission and the dealer fee
 *      are all in the snapshot's source rows and none of them reach this file.
 */

const PRODUCT_LABEL: Record<string, string> = {
  cash: "Cash purchase",
  loan: "Solar loan",
  lease: "Solar lease",
  ppa: "Power purchase agreement",
};

/**
 * The payment menu a document offers, including the ones that offer no menu.
 *
 * A proposal generated before v4 has no `options` array at all — it has one
 * financing block and one savings model, which is exactly the same thing as a
 * menu of one. Synthesising that single option here means the whole document
 * below has ONE code path: nothing has to ask whether this is an old snapshot,
 * and no chapter is written twice.
 */
function paymentOptions(s: SolarProposalSnapshot): ProposalPaymentOption[] {
  if (s.options && s.options.length > 0) return s.options;

  const f = s.financing;
  const year1 = s.savings.years[0];
  const monthlyCents =
    f.product === "cash"
      ? null
      : f.product === "loan"
        ? f.loanMonthlyPaymentCents
        : f.product === "lease"
          ? f.monthlyPaymentCents
          : year1
            ? Math.round(year1.solarPaymentCents / 12)
            : null;

  return [
    {
      key: "quoted",
      label: PRODUCT_LABEL[f.product] ?? f.product,
      quoted: true,
      financing: f,
      savings: s.savings,
      monthlyCents,
      postSolarMonthlyCents: year1 ? Math.round(postSolarUtilityCents(year1) / 12) : 0,
    },
  ];
}

/**
 * The name on the cover, as a person's name.
 *
 * Leads arrive from web forms and canvassing apps with whatever casing the
 * person typed, so "mustafa" is a normal thing to find in the column. Printing
 * it verbatim in 70px display type is the single most obvious tell that a
 * document was machine-made, so the FIRST NAME is cased for display only —
 * nothing is written back, and a name that is already cased is untouched.
 */
function firstName(full: string | null | undefined): string {
  const raw = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * A loan's term, written the way the household will experience it.
 *
 * The payment count is stated as well as the years, because the years below
 * now bill twelve payments each and "30 years" alone leaves a customer
 * multiplying in their head to check the arithmetic on their own proposal.
 */
function loanTermLabel(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const span =
    rest === 0
      ? `${years} year${years === 1 ? "" : "s"}`
      : years === 0
        ? `${rest} month${rest === 1 ? "" : "s"}`
        : `${years} yr ${rest} mo`;
  return `${span} · ${months} payments`;
}

export function SolarProposalView({
  snapshot,
  token,
  alreadySigned,
  superseded,
  previewMode = false,
  layoutImageUrl = null,
  showComparison = true,
  showPaymentOptions = true,
  siteImageBase = null,
  rep = null,
  accentColor,
  chromeOffset = 0,
}: {
  snapshot: SolarProposalSnapshot;
  token: string;
  /**
   * Whether to render the utility-versus-solar chapter.
   *
   * A PRESENTATION choice held on the proposal row, not in the snapshot: every
   * figure the customer was quoted stays exactly where it was, and a rep who
   * decides at the table that this household reads the table as a wall of
   * numbers can turn it off without reissuing the document. When it is off the
   * lifetime figure moves up into chapter 2 rather than vanishing.
   */
  showComparison?: boolean;
  /**
   * Whether the customer's copy offers the payment menu.
   *
   * A PRESENTATION choice on the proposal row, like `showComparison`: the
   * options themselves are frozen into the snapshot either way.
   */
  showPaymentOptions?: boolean;
  /**
   * Where to fetch the aerial imagery the array is drawn on, resolved by the
   * CALLER — the customer's copy uses its token-scoped route, and a preview
   * inside the portal has no such route and passes null, falling back to the
   * uploaded drawing.
   */
  siteImageBase?: string | null;
  /**
   * The rep's own controls, on the document.
   *
   * Passed ONLY by the portal preview, and only for somebody allowed to reissue
   * a proposal — the customer's copy never receives it. Every action behind it
   * re-checks the permission on the server regardless: a component that is not
   * rendered is not a guard.
   */
  rep?: RepContext | null;
  alreadySigned: boolean;
  superseded: boolean;
  /**
   * Where to fetch the panel layout, resolved by the CALLER. Null means the
   * drawing is not available and the block is omitted — never a placeholder,
   * and never an <img> that resolves to a broken icon in front of a homeowner.
   */
  layoutImageUrl?: string | null;
  /**
   * Renders the document exactly as the customer would see it, with acceptance
   * DISABLED. The one thing a preview must never do is let someone accept.
   */
  previewMode?: boolean;
  /** The brand accent, resolved by the caller from the DEAL's vertical. */
  accentColor?: string | null;
  /**
   * Pixels of surrounding app chrome already pinned above the document's own
   * nav. The embedder owns this number — the document knows nothing about the
   * portal it may be previewed inside.
   */
  chromeOffset?: number;
}) {
  /**
   * The document on screen, and which version it is.
   *
   * STATE rather than the prop directly, because a rep re-pricing from the bar
   * gets a freshly generated snapshot back and it has to replace what is under
   * the customer's eyes without a page reload — a reload at a kitchen table is
   * a blank screen in the middle of a sentence.
   */
  const [live, setLive] = React.useState({ snapshot, version: rep?.version ?? 0 });
  const [seenProp, setSeenProp] = React.useState(snapshot);
  if (seenProp !== snapshot) {
    setSeenProp(snapshot);
    setLive({ snapshot, version: rep?.version ?? 0 });
  }
  const s = live.snapshot;
  const [signed, setSigned] = React.useState(alreadySigned);

  const options = React.useMemo(() => paymentOptions(s), [s]);
  const [optionKey, setOptionKey] = React.useState(options[0].key);
  const option = options.find((o) => o.key === optionKey) ?? options[0];
  const f = option.financing;
  const sv = option.savings;

  const isPurchase = f.product === "cash" || f.product === "loan";
  const showcased = (f.adders ?? []).filter((a) => a.showcase && a.amountCents !== 0);
  const name = firstName(s.customer.name);
  const hasEquipment = !!(s.system.module || s.system.inverter || s.system.battery);

  const sitePanels = s.site?.panels ?? [];
  const hasArrayMap = !!(siteImageBase && s.site && sitePanels.length > 0);
  const hasUploadedLayout = !!(s.layout && layoutImageUrl);
  const hasLayout = hasArrayMap || hasUploadedLayout;

  /* ── what the money says ────────────────────────────────────────────────
     Both answers are decided in @/lib/solar-proposal-pitch, where they are
     tested. See that module for why the cover is not allowed to run one
     template across every deal. */
  const billCents = monthlyToday(s.energy.avgMonthlyBillCents, sv);
  const pitch = coverPitch({
    billCents,
    option,
    savings: sv,
    priceCents: f.contractPriceCents,
  });
  const lifetime = lifetimeFigure(sv);
  /**
   * Battery programmes, from the snapshot rather than the live provider list.
   * ABSENT on every document generated before they were modelled, which reads
   * as none — exactly what those documents were priced with.
   */
  const vpp = s.vpp ?? [];
  /**
   * What the battery earns every year, and who pays it — for the sentence under
   * the table that has to account for a "with solar" column smaller than the
   * utility bill inside it. The upfront enrolment money is deliberately left
   * out: it lands once, in year one, and folding it into a per-year figure
   * would overstate every other year.
   */
  const vppAnnualCents = vpp.reduce((n, v) => n + v.annualCents, 0);
  /** The one-off enrolment money, for the lifetime total that does count it. */
  const vppUpfrontCents = vpp.reduce((n, v) => n + v.upfrontCents, 0);
  /**
   * The PROGRAMME's name where there is exactly one, because the programme is
   * what pays. The provider row it is filed under is a territory — this
   * company files one programme under five different utilities — so naming the
   * provider here credited the wires company with a retailer's money.
   */
  const vppPayer = vpp.length === 1 ? vpp[0].programme : "your battery programme";
  const afterAllCents =
    option.monthlyCents != null
      ? option.monthlyCents + option.postSolarMonthlyCents
      : option.postSolarMonthlyCents;

  /* ── the chapters that exist for THIS document ─────────────────────────── */
  const chapters = [
    { id: "today", label: "Today" },
    { id: "system", label: "System" },
    { id: "cost", label: "Your cost" },
    ...(showComparison ? [{ id: "savings", label: `${sv.years.length} years` }] : []),
    { id: "timeline", label: "Next" },
    { id: "accept", label: "Accept" },
  ];
  const total = chapters.length;
  const num = (id: string) => chapters.findIndex((c) => c.id === id) + 1;
  const navItems: ChromeNavItem[] = chapters;

  useDeckKeys(true);

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

      {/* ── 1 · COVER ─────────────────────────────────────────────────────── */}
      <Cover s={s} name={name} pitch={pitch} />

      {/* ── 2 · TODAY → TOMORROW ──────────────────────────────────────────
          The old document argued this twice: a "headline" chapter that repeated
          the cover's stats, then a "today" chapter with the bill in it. One
          chapter, one comparison, drawn. */}
      <Chapter
        id="today"
        index={num("today")}
        total={total}
        eyebrow="Where you are now"
        title="What changes on the first of the month"
        lede={
          <>
            Today every kilowatt-hour your home uses is bought from{" "}
            {s.energy.utilityProvider ?? "your utility"} at a rate they set. After this system is
            switched on, most of them are made on your roof.
          </>
        }
      >
        <BillSwap todayCents={billCents} afterCents={afterAllCents} />

        <p className="mt-5 max-w-[52ch] text-sm leading-relaxed text-neutral-500">
          {option.monthlyCents != null ? (
            <>
              &ldquo;After&rdquo; is your {usd(option.monthlyCents, 2)} payment plus the{" "}
              {usd(option.postSolarMonthlyCents, 2)} {s.energy.utilityProvider ?? "your utility"}{" "}
              still bills you — the grid power the system does not cover, and their fixed monthly
              meter charge, which is billed whatever your roof produces. The whole cost of the
              solar path, not the flattering half of it.
            </>
          ) : (
            <>
              &ldquo;After&rdquo; is the grid power the system does not cover, plus your utility&rsquo;s
              fixed monthly meter charge, which is billed whatever your roof produces. The system
              itself is paid for once, up front, and is yours from the day it is switched on.
            </>
          )}
        </p>

        <div className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
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
              ["Rising by", pct(s.assumptions.utilityEscalationPct) + " a year"],
            ]}
          />
          <dl className="grid grid-cols-2 gap-x-8 gap-y-6 self-start">
            <Stat
              k="Solar covers"
              v={kwh(s.system.year1ProductionKwh)}
              note="in year one"
              size="sm"
            />
            <Stat
              k="Of your usage"
              v={pctWhole(s.system.offsetPct)}
              note="energy offset"
              size="sm"
            />
          </dl>
        </div>

        <p className="mt-6 text-sm text-neutral-500">
          Your rate is worked out from your own bill and usage — not a regional average.
        </p>

        {/* The shape of the year, when both halves of it are real. See the
            snapshot's `monthly` field for why it is usually not. */}
        {s.monthly && (
          <div className="mt-14">
            <h3 className="font-display text-2xl font-semibold tracking-tight text-neutral-900">
              Your year, month by month
            </h3>
            <p className="mt-2 max-w-[52ch] leading-relaxed text-neutral-600">
              An annual figure hides the two things that actually decide your bill: summer makes
              more than you use, and winter makes less. The credit you build in June is what pays
              for December.
            </p>
            <YearChart productionKwh={s.monthly.productionKwh} usageKwh={s.monthly.usageKwh} />
          </div>
        )}

        {/* The lifetime figure lives in chapter 5. When a rep has turned that
            chapter off, it moves here rather than disappearing — the document
            must not lose the one number that nets the system against the bill. */}
        {!showComparison && (
          <div className="mt-14">
            <LifetimeBlock
              label={lifetime.label}
              value={usd(lifetime.cents)}
              note={lifetimeNote(lifetime, s.energy.utilityProvider)}
              accent={lifetime.tone === "good"}
            />
          </div>
        )}
      </Chapter>

      {/* ── 3 · YOUR SYSTEM ───────────────────────────────────────────────
          Specs, equipment and the array on ONE screen. They were three
          chapters, which meant a homeowner met the size, then the hardware,
          then a picture of their own roof as if the three were separate claims.
          Together they are one. */}
      <Chapter
        id="system"
        index={num("system")}
        total={total}
        eyebrow="The design"
        title="Your system"
        wide
      >
        <dl className="grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
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
                <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                  {k}
                </dt>
                <dd className="mt-1.5 text-lg font-medium text-neutral-900">{v}</dd>
              </div>
            ))}
        </dl>

        {/* ── the array, on this customer's own roof ──────────────────────
            Two drawings, in order of how much they are worth. The LIVE aerial
            is the array as drawn projected onto satellite imagery a homeowner
            can zoom into until they recognise their own driveway. The UPLOADED
            export says the same thing standing still.

            Neither available means NO BLOCK. Never a placeholder, never an
            empty frame, and never the bare aerial photo with no array on it
            standing in for a design that was not done. */}
        {hasLayout && (
          <figure data-dark-ground className="mt-12 overflow-hidden rounded-2xl bg-neutral-950 p-4 ring-1 ring-neutral-900/10 [print-color-adjust:exact] [-webkit-print-color-adjust:exact] sm:p-5">
            {hasArrayMap && s.site ? (
              <ArrayMap
                lat={s.site.lat}
                panels={sitePanels}
                imageUrl={(z) => `${siteImageBase}?z=${z}`}
                fallback={
                  hasUploadedLayout ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={layoutImageUrl!}
                      alt={`Panel layout for ${s.customer.address}`}
                      className="h-auto max-h-[62vh] w-full rounded-xl bg-neutral-900 object-contain ring-1 ring-white/10"
                    />
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-neutral-400">
                      The aerial view of your roof could not be loaded. Your consultant can send the
                      layout drawing separately.
                    </p>
                  )
                }
              />
            ) : (
              /* The uploaded drawing, rendered EXACTLY as designed:
                 `object-contain` inside an auto-height box, so it is never
                 cropped, stretched or repositioned. The panel positions ARE the
                 design — distorting them would misrepresent where the array
                 actually goes. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={layoutImageUrl!}
                alt={`${s.layout?.preliminary ? "Preliminary panel" : "Panel"} layout for ${s.customer.address}`}
                className="h-auto max-h-[62vh] w-full rounded-xl bg-neutral-900 object-contain ring-1 ring-white/10"
              />
            )}
            <figcaption className="mt-4 max-w-[62ch] px-1 text-sm leading-relaxed text-neutral-400">
              {s.layout?.preliminary === false
                ? "Final design, confirmed by your project team. Minor adjustments can still arise during installation."
                : "Preliminary design. The final layout is confirmed at your site survey and may change once the roof and electrical panel have been measured."}
              {s.layout?.provider ? ` Produced in ${s.layout.provider}.` : ""}
            </figcaption>
          </figure>
        )}

        {hasEquipment && (
          <>
            <p className="mt-14 mb-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
              Equipment
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <EquipCard i={0} label="Panels" e={s.system.module} unit="W each" />
              <EquipCard i={1} label="Inverter" e={s.system.inverter} unit="W" />
              <EquipCard i={2} label="Battery" e={s.system.battery} unit="Wh" />
            </div>
            <p className="mt-4 max-w-[62ch] text-sm text-neutral-500">
              Manufacturer warranties apply to each component as published by that manufacturer.
              Your written agreement sets out the workmanship warranty in full.
            </p>
          </>
        )}

        {/* Was a chapter of its own, between the money and the design. Somebody
            reading this alone at ten at night will not ring anyone to ask what
            an inverter is, and they will not sign something they do not
            understand — but it does not deserve a full stop in the argument. */}
        <div className="mt-16 border-t border-neutral-900/12 pt-10">
          <h3 className="font-display text-2xl font-semibold tracking-tight text-neutral-900">
            How solar actually works
          </h3>
          <div className="mt-6">
            <HowItWorks />
          </div>
        </div>
      </Chapter>

      {/* ── 4 · YOUR COST ─────────────────────────────────────────────────── */}
      <Chapter
        id="cost"
        index={num("cost")}
        total={total}
        eyebrow="Your investment"
        title="How you pay for it"
        tone="dark"
      >
        {/* The menu, and the close.
            Everything it shows was priced on the server and frozen — switching
            reads a different answer out of the document, it does not compute
            one. See ../payment-menu. */}
        <PaymentMenu
          options={options}
          selectedKey={option.key}
          onSelect={setOptionKey}
          showMenu={showPaymentOptions}
        />

        {options.length > 1 && showPaymentOptions && (
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-neutral-400">
            Every option above is priced for this system and this address. They differ in what the
            money costs, not in what gets installed — the panels, the inverter and the production
            are the same whichever you choose.
          </p>
        )}

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
          {/* A LOAN's term, which `termYears` has never carried — that column
              belongs to leases, so a financed document showed a monthly payment
              with nothing beside it saying how many there were. It matters more
              now that the years below bill the payment rather than the price.
              Guarded on `termYears` too, so nothing can print two Term rows. */}
          {f.termYears == null && f.loanTermMonths != null && f.loanTermMonths > 0 && (
            <DarkRow k="Term" v={loanTermLabel(f.loanTermMonths)} />
          )}
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

        {/* WHAT THE BATTERY EARNS, next to the payment it offsets.
            Here rather than in the twenty-five-year chapter because this is the
            chapter about what the household pays each month, and because a rep
            can turn that chapter off — the credit was priced into this deal
            either way and must not disappear with the table. */}
        <BatteryCredit vpp={vpp} monthlyCents={option.monthlyCents} lender={f.lender} />

        {/*
          ADDITIONAL SERVICES — the extra work, in sentences rather than as a
          figure in a column.

          The breakdown above already names every line, which answers "what am
          I paying for". It does not answer "what IS that", and a homeowner
          reading "Full Service Upgrade — $3,500" at their kitchen table with
          nobody to ask has no way to find out. Only the lines the company chose
          to explain appear here, so an internal cost line does not become a
          paragraph the customer has to read to learn nothing.
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

        {f.loanPaydownCents != null && (
          <p className="mt-6 max-w-[62ch] break-inside-avoid rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-200">
            <strong className="text-amber-100">Read this one twice:</strong> the lower payment
            assumes the paydown shown above is applied to the loan by the month stated. If it is
            not, the payment becomes the higher figure for the rest of the term. Whether you receive
            the federal credit, and how much, depends on your own tax situation.
          </p>
        )}
      </Chapter>

      {/* ── 5 · OVER N YEARS ──────────────────────────────────────────────── */}
      {showComparison && (
        <Chapter
          id="savings"
          index={num("savings")}
          total={total}
          eyebrow="The maths"
          title={`Twenty-five years, both ways`}
          wide
        >
          {/* The two futures, side by side. The column most proposals forget
              to price is the one where the homeowner does nothing. */}
          <CompareCards snapshot={s} option={option} />

          <div className="mt-10">
            <CumulativeCostChart years={sv.years} paybackYear={sv.paybackYear} />
          </div>

          {/* The lifetime figure. Once, here, named for what it actually is —
              see @/lib/solar-proposal-pitch for why a negative result is called
              a cost and is not given the accent colour. */}
          <div className="mt-10">
            <LifetimeBlock
              label={lifetime.label}
              value={usd(lifetime.cents)}
              note={lifetimeNote(lifetime, s.energy.utilityProvider)}
              accent={lifetime.tone === "good"}
              aside={
                <>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    Utility bill avoided
                  </span>
                  <span className="mt-1.5 block font-display text-2xl font-semibold tabular-nums text-white">
                    {usd(sv.utilityCostAvoidedCents)}
                  </span>
                  <span className="mt-1 block text-sm text-neutral-400">
                    before paying for the system
                  </span>
                </>
              }
            />
          </div>

          {/* WHERE THE EXTRA MONEY COMES FROM.
              The programme's payments are already inside every figure above, so
              without this block the savings are simply larger than the
              arithmetic on the page explains — and a number a homeowner cannot
              trace is a number they stop believing. Named, with its own terms
              stated, so they can check it against their own enrolment. */}
          {vpp.length > 0 && (
            <div className="mt-10 rounded-2xl border border-neutral-900/12 bg-white p-6">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                Included above
              </span>
              <div className="mt-3 space-y-3">
                {vpp.map((v) => (
                  <div key={`${v.provider}-${v.programme}`}>
                    <p className="font-display text-lg font-semibold text-neutral-900">
                      {v.programme}
                      {v.annualCents > 0 && (
                        <span className="ml-2 tabular-nums">{usd(v.annualCents)}/yr</span>
                      )}
                    </p>
                    {/* An enrolment, not a cheque from the wires company —
                        see the note in ../battery-credit. */}
                    <p className="mt-0.5 text-sm leading-relaxed text-neutral-600">
                      Your battery is enrolled on {v.provider}&rsquo;s network and paid for letting
                      them draw on it when the grid is short
                      {v.batteryQty > 1 ? ` (${v.batteryQty} batteries)` : ""}
                      {v.upfrontCents > 0
                        ? `, plus ${usd(v.upfrontCents)} when you enrol`
                        : ""}
                      .
                    </p>
                  </div>
                ))}
              </div>
              {/* WHAT IT COMES TO OVER THE PROJECTION — the figure this
                  chapter is for, and the one the monthly card on the cost
                  chapter deliberately does not state. A programme paying $400 a
                  year is a rounding error in a sentence and $10,000 over the
                  table above, and only one of those two readings explains why
                  the solar column sits where it does. */}
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
                <span className="font-display text-2xl font-bold tabular-nums text-neutral-900">
                  {/* Straight off the model, so it agrees with the table to
                      the cent. Safe to read directly: a snapshot old enough to
                      lack this total is old enough to have no `vpp` either, and
                      this whole block is behind that. */}
                  {usd(sv.vppCreditTotalCents)}
                </span>
              </div>

              {/* The honest caveat, next to the money rather than in the small
                  print at the end. Enrolment is the homeowner's to keep. */}
              <p className="mt-4 max-w-[62ch] text-xs leading-relaxed text-neutral-500">
                {/* ONE template literal, deliberately, rather than prose with
                    `{n}` sitting in it.

                    Where a literal ends in a space and an expression follows,
                    the JSX transform keeps only ONE of the two spaces around
                    the boundary and attaches it to the text BEFORE — so
                    `all {n} years above` compiles to "all 25years above", and
                    moving the space inside the expression only pushes the
                    problem to "25 yearsabove". A homeowner reads this sentence;
                    it does not get to depend on that rule. */}
                {`Counted for all ${sv.years.length} years above at today\u2019s rate. Enrolment is between you and ${
                  vpp.length === 1 ? vpp[0].provider : "your provider"
                }, and the programme\u2019s terms are theirs to change \u2014 these payments are an estimate on the same footing as the rest of this page, not a guarantee.`}
              </p>
            </div>
          )}

          <p className="mt-8 max-w-[62ch] leading-relaxed text-neutral-600">
            Assumes your utility rate rises {pct(s.assumptions.utilityEscalationPct)} a year and
            your panels lose {pct(s.assumptions.annualDegradationPct)} output annually. Both are
            estimates, not guarantees.
          </p>

          {/* Year by year, with a handle on it. Some households read the table
              below as the proof and some read it as a wall of numbers; this is
              the same model, one year at a time. */}
          <SavingsScrubber
            years={sv.years}
            paybackYear={sv.paybackYear}
            vpp={vpp}
            monthlyCents={option.monthlyCents}
          />

          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">
                Projected annual cost with the utility compared with going solar
              </caption>
              <thead className="border-b border-neutral-900/15 text-left text-[11px] uppercase tracking-[0.12em] text-neutral-500">
                <tr>
                  <th scope="col" className="py-3 pr-4 font-semibold">
                    Year
                  </th>
                  <th scope="col" className="py-3 pr-4 text-right font-semibold">
                    If you stay with the utility
                  </th>
                  <th scope="col" className="py-3 pr-4 text-right font-semibold">
                    If you go solar
                  </th>
                  <th scope="col" className="py-3 text-right font-semibold">
                    Kept so far
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900/8">
                {sv.years
                  .filter((y) => y.year === 1 || y.year % 5 === 0)
                  .map((y) => (
                    <tr key={y.year} className="break-inside-avoid">
                      <td className="py-3 pr-4 tabular-nums text-neutral-500">{y.year}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-neutral-700">
                        {usd(y.utilityCostCents)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-neutral-700">
                        {usd(y.solarCostCents)}
                      </td>
                      <td className="py-3 text-right font-semibold tabular-nums text-neutral-900">
                        {usd(y.cumulativeSavingsCents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* HOW TO READ THE COLUMN. One template literal per sentence rather
              than prose with expressions sitting in it — see the note in the
              battery block above for what JSX does to the spaces otherwise. */}
          <div className="mt-3 max-w-[72ch] space-y-1.5 text-xs leading-relaxed text-neutral-500">
            <p>
              {`\u201cIf you go solar\u201d is the power you still buy from the utility, plus what you pay for the system that year${
                vppAnnualCents > 0
                  ? `, less the ${usd(vppAnnualCents)} a year your battery earns from ${vppPayer}`
                  : ""
              }.`}
            </p>
            {sv.years.some((y) => y.solarCostCents < 0) && (
              <p>
                {`Where that column is a minus figure, the battery is earning more than the power you still buy costs \u2014 your electricity pays you that year instead of costing you.`}
              </p>
            )}
            {/* WHAT YEAR ONE MEANS, and it is not the same sentence for both.
                Bought outright, the whole price really does land in year one.
                Financed, it never does — the years carry the payments, which is
                what the household is actually billed. This paragraph used to
                say the first thing to everybody, on a document quoting a
                monthly payment. */}
            {sv.years[0] != null &&
              sv.years[0].solarPaymentCents > 0 &&
              sv.years[1]?.solarPaymentCents === 0 && (
                <p>
                  {`Year 1 carries the whole price of the system, ${usd(sv.years[0].solarPaymentCents)}, because it is bought outright. Every year after it shows only what the power costs.`}
                </p>
              )}
            {option.monthlyCents != null && sv.years[0] != null && sv.years[0].solarPaymentCents > 0 && (
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
            {/* A TERM LONGER THAN THE TABLE. The rows stop at year 25 and a
                30-year loan does not, so the total above is not everything the
                household pays — it is everything they pay inside the window the
                table draws. Saying which is the difference between a projection
                and a figure that turns out to have been missing five years of
                payments. */}
            {option.monthlyCents != null &&
              f.loanTermMonths != null &&
              f.loanTermMonths > sv.years.length * 12 && (
                <p>
                  {`Your loan runs ${loanTermLabel(f.loanTermMonths)}, which is longer than the ${sv.years.length} years shown here. The ${
                    f.loanTermMonths - sv.years.length * 12
                  } payments after the last row — about ${usd(
                    (f.loanTermMonths - sv.years.length * 12) * option.monthlyCents
                  )} — are not in the totals above.`}
                </p>
              )}
          </div>
        </Chapter>
      )}

      {/* ── 6 · WHAT HAPPENS NEXT ─────────────────────────────────────────
          The plan, with the environmental figures folded in as a band beneath
          it. They used to be a chapter of their own — four EPA equivalences do
          not earn a full stop in the middle of a sales document, but they are
          worth stating. */}
      <Chapter
        id="timeline"
        index={num("timeline")}
        total={total}
        eyebrow="The plan"
        title="What happens next"
        wide
      >
        <ol className="relative space-y-1">
          <span
            className="pointer-events-none absolute bottom-8 left-[24px] top-8 w-px bg-neutral-900/15 print:hidden"
            aria-hidden
          />
          {SOLAR_TIMELINE.map((step, i) => (
            <li
              key={step.key}
              data-stagger
              style={{ ["--i" as string]: i } as React.CSSProperties}
              className="relative flex items-start gap-5 py-3.5"
            >
              <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--proposal-accent)] font-display text-lg font-semibold text-white ring-4 ring-[#f6f3ee] [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
                {i + 1}
              </span>
              <div className="flex-1 pt-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="text-lg font-semibold text-neutral-900">{step.title}</p>
                  {/* A RANGE, always. "2 weeks" on a permit that regularly takes
                      five is the promise the customer remembers, and the one
                      the install date gets measured against. */}
                  <p className="text-sm font-medium tabular-nums text-neutral-500">
                    {step.duration}
                  </p>
                </div>
                <p className="mt-0.5 max-w-[62ch] leading-relaxed text-neutral-600">{step.blurb}</p>
                {/* Who actually does it. "We handle everything" is the sentence
                    every solar company says; naming the city and the utility is
                    both more convincing and true on the day one of them is
                    slow. */}
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {step.owners.map((owner) => (
                    <li
                      key={owner}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        owner === "You"
                          ? "bg-[var(--proposal-accent)]/12 text-[var(--proposal-accent)]"
                          : "bg-neutral-900/[0.06] text-neutral-600",
                      )}
                    >
                      {owner}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-neutral-500">
          No dates are scheduled yet — your site survey is booked once you go ahead.
        </p>

        <div className="mt-14 border-t border-neutral-900/12 pt-10">
          <h3 className="font-display text-2xl font-semibold tracking-tight text-neutral-900">
            And what it does beyond the bill
          </h3>
          <p className="mt-2 max-w-[62ch] leading-relaxed text-neutral-600">
            Over the {sv.years.length} years modelled, your system is projected to generate{" "}
            <strong className="font-semibold text-neutral-900">
              {kwh(sv.years.reduce((n, y) => n + y.productionKwh, 0))}
            </strong>{" "}
            of electricity that does not have to be burned into existence.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
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
            a CLAIM rather than an arithmetic equivalence.

            Shown only when the company has set a figure it is willing to stand
            behind — see SolarSettings.homeValueUpliftPct. Zero, the default,
            means no such claim is made and the block is absent rather than
            printed as "0%". Restricted to OWNED systems on purpose: a lease or
            a PPA is somebody else's equipment on your roof, and the studies
            behind this number are about houses that own theirs.
          */}
          {s.assumptions.homeValueUpliftPct != null &&
            s.assumptions.homeValueUpliftPct > 0 &&
            isPurchase && (
              <div className="mt-10 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-neutral-900/12 pt-6">
                <div className="min-w-[16rem] flex-1">
                  <p className="font-display text-xl font-semibold tracking-tight text-neutral-900">
                    And it stays with the house
                  </p>
                  <p className="mt-1.5 max-w-[62ch] leading-relaxed text-neutral-600">
                    Homes with an owned solar system have sold for a premium over comparable homes
                    without one. Your own market, condition and buyer decide what that is worth here
                    — it is not a guarantee, and no part of this proposal depends on it.
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-4xl font-semibold leading-none tracking-tight text-neutral-900">
                    {pct(s.assumptions.homeValueUpliftPct)}
                  </p>
                  <p className="mt-1.5 text-sm text-neutral-500">estimated value increase</p>
                  <SourceLink source={IMPACT_SOURCES.homeValue} />
                </div>
              </div>
            )}
        </div>
      </Chapter>

      {/* ── 7 · ACCEPT ────────────────────────────────────────────────────
          Signature first, questions under it. The FAQ used to be a chapter of
          its own BEFORE the close, which put ten paragraphs of reassurance
          between a decided customer and the button. */}
      <section
        data-section="accept"
        data-chapter
        data-reveal
        data-dark-ground
        className="relative scroll-mt-[var(--proposal-chrome-h)] overflow-hidden bg-neutral-950 px-6 py-24 text-white [print-color-adjust:exact] [-webkit-print-color-adjust:exact] sm:px-10 print:break-before-page print:py-10"
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center gap-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--proposal-accent)]">
              Let&rsquo;s get started
            </span>
            <span aria-hidden className="h-px flex-1 bg-white/15" />
            <span className="text-[11px] font-medium tabular-nums tracking-[0.16em] text-neutral-500">
              {String(num("accept")).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
          </div>

          <h2 className="mt-5 font-display text-[clamp(2.1rem,4.6vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.022em] text-white">
            Ready to go ahead?
          </h2>

          <div className="mt-10 max-w-xl">
            {signed ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6 text-emerald-100">
                <Check className="size-5 shrink-0" />
                Accepted — thank you. Your consultant will be in touch to book the site survey.
              </div>
            ) : superseded ? (
              <p className="text-neutral-400">
                This version has been replaced and can no longer be accepted.
              </p>
            ) : previewMode ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-neutral-400 print:hidden">
                Acceptance is disabled in preview. The customer would sign here.
              </div>
            ) : (
              <AcceptForm token={token} onSigned={() => setSigned(true)} />
            )}
          </div>

          <div className="mt-16 border-t border-white/10 pt-10">
            <h3 className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Common questions
            </h3>
            <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
              {SOLAR_FAQS.map((faq) => (
                <details key={faq.q} data-keep-summary className="group break-inside-avoid py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-medium text-white marker:hidden">
                    {faq.q}
                    <span
                      aria-hidden
                      className="shrink-0 text-neutral-500 transition-transform group-open:rotate-45 print:hidden"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-2.5 max-w-[62ch] leading-relaxed text-neutral-400">{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── COMPANY, REPRESENTATIVE & DISCLOSURES ─────────────────────────── */}
      <footer className="bg-[#efeae2] px-6 py-16 sm:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
            Who is doing the work
          </p>
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
                {/*
                  Only when the SNAPSHOT carries it. A proposal built before the
                  margin existed was quoted at full model output, and printing
                  this on it would describe a haircut its number never took.
                */}
                {(s.assumptions.productionMarginPct ?? 0) > 0 && (
                  <li>
                    Every production figure above is then quoted{" "}
                    {s.assumptions.productionMarginPct}% under what that model returns, so the
                    system is expected to meet or beat what you were shown.
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

      {/* The rep's controls. Never rendered on the customer's copy — see the
          `rep` prop. */}
      {rep && (
        <RepBar
          rep={{ ...rep, version: live.version || rep.version }}
          onRepriced={(next, version) => {
            setLive({ snapshot: next, version });
            // The menu is rebuilt from the new document, so the selection goes
            // back to its first option: the key a rep was looking at may not
            // exist on a version priced from different terms.
            setOptionKey(paymentOptions(next)[0].key);
          }}
        />
      )}
    </div>
  );
}

/**
 * The one number that nets the system against the bill.
 *
 * Rendered EXACTLY ONCE in the document. It used to appear four times, which is
 * how a figure stops being an argument and starts being wallpaper.
 */
function LifetimeBlock({
  label,
  value,
  note,
  accent,
  aside,
}: {
  label: string;
  value: string;
  note: string;
  accent: boolean;
  aside?: React.ReactNode;
}) {
  return (
    <div
      data-dark-ground
      className="overflow-hidden rounded-2xl bg-neutral-950 p-8 text-white sm:p-10 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
        <div className="min-w-[15rem] flex-1">
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.2em]",
              accent ? "text-[var(--proposal-accent)]" : "text-neutral-400",
            )}
          >
            {label}
          </p>
          <p className="mt-3 font-display text-[clamp(3rem,8vw,5.2rem)] font-semibold leading-[0.92] tracking-[-0.035em] tabular-nums text-white">
            {value}
          </p>
        </div>
        {aside && <div className="min-w-[13rem]">{aside}</div>}
      </div>
      <p className="mt-6 max-w-[54ch] leading-relaxed text-neutral-300">{note}</p>
    </div>
  );
}
