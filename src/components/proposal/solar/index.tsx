"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import type { SolarProposalSnapshot, ProposalPaymentOption } from "@/lib/solar-proposal";
import type { ProposalCertificate } from "@/lib/proposal-signature";
import {
  postSolarUtilityCents,
  optionMonthlyCents,
  optionSavings,
  quotedTotalCents,
  quotedPpwCents,
} from "@/lib/solar-proposal";
import { coverPitch, lifetimeFigure, monthlyToday } from "@/lib/solar-proposal-pitch";
import { PROPOSAL_NAV_PX } from "@/lib/proposal";
import { ProposalChrome, type ChromeNavItem } from "../proposal-chrome";
import { CreditSwitch } from "../credit-switch";
import { RepBar, type RepContext } from "../rep-bar";
import { Cover } from "./cover";
import { SignatureCertificate } from "./certificate";
import { PrintStyles } from "./print";
import { useDeckKeys } from "./deck";
import { SolarStorageProposalView } from "./storage";
import type { Doc } from "./chapters/doc";
import { ChapterToday } from "./chapters/today";
import { ChapterSystem } from "./chapters/system";
import { ChapterYear } from "./chapters/year";
import { ChapterCost } from "./chapters/cost";
import { ChapterPay } from "./chapters/pay";
import { ChapterComparison } from "./chapters/comparison";
import { ChapterNext } from "./chapters/next";
import { ChapterAccept } from "./chapters/accept";
import { BackMatter } from "./chapters/back-matter";

/**
 * The customer-facing solar proposal.
 *
 * A DOCUMENT read as a deck, composed for a LANDSCAPE sheet so the screen and
 * the paper are the same composition. That last part is the 2026-08-30 rebuild:
 * the chapters used to be portrait screen sections and ./print spent ~380 lines
 * of per-section CSS rearranging them into sheets. The document was designed
 * twice, the two designs disagreed, and every orphan page and dead half-sheet
 * in the printed PDF was that disagreement surfacing.
 *
 * The sheets alternate. A chapter that owns a picture or a drawn figure is a
 * PLATE — full bleed, type in a glass card, the cover's own grammar. A chapter
 * that owns numbers is PAPER. The alternation is load-bearing rather than
 * decorative: it is what stops two tables ever sitting next to each other,
 * which is what this document was from end to end.
 *
 *   00 Cover · 01 Where you are now · 02 The design · 03 Your investment
 *   04 The terms · 05 The maths · 06 Month by month · 07 The plan · 08 Accept
 *   — then back matter, which carries no chapter mark because it is evidence
 *   rather than argument.
 *
 * THE PRICE IS THE THIRD SHEET, and that is deliberate as of 2026-08-30. It was
 * the fourth, behind the month-by-month shape, and a homeowner who has just
 * been shown their roof turns the page to ask one question. Making them read a
 * chart about December first is the document answering a question nobody asked
 * while withholding the one they did. Month by month keeps its own sheet — it
 * moved to 06, next to the maths, where it belongs with the rest of the
 * argument about how the years actually play out.
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
 * The customer-facing solar proposal, and the one door onto both documents.
 *
 * A WRAPPER rather than an early return inside the PV component: routing after
 * that component's first hook would call hooks conditionally, which React
 * forbids and eslint catches. Two components, each with its own unconditional
 * hooks, and one function that picks.
 *
 * `systemType` absent means a document generated before v5, and every one of
 * those was an array — so nothing already sent changes.
 */
export function SolarProposalView(props: SolarProposalViewProps) {
  return props.snapshot.systemType === "storage" ? (
    <SolarStorageProposalView
      snapshot={props.snapshot}
      token={props.token}
      alreadySigned={props.alreadySigned}
      certificate={props.certificate}
      superseded={props.superseded}
      previewMode={props.previewMode}
      showPaymentOptions={props.showPaymentOptions}
      rep={props.rep}
      accentColor={props.accentColor}
      chromeOffset={props.chromeOffset}
    />
  ) : (
    <SolarPvProposalView {...props} />
  );
}

