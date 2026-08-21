import type { ProposalPaymentOption, SolarProposalSnapshot } from "@/lib/solar-proposal";
import { usd, kwh, pct, perKwh } from "./format";

/**
 * The two futures, side by side.
 *
 * One column is what happens if the homeowner does nothing, and it is the
 * column most proposals forget to price. "Doing nothing" is not free: it is a
 * bill that compounds at the utility's escalation rate for twenty-five years,
 * and until that number is on the page next to the system's, the system looks
 * like an expense rather than a substitution.
 *
 * EVERY FIGURE HERE COMES OUT OF THE SAME FROZEN MODEL the table below renders.
 * Nothing is recomputed for the sake of the layout — a comparison card that
 * disagreed with the table underneath it would be worse than no card.
 */
export function CompareCards({
  snapshot,
  option,
}: {
  snapshot: SolarProposalSnapshot;
  option: ProposalPaymentOption;
}) {
  const s = snapshot;
  const sv = option.savings;
  const f = option.financing;

  const utilityTotal = sv.years.reduce((n, y) => n + y.utilityCostCents, 0);
  const solarTotal = sv.years.reduce((n, y) => n + y.solarCostCents, 0);
  const years = sv.years.length;
  const rate = s.assumptions.currentRateMillsPerKwh;

  // What the solar path costs per kWh over its life — the honest like-for-like
  // against the utility's rate, and the only way to compare a lease with a loan.
  const lifetimeKwh = sv.years.reduce((n, y) => n + y.productionKwh, 0);
  const solarRateMills = lifetimeKwh > 0 ? Math.round((sv.solarPaidCents * 10) / lifetimeKwh) : null;

  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-2">
      <Card
        tone="grey"
        eyebrow="If you do nothing"
        title="Stay with the utility"
        headline={usd(utilityTotal)}
        headlineNote={`what ${years} years of power costs at today's rate, rising ${pct(s.assumptions.utilityEscalationPct)} a year`}
        rows={[
          ["Your utility", s.energy.utilityProvider],
          ["Rate today", rate > 0 ? perKwh(rate) : null],
          ["Annual increase", pct(s.assumptions.utilityEscalationPct)],
          ["What you use a year", s.energy.annualUsageKwh > 0 ? kwh(s.energy.annualUsageKwh) : null],
          [
            "Your bill today",
            s.energy.avgMonthlyBillCents != null
              ? `${usd(s.energy.avgMonthlyBillCents, 0)} a month`
              : null,
          ],
        ]}
        footK={`Estimated ${years}-year cost`}
        footV={usd(utilityTotal)}
      />

      <Card
        tone="accent"
        eyebrow="If you go ahead"
        title="Own your own power"
        headline={usd(sv.netSavingsCents)}
        headlineNote={`kept over ${years} years, after paying for the system itself`}
        rows={[
          ["System size", `${s.system.sizeKwDc.toFixed(2)} kW`],
          ["Year-one production", kwh(s.system.year1ProductionKwh)],
          ["Rate for that power", solarRateMills != null ? perKwh(solarRateMills) : null],
          [
            "Annual increase",
            f.escalatorPct != null
              ? pct(f.escalatorPct)
              : f.product === "cash" || f.product === "loan"
                ? "None — the price is fixed"
                : null,
          ],
          ["Grid power still bought", `${usd(option.postSolarMonthlyCents, 0)} a month`],
        ]}
        footK={`Estimated ${years}-year cost`}
        footV={usd(solarTotal)}
      />
    </div>
  );
}

function Card({
  tone,
  eyebrow,
  title,
  headline,
  headlineNote,
  rows,
  footK,
  footV,
}: {
  tone: "grey" | "accent";
  eyebrow: string;
  title: string;
  headline: string;
  headlineNote: string;
  rows: [string, string | null | undefined][];
  footK: string;
  footV: string;
}) {
  const accent = tone === "accent";
  return (
    <div
      className={
        accent
          ? "flex break-inside-avoid flex-col overflow-hidden rounded-3xl bg-neutral-950 text-white ring-1 ring-neutral-900 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
          : "flex break-inside-avoid flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-neutral-200/70"
      }
    >
      <div className="p-7 sm:p-8">
        <p
          className={
            accent
              ? "text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--proposal-accent)]"
              : "text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400"
          }
        >
          {eyebrow}
        </p>
        <h3
          className={
            accent
              ? "mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
              : "mt-2 font-display text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl"
          }
        >
          {title}
        </h3>

        <p
          className={
            accent
              ? "mt-7 font-display text-5xl font-bold leading-none tracking-tight sm:text-6xl"
              : "mt-7 font-display text-5xl font-bold leading-none tracking-tight text-neutral-900 sm:text-6xl"
          }
        >
          {headline}
        </p>
        <p className={accent ? "mt-3 text-sm leading-relaxed text-neutral-400" : "mt-3 text-sm leading-relaxed text-neutral-500"}>
          {headlineNote}
        </p>
      </div>

      <dl
        className={
          accent
            ? "mt-auto divide-y divide-white/10 border-t border-white/10 px-7 text-sm sm:px-8"
            : "mt-auto divide-y divide-neutral-100 border-t border-neutral-100 px-7 text-sm sm:px-8"
        }
      >
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-3">
              <dt className={accent ? "text-neutral-400" : "text-neutral-500"}>{k}</dt>
              <dd className={accent ? "text-right font-medium text-white" : "text-right font-medium text-neutral-900"}>
                {v}
              </dd>
            </div>
          ))}
        <div className="flex items-baseline justify-between gap-4 py-4">
          <dt className={accent ? "font-semibold text-white" : "font-semibold text-neutral-900"}>
            {footK}
          </dt>
          <dd
            className={
              accent
                ? "text-right font-display text-xl font-bold tabular-nums text-white"
                : "text-right font-display text-xl font-bold tabular-nums text-neutral-900"
            }
          >
            {footV}
          </dd>
        </div>
      </dl>
    </div>
  );
}
