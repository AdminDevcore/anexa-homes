"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import type { ProposalCertificate } from "@/lib/proposal-signature";
import { SOLAR_TIMELINE } from "@/lib/solar-proposal";
import { PROPOSAL_NAV_PX } from "@/lib/proposal";
import { ProposalChrome, type ChromeNavItem } from "../proposal-chrome";
import { PaymentMenu } from "../payment-menu";
import { usd } from "../format";
import { Chapter, Stat, SpecList, DarkRow, EquipCard, ContactCard } from "./primitives";
import { AcceptForm } from "./accept";
import { ExecutionBlock } from "./signature-block";
import { SignatureCertificate } from "./certificate";
import { PrintStyles } from "./print";
import { useDeckKeys } from "./deck";
import type { RepContext } from "../rep-bar";

/**
 * The customer-facing STORAGE proposal.
 *
 * A sibling of the solar document, not a mode inside it. Every argument that
 * one makes rests on a figure a battery does not have — offset, the production
 * chart, twenty-five years of avoided utility cost, carbon equivalences — and a
 * document that prints those as zeroes is worse than one that never mentions
 * them.
 *
 * So this argues from what a battery actually does: it keeps the lights on for
 * a stated number of hours, it earns from a programme, and it shifts load off
 * the expensive part of the day. SIX chapters, and the same rule the solar
 * document keeps at the top of every one of them: A CHAPTER WITH NO DATA IS
 * OMITTED, never rendered empty.
 *
 * Separate FILE rather than a branch inside `index.tsx`, which is already 69 KB.
 * The two share `primitives`, `accept`, `signature-block`, `certificate` and
 * `print` — the parts that are about being a document — and share no control
 * flow, which is the part that is about being a solar quote.
 */