type SolarProposalViewProps = {
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
  /**
   * The signature and the signing record, when the proposal has been signed.
   *
   * Resolved by the CALLER, because the three doors onto this document find the
   * proposal three different ways. Null means unsigned — except on a proposal
   * accepted before signatures were captured, where `alreadySigned` is true and
   * this is still null, and the document says so rather than offering a
   * signature box to somebody who has already accepted.
   */
  certificate?: ProposalCertificate | null;
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
  /**
   * WHICH WAY THE TAX-CREDIT SWITCH STARTS.
   *
   * Off for every reader, which is the honest default and the one the document
   * has always printed — see `creditsOn` below. Passed true by exactly one
   * caller: the print route rendering the credits-applied copy of a signed
   * proposal. That copy has to exist as paper and paper has no switch, so the
   * scenario has to be chosen before the render rather than clicked during it.
   *
   * It seeds the state; it does not pin it. A reader who is handed a document
   * opened this way can still throw the switch, because it is the same control
   * either way round.
   */
  creditsApplied?: boolean;
};

function SolarPvProposalView({
  snapshot,
  token,
  alreadySigned,
  certificate = null,
  superseded,
  previewMode = false,
  layoutImageUrl = null,
  showComparison = true,
  showPaymentOptions = true,
  siteImageBase = null,
  rep = null,
  accentColor,
  chromeOffset = 0,
  creditsApplied: initialCreditsApplied = false,
}: SolarProposalViewProps) {
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
  /**
   * The signing record under the customer's eyes.
   *
   * Held as STATE and seeded from the server's answer, because the moment
   * somebody signs, the block has to appear where the form was — a page reload
   * at a kitchen table is a blank screen in the middle of a handshake. The
   * signing action returns the whole record, so no refresh is needed and the
   * certificate is complete the instant the mark is applied.
   */
  const [record, setRecord] = React.useState<ProposalCertificate | null>(certificate);
  const [seenCert, setSeenCert] = React.useState(certificate);
  if (seenCert !== certificate) {
    setSeenCert(certificate);
    setRecord(certificate);
  }
  const signature = record?.signature ?? null;
  /** Signed at all — true for old acceptances that carry no mark. */
  const signed = !!signature || alreadySigned;

  const options = React.useMemo(() => paymentOptions(s), [s]);
  const [optionKey, setOptionKey] = React.useState(options[0].key);
  const option = options.find((o) => o.key === optionKey) ?? options[0];
  const f = option.financing;

  /**
   * WHETHER THE HOUSEHOLD'S TAX CREDITS ARE APPLIED, for the whole document.
   *
   * OFF by default, and that is the honest default rather than a shy one: a
   * credit is claimed on somebody's own return, against their own liability,
   * and a proposal that opens on the assumption it lands has quoted a payment
   * nobody has yet earned. The rep turns it on when the conversation reaches
   * it, and everything moves at once.
   *
   * Held HERE rather than on the sheet that shows the control, because two
   * sheets show it and both have to say the same thing. Kept across a change of
   * payment option deliberately — an option with nothing to claim reads `false`
   * whatever this says, and switching back restores what the reader had.
   */
  const [creditsOn, setCreditsOn] = React.useState(initialCreditsApplied);
  const creditsApplied = creditsOn && option.creditsApplied != null;
  const sv = optionSavings(option, creditsApplied);
  const monthlyCents = optionMonthlyCents(option, creditsApplied);

  const isPurchase = f.product === "cash" || f.product === "loan";
  /**
   * The reconciliation between what this partner's contract is written at and
   * what the household owes — frozen at generation, on the option the reader is
   * currently looking at.
   *
   * Read off the OPTION, not off the snapshot, so switching the payment menu
   * from a partner that runs such a programme to one that does not takes the
   * whole section with it. Undefined on every document generated before this
   * existed, and null on every deal whose partner runs no such programme, which
   * is almost all of them — and either way, nothing below renders.
   */
  const adjustment = f.lenderAdjustment ?? null;
  /**
   * The ladder from the contract down to what the household actually pays.
   *
   * Read off the OPTION for the same reason the reconciliation is. Undefined on
   * every document generated before this existed and null on every deal without
   * such a partner — either way the cost chapter simply prints the price.
   */
  const ladder = f.creditLadder ?? null;
  /**
   * THE TOTAL THE PRICE TABLE ADDS UP TO — the household's own price.
   *
   * The contract on an ordinary deal, because there they are the same figure.
   * On a deal carrying a programme contribution they are not, and this is the
   * QUOTED price: see `quotedTotalCents` for why every customer-facing surface
   * now says that one and the contract keeps its own block underneath.
   */
  const quotedTotal = quotedTotalCents(f);
  /**
   * The same price per installed watt, derived from the total above so the two
   * printed figures divide into each other. `f.finalPpwCents` is the same
   * arithmetic done on the contract — $13.45/W on a deal quoted at $5.50 — and
   * it belongs with the contract, not beside the price.
   */
  const quotedPpw = quotedPpwCents(f, s.system.sizeKwDc);
  /**
   * WHAT THE COST TABLE CALLS THE SYSTEM PRICE.
   *
   * THE ARRAY AT STICKER, on every deal, and the rows below it read as
   * arithmetic a homeowner can check: system price, plus additional work,
   * equals the total. On a programme deal the total those rows add up to is the
   * quoted price rather than the contract, and the base is exactly what the
   * quoted price is built from — so the arithmetic holds without deriving
   * anything.
   *
   * It was the CONTRACT less the additional work until 2026-08-30, which is how
   * the sheet came to open on "System price $118,400 · $13.45 per watt" for a
   * household that had been quoted $48,400 at $5.50. That figure was arrived at
   * honestly and every credit that brought it back down was printed under it,
   * and it was still the wrong number to lead a price page with: it matches
   * nothing the customer has been told and nothing they can compare against
   * another quote.
   *
   * The fallback derives it from the printed total, for a document generated
   * before the base was frozen into the snapshot.
   */
  const systemPriceCents =
    f.basePriceCents ?? (quotedTotal != null ? quotedTotal - (f.adderTotalCents ?? 0) : null);
  const showcased = (f.adders ?? []).filter((a) => a.showcase && a.amountCents !== 0);
  const name = firstName(s.customer.name);

  /* ── what the money says ────────────────────────────────────────────────
     Both answers are decided in @/lib/solar-proposal-pitch, where they are
     tested. See that module for why the cover is not allowed to run one
     template across every deal. */
  const billCents = monthlyToday(s.energy.avgMonthlyBillCents, sv);
  const pitch = coverPitch({
    billCents,
    // The scenario's own payment, not the option's default one: the cover leads
    // on the monthly where it beats today's bill, and whether it does is
    // exactly what the credit switch decides.
    option: { ...option, monthlyCents },
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
   * What the battery earns every year, and who pays it. The upfront enrolment
   * money is deliberately left out: it lands once, in year one, and folding it
   * into a per-year figure would overstate every other year.
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
    monthlyCents != null
      ? monthlyCents + option.postSolarMonthlyCents
      : option.postSolarMonthlyCents;

  /* ── the chapters that exist for THIS document ───────────────────────────
     Built from what the snapshot actually carries, so the numbering closes
     over anything absent rather than leaving a gap where a chapter would have
     been. A chapter with no data is omitted, never rendered empty. */
  const chapters = [
    { id: "today", label: "Today" },
    { id: "system", label: "System" },
    { id: "cost", label: "Cost" },
    { id: "pay", label: "Payment" },
    ...(showComparison ? [{ id: "savings", label: `${sv.years.length} years` }] : []),
    // Twelve months of measured usage against simulated production, or nothing.
    ...(s.monthly ? [{ id: "year", label: "Your year" }] : []),
    { id: "timeline", label: "Next" },
    { id: "accept", label: "Accept" },
  ];
  const total = chapters.length;
  const num = (id: string) => chapters.findIndex((c) => c.id === id) + 1;
  const navItems: ChromeNavItem[] = chapters;

  /**
   * Everything the sheets are allowed to know, settled once.
   *
   * The derivations above have comments and tests behind them and they stay in
   * this file; the chapter files read the result. That is the whole contract
   * between the view and the sheets — see ./chapters/doc.
   */
  const doc: Doc = {
    s,
    options,
    option,
    f,
    sv,
    monthlyCents,
    /**
     * The switch, or nothing at all.
     *
     * Null on every option with no credits to claim — and on every document
     * generated before both scenarios were frozen, which carries no
     * `creditsApplied` on any option. Those render exactly as they always did:
     * one set of figures and no control offering a second.
     */
    credits: option.creditsApplied
      ? {
          on: creditsApplied,
          set: setCreditsOn,
          offMonthlyCents: option.monthlyCents,
          onMonthlyCents: option.creditsApplied.monthlyCents,
          reliefCents: f.creditLadder?.reliefCents ?? 0,
        }
      : null,
    isPurchase,
    adjustment,
    ladder,
    systemPriceCents,
    quotedTotalCents: quotedTotal,
    quotedPpwCents: quotedPpw,
    showcased,
    lifetime,
    vpp,
    vppAnnualCents,
    vppUpfrontCents,
    vppPayer,
    billCents,
    afterAllCents,
    num,
    total,
  };

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
        // The bar's own height, on its own: the cover borrows exactly this much
        // to run up behind the glass, and gives exactly this much back.
        ["--proposal-nav-h" as string]: `${PROPOSAL_NAV_PX}px`,
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
        glassOverHero={!superseded}
        /* THE SWITCH LIVES IN THE BAR. It changes what every sheet says, so it
           belongs on the one piece of chrome that follows the reader down all
           of them — not in the rail of the payment sheet, where a rep had to
           scroll back to reach it mid-sentence. */
        actions={
          option.creditsApplied ? (
            <CreditSwitch
              compact
              on={creditsApplied}
              onChange={setCreditsOn}
              monthlyCents={monthlyCents}
            />
          ) : null
        }
      />

      {superseded && (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm text-amber-900">
          A newer version of this proposal has been issued. Please ask your consultant for the
          current link.
        </div>
      )}

      {/* ── 00 · COVER ─────────────────────────────────────────────────────
          Untouched by the 2026-08-30 rebuild. Everything below inherits its
          grammar: a full-bleed picture, type in a glass card. */}
      <Cover s={s} name={name} pitch={pitch} underChrome={!superseded} />

      {/* 01 · paper */}
      <ChapterToday doc={doc} showComparison={showComparison} />

      {/* 02 · plate — or paper, when there is no drawing to plate. */}
      <ChapterSystem doc={doc} siteImageBase={siteImageBase} layoutImageUrl={layoutImageUrl} />

      {/* 03 · dark. The price, and the credits that bring it down. Straight
          after the roof, because that is the question the roof raises. */}
      <ChapterCost doc={doc} />

      {/* 04 · paper. The payment and the terms. */}
      <ChapterPay doc={doc} onSelect={setOptionKey} showPaymentOptions={showPaymentOptions} />

      {/* 05 · plate. A rep may turn this off for a household that reads a table
          as a wall of numbers; the lifetime figure moves up to 01 rather than
          disappearing. */}
      {showComparison && <ChapterComparison doc={doc} />}

      {/* 06 · paper. Renders nothing when the snapshot has no monthly shape,
          which is why it is not in `chapters` either. */}
      {s.monthly && <ChapterYear doc={doc} />}

      {/* 07 · paper */}
      <ChapterNext doc={doc} />

      {/* 08 · plate */}
      <ChapterAccept
        doc={doc}
        token={token}
        signed={signed}
        signature={signature}
        superseded={superseded}
        previewMode={previewMode}
        onSigned={setRecord}
      />

      {/* ── BACK MATTER ────────────────────────────────────────────────────
          The evidence: year by year, the assumptions, the programme's terms,
          the questions, the equivalences and the disclosures. No chapter mark —
          the numbering is a promise about how much argument is left. */}
      <BackMatter doc={doc} />

      {/* ── THE CERTIFICATE ────────────────────────────────────────────────
          The sheet a lender's file reviewer looks for. Print-only, and last:
          it is evidence about the document, not part of it. */}
      {record && <SignatureCertificate certificate={record} />}

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
