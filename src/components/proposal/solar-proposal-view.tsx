"use client";

import * as React from "react";
import { toast } from "sonner";
import { Sun, Leaf, TreePine, Factory, Check, Loader2, ChevronDown } from "lucide-react";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { SOLAR_TIMELINE, SOLAR_FAQS } from "@/lib/solar-proposal";
import { acceptSolarProposalAction } from "@/server/modules/solar/proposal-sign-action";

const usd = (cents: number, digits = 0) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });

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
 */
export function SolarProposalView({
  snapshot,
  token,
  alreadySigned,
  superseded,
}: {
  snapshot: SolarProposalSnapshot;
  token: string;
  alreadySigned: boolean;
  superseded: boolean;
}) {
  const s = snapshot;
  const f = s.financing;
  const [signed, setSigned] = React.useState(alreadySigned);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {superseded && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          A newer version of this proposal has been issued. Please ask your consultant for the
          current link.
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="text-center">
        {s.company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.company.logoUrl} alt={s.company.name} className="mx-auto mb-6 h-10 w-auto" />
        )}
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">
          Your solar proposal
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">
          Own your power, {s.customer.name.split(" ")[0]}.
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
          A {s.system.sizeKwDc.toFixed(2)} kW system for {s.customer.address}, designed to cover{" "}
          <strong>{Math.round(s.system.offsetPct)}%</strong> of what your home uses.
        </p>
      </header>

      {/* ── Headline numbers ─────────────────────────────────────────────── */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="System size" value={`${s.system.sizeKwDc.toFixed(2)} kW`} />
        <Stat label="Year-one production" value={`${s.system.year1ProductionKwh.toLocaleString()} kWh`} />
        <Stat label="Energy offset" value={`${Math.round(s.system.offsetPct)}%`} />
        <Stat
          label="25-year savings"
          value={usd(s.savings.totalSavingsCents)}
          tone={s.savings.totalSavingsCents >= 0 ? "good" : undefined}
        />
      </section>

      {/* ── Environmental ────────────────────────────────────────────────── */}
      <Section title="What this does for the planet">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Impact icon={Leaf} value={`${s.environmental.tonsCo2Avoided.toLocaleString()}`} label="tons CO₂ avoided" />
          <Impact icon={TreePine} value={`${s.environmental.treesEquivalent.toLocaleString()}`} label="trees planted, equivalent" />
          <Impact icon={Factory} value={`${s.environmental.poundsCoalAvoided.toLocaleString()}`} label="lbs coal not burned" />
          <Impact icon={Sun} value={`${s.environmental.milesNotDriven.toLocaleString()}`} label="miles not driven" />
        </div>
      </Section>

      {/* ── System specs ─────────────────────────────────────────────────── */}
      <Section title="Your system">
        <dl className="divide-y divide-border text-sm">
          <Row k="Size" v={`${s.system.sizeKwDc.toFixed(2)} kW-DC`} />
          <Row k="Year-one production" v={`${s.system.year1ProductionKwh.toLocaleString()} kWh`} />
          <Row k="Energy offset" v={`${Math.round(s.system.offsetPct)}% of your usage`} />
          {s.system.moduleLabel && <Row k="Panels" v={`${s.system.moduleQty} × ${s.system.moduleLabel}`} />}
          {s.system.inverterLabel && <Row k="Inverter" v={s.system.inverterLabel} />}
          {s.system.batteryLabel && <Row k="Battery" v={s.system.batteryLabel} />}
          <Row k="Mounting" v={s.system.mountType === "ground" ? "Ground mount" : "Roof mount"} />
          {s.system.utilityProvider && <Row k="Utility" v={s.system.utilityProvider} />}
          {s.system.netMeteringProgram && <Row k="Billing programme" v={s.system.netMeteringProgram} />}
        </dl>
      </Section>

      {/* ── Savings ──────────────────────────────────────────────────────── */}
      <Section title="Staying with the utility vs going solar">
        <p className="mb-3 text-sm text-muted-foreground">
          Assumes your utility rate rises {s.assumptions.utilityEscalationPct}% a year and your
          panels lose {s.assumptions.annualDegradationPct}% output annually. Both are estimates.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Year</th>
                <th className="py-2 text-right font-medium">Utility</th>
                <th className="py-2 text-right font-medium">With solar</th>
                <th className="py-2 text-right font-medium">Cumulative saved</th>
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
      </Section>

      {/* ── Financing ────────────────────────────────────────────────────── */}
      <Section title="How you pay for it">
        <dl className="divide-y divide-border text-sm">
          <Row k="Option" v={PRODUCT_LABEL[f.product] ?? f.product} />
          {f.lender && <Row k="Lender" v={f.lender} />}
          {f.contractPriceCents != null && <Row k="System price" v={usd(f.contractPriceCents)} />}
          {f.monthlyPaymentCents != null && <Row k="Monthly payment" v={usd(f.monthlyPaymentCents, 2)} />}
          {f.rateMillsPerKwh != null && <Row k="Rate" v={`$${(f.rateMillsPerKwh / 1000).toFixed(3)} per kWh`} />}
          {f.escalatorPct != null && <Row k="Annual increase" v={`${f.escalatorPct}%`} />}
          {f.termYears != null && <Row k="Term" v={`${f.termYears} years`} />}
          {f.aprPct != null && <Row k="APR" v={`${f.aprPct}%`} />}
          {/* Rendered ONLY when the company has configured a credit. An
              unconfigured percentage omits the line rather than showing $0. */}
          {f.itcEstimateCents != null && f.itcPct != null && (
            <Row k={`Estimated federal credit (${f.itcPct}%)`} v={usd(f.itcEstimateCents)} />
          )}
        </dl>
        {f.itcEstimateCents != null && (
          <p className="mt-3 rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {s.disclaimers.incentive}
          </p>
        )}
      </Section>

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
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

      {/* ── Accept ───────────────────────────────────────────────────────── */}
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
        ) : (
          <AcceptForm token={token} onSigned={() => setSigned(true)} />
        )}
      </Section>

      {/* ── Disclaimer + assumptions ─────────────────────────────────────── */}
      <footer className="mt-10 space-y-3 border-t border-border pt-6">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {s.disclaimers.estimate}
        </p>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-medium">Assumptions used in this proposal</summary>
          <ul className="mt-2 space-y-0.5">
            <li>Production: {s.assumptions.kwhPerKwYear} kWh per kW per year, {Math.round((1 - s.assumptions.derateFactor) * 100)}% system losses</li>
            <li>Panel degradation: {s.assumptions.annualDegradationPct}% per year</li>
            <li>Utility rate increase: {s.assumptions.utilityEscalationPct}% per year</li>
            <li>Current utility rate: ${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)} per kWh</li>
            {s.assumptions.federalItcPct != null && <li>Federal credit: {s.assumptions.federalItcPct}%</li>}
          </ul>
        </details>
        <p className="text-[11px] text-muted-foreground">
          Prepared {new Date(s.generatedAt).toLocaleDateString()} by {s.company.name}
          {s.company.phone ? ` · ${s.company.phone}` : ""}
        </p>
      </footer>
    </main>
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
        className={`font-display text-lg font-semibold sm:text-xl ${tone === "good" ? "text-emerald-600" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
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
      <Icon className="mx-auto size-5 text-emerald-600" />
      <div className="mt-1.5 font-display text-lg font-semibold">{value}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