export function SolarStorageProposalView({
  snapshot,
  token,
  alreadySigned,
  certificate = null,
  superseded,
  previewMode = false,
  showPaymentOptions = true,
  accentColor,
  chromeOffset = 0,
}: {
  snapshot: SolarProposalSnapshot;
  token: string;
  alreadySigned: boolean;
  certificate?: ProposalCertificate | null;
  superseded: boolean;
  previewMode?: boolean;
  showPaymentOptions?: boolean;
  /**
   * ACCEPTED AND IGNORED. The rep bar lets somebody re-price a proposal from
   * the document, and re-pricing reaches back into the $/W ladder. On storage
   * that is not merely unimplemented, it is the wrong ladder — so the bar is
   * not rendered rather than rendered and quietly broken.
   */
  rep?: RepContext | null;
  accentColor?: string | null;
  chromeOffset?: number;
}) {
  const s = snapshot;
  const st = s.storage;
  const [signed, setSigned] = React.useState<ProposalCertificate | null>(certificate);

  const options = s.options?.length ? s.options : [];
  const [selectedKey, setSelectedKey] = React.useState(
    () => (options.find((o) => o.quoted) ?? options[0])?.key ?? ""
  );
  const quoted = options.find((o) => o.key === selectedKey) ?? options[0] ?? null;

  const vpp = (s.vpp ?? []).filter((v) => v.annualCents > 0 || v.upfrontCents > 0);
  const vppAnnualCents = vpp.reduce((n, v) => n + v.annualCents, 0);
  const touCents = st?.tou?.annualSavingsCents ?? 0;

  /**
   * The chapters that exist for THIS document.
   *
   * "Protection" is omitted entirely when there is nothing behind any of its
   * three parts — no backup table, no programme money, no time-of-use spread.
   * A battery with none of those is a battery whose value this company has not
   * recorded, and printing an empty chapter says the opposite.
   */
  const hasProtection = !!st && (st.backup.length > 0 || vpp.length > 0 || st.tou != null);
  const chapters: ChromeNavItem[] = [
    { id: "today", label: "Today" },
    { id: "system", label: "System" },
    ...(hasProtection ? [{ id: "protection", label: "Protection" }] : []),
    { id: "cost", label: "Your cost" },
    { id: "timeline", label: "Next" },
    { id: "accept", label: "Accept" },
  ];
  const total = chapters.length;
  const num = (id: string) => chapters.findIndex((c) => c.id === id) + 1;

  useDeckKeys(true);

  // The cover leads on the LOWEST-load profile, which is rank 0 — the list is
  // ordered, so no field is needed to say which one to headline.
  const headline = st?.backup[0] ?? null;

  return (
    <div
      id="proposal-root"
      className="min-h-screen bg-[#f6f3ee] text-neutral-900"
      style={{
        ["--proposal-accent" as string]: accentColor || "#F4631E",
        ["--proposal-chrome-h" as string]: `${chromeOffset + PROPOSAL_NAV_PX}px`,
      }}
    >
      <PrintStyles />

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
        navItems={chapters}
        offsetTop={chromeOffset}
      />

      {superseded && (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm text-amber-900">
          A newer version of this proposal has been issued. Please ask your consultant for the
          current link.
        </div>
      )}

      {/* ── COVER ─────────────────────────────────────────────────────────
          The headline is HOURS, not dollars. A homeowner buying storage is
          buying the certainty that the fridge stays cold, and leading on a
          saving would be leading on the smaller half of the reason. */}
      <section
        data-chapter
        className="flex min-h-[70vh] flex-col justify-center bg-neutral-900 px-6 py-20 text-white"
      >
        <div data-chapter-inner className="mx-auto w-full max-w-4xl">
          <p className="text-sm uppercase tracking-[0.2em] text-white/50">
            Home battery proposal · {s.reference}
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">
            {st && st.usableKwh > 0 ? (
              <>
                {st.usableKwh.toFixed(1)} kWh of backup power
                {headline && (
                  <>
                    ,<br />
                    about {fmtHours(headline.hours)} on {headline.name.toLowerCase()}
                  </>
                )}
              </>
            ) : (
              "Home battery storage"
            )}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/70">
            Prepared for {s.customer.name} · {s.customer.address}
          </p>
        </div>
      </section>

      {/* ── 1 · TODAY ─────────────────────────────────────────────────── */}
      <Chapter
        id="today"
        index={num("today")}
        total={total}
        eyebrow="Where you are now"
        title="What an outage costs you today"
        lede="Without storage, everything in the house stops the moment the grid does — and everything you use comes from the grid at whatever the grid charges for it."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {s.energy.avgMonthlyBillCents != null && (
            <Stat k="Your bill today" v={usd(s.energy.avgMonthlyBillCents)} note="a month" />
          )}
          {s.assumptions.currentRateMillsPerKwh > 0 && (
            <Stat
              k="What you pay for power"
              v={`$${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)}`}
              note="per kWh"
            />
          )}
          {st?.tou && (
            <Stat
              k="At peak"
              v={`$${(st.tou.peakRateMills / 1000).toFixed(3)}`}
              note={st.tou.peakWindow ? `per kWh · ${st.tou.peakWindow}` : "per kWh"}
            />
          )}
        </div>
        {s.energy.utilityProvider && (
          <p className="mt-6 text-sm text-neutral-600">
            Supplied by {s.energy.utilityProvider}.
          </p>
        )}
      </Chapter>

      {/* ── 2 · SYSTEM ────────────────────────────────────────────────── */}
      <Chapter
        id="system"
        index={num("system")}
        total={total}
        eyebrow="What we are installing"
        title="Your battery"
        lede="No panels on this proposal — this is storage on its own. It charges from the grid when power is cheap and carries the house when it is not."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat
            k="Usable storage"
            v={`${(st?.usableKwh ?? 0).toFixed(1)} kWh`}
            note={st && st.batteryQty > 1 ? `${st.batteryQty} units` : undefined}
            size="lg"
          />
          {st?.batteryLabel && <Stat k="Battery" v={st.batteryLabel} />}
        </div>

        {/* The MODULE card is deliberately absent. There are no panels on this
            job, and an equipment section that lists them would be describing
            somebody else's system. */}
        <div className="mt-8 space-y-4">
          <EquipCard i={0} label="Battery" e={s.system.battery} unit="Wh" />
          <EquipCard i={1} label="Inverter" e={s.system.inverter} unit="W" />
        </div>
      </Chapter>

      {/* ── 3 · PROTECTION ────────────────────────────────────────────── */}
      {hasProtection && st && (
        <Chapter
          id="protection"
          index={num("protection")}
          total={total}
          eyebrow="What it does for you"
          title="Power when it matters, and a cheaper bill in between"
          tone="dark"
        >
          {st.backup.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm uppercase tracking-wide text-white/50">
                How long it carries the house
              </h4>
              {st.backup.map((b) => (
                <DarkRow
                  key={b.name}
                  k={`${b.name} · ${(b.loadWatts / 1000).toFixed(1)} kW`}
                  v={fmtHours(b.hours)}
                />
              ))}
              <p className="text-xs text-white/50">
                Estimated from {st.usableKwh.toFixed(1)} kWh of usable storage at the loads shown.
                Real runtime moves with what is switched on.
              </p>
            </div>
          )}

          {vppAnnualCents > 0 && (
            <div className="mt-10 space-y-3">
              <h4 className="text-sm uppercase tracking-wide text-white/50">
                What the battery earns
              </h4>
              {vpp.map((v) => (
                <DarkRow
                  key={v.provider + v.programme}
                  k={
                    v.upfrontCents > 0
                      ? `${v.programme || v.provider} · plus ${usd(v.upfrontCents)} on enrolment`
                      : v.programme || v.provider
                  }
                  v={`${usd(v.annualCents)} / yr`}
                />
              ))}
            </div>
          )}

          {st.tou && (
            <div className="mt-10 space-y-3">
              <h4 className="text-sm uppercase tracking-wide text-white/50">
                What it saves on the bill
              </h4>
              <DarkRow
                k={`Charging off-peak, running on the battery at peak · about ${st.tou.shiftedKwhPerDay.toFixed(
                  1
                )} kWh a day shifted`}
                v={`${usd(st.tou.annualSavingsCents)} / yr`}
                strong
              />
              <p className="text-xs text-white/50">
                Based on a ${(st.tou.peakRateMills / 1000).toFixed(3)} peak rate against $
                {(st.tou.offPeakRateMills / 1000).toFixed(3)} off-peak
                {st.tou.peakWindow ? ` (${st.tou.peakWindow})` : ""}, assuming{" "}
                {st.tou.peakSharePct}% of your use falls in the peak window,{" "}
                {st.tou.cyclesPerDay} cycle{st.tou.cyclesPerDay === 1 ? "" : "s"} a day and{" "}
                {st.tou.roundTripEfficiencyPct}% round-trip efficiency. An estimate, not a
                guarantee — rates and usage change.
              </p>
            </div>
          )}

          {(vppAnnualCents > 0 || touCents > 0) && (
            <p className="mt-10 border-t border-white/15 pt-6 text-lg">
              Together, about{" "}
              <strong className="font-semibold">{usd(vppAnnualCents + touCents)}</strong> a year.
            </p>
          )}
        </Chapter>
      )}

      {/* ── 4 · YOUR COST ─────────────────────────────────────────────── */}
      <Chapter
        id="cost"
        index={num("cost")}
        total={total}
        eyebrow="What it costs"
        title="Your investment"
      >
        {quoted && (
          <SpecList
            items={[
              [
                "System price",
                usd(quoted.financing.contractPriceCents ?? 0),
              ],
              ...(st?.rebates.length
                ? st.rebates.map(
                    (r) => [`${r.name}${r.qty > 1 ? ` × ${r.qty}` : ""}`, `−${usd(r.totalCents)}`] as [string, React.ReactNode]
                  )
                : []),
              ...(quoted.monthlyCents != null
                ? ([["Monthly payment", usd(quoted.monthlyCents)]] as [string, React.ReactNode][])
                : []),
            ]}
          />
        )}

        {showPaymentOptions && options.length > 1 && (
          <div className="mt-10">
            <PaymentMenu
              options={options}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              showMenu={showPaymentOptions}
            />
          </div>
        )}
      </Chapter>

      {/* ── 5 · NEXT ──────────────────────────────────────────────────── */}
      <Chapter
        id="timeline"
        index={num("timeline")}
        total={total}
        eyebrow="What happens next"
        title="From here to switched on"
      >
        <ol className="space-y-6">
          {SOLAR_TIMELINE.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-xs tabular-nums">
                {i + 1}
              </span>
              <span>
                <strong className="font-semibold">{step.title}</strong>
                <span className="mt-0.5 block text-sm text-neutral-600">{step.blurb}</span>
              </span>
            </li>
          ))}
        </ol>
      </Chapter>

      {/* ── 6 · ACCEPT ────────────────────────────────────────────────── */}
      <section data-chapter id="accept" className="bg-[#f6f3ee] px-6 py-20">
        <div data-chapter-inner className="mx-auto w-full max-w-3xl">
          {signed ? (
            <>
              <ExecutionBlock signature={signed.signature} />
              <SignatureCertificate certificate={signed} />
            </>
          ) : alreadySigned ? (
            <p className="rounded-xl border border-neutral-300 bg-white p-6 text-center">
              This proposal has already been accepted.
            </p>
          ) : previewMode ? (
            <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-center text-sm text-neutral-600">
              The customer signs here. Acceptance is disabled in preview.
            </p>
          ) : (
            <AcceptForm token={token} onSigned={setSigned} />
          )}

          {/* Battery wording, not the solar FAQ. That one answers "what happens
              when the power goes out?" with a note about ADDING a battery —
              nonsense on a document selling one. */}
          <div className="mt-16 space-y-6">
            {STORAGE_FAQS.map((f) => (
              <div key={f.q}>
                <h4 className="font-semibold">{f.q}</h4>
                <p className="mt-1 text-sm text-neutral-600">{f.a}</p>
              </div>
            ))}
          </div>

          {s.representative && (
            <div className="mt-16">
              <ContactCard
                title={s.representative.name}
                subtitle="Your consultant"
                lines={[s.representative.phone, s.representative.email, s.company.name]}
              />
            </div>
          )}

          <p className="mt-12 text-xs leading-relaxed text-neutral-500">
            {s.disclaimers.estimate}
          </p>
        </div>
      </section>
    </div>
  );
}

/** "27 hrs", "7.7 hrs" — one decimal only where it changes the answer. */
function fmtHours(h: number): string {
  return h < 10 ? `${h.toFixed(1)} hrs` : `${Math.round(h)} hrs`;
}

/**
 * The questions a homeowner buying storage actually asks.
 *
 * The solar list is wrong here, not merely incomplete: its answer to "what
 * happens when the power goes out?" is "adding a battery keeps selected
 * circuits running", which on this document is answering the question with the
 * thing being sold.
 */
const STORAGE_FAQS: { q: string; a: string }[] = [
  {
    q: "What does the battery actually run?",
    a: "The circuits chosen at the site survey — usually the fridge, lights, internet, and outlets in the rooms you use most. Heavier loads like central air can be included, and the runtime table above shows what that does to how long it lasts.",
  },
  {
    q: "What happens when it runs down?",
    a: "It recharges from the grid as soon as power returns. During a longer outage it will carry the essential circuits, run down, and pick back up when the grid does.",
  },
  {
    q: "Does it charge from the grid?",
    a: "Yes. With no panels on this system, the grid is where its energy comes from — which is the point: it fills up when power is cheap and carries the house when it is expensive or absent.",
  },
  {
    q: "Do I have to join the battery programme?",
    a: "No. Any programme earnings shown are optional, and joining is a separate agreement with the provider. Your battery works the same either way.",
  },
  {
    q: "What is covered by warranty?",
    a: "The battery carries the manufacturer's own warranty, and our workmanship warranty covers the installation. Both are set out in the agreement you sign.",
  },
];
