"use client";

import * as React from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { LenderMark } from "@/components/ui/lender-mark";
import type { ProposalPaymentOption } from "@/lib/solar-proposal";
import { usd } from "./format";

/**
 * The close: one system, and every way this household can pay for it.
 *
 * WHAT THIS IS NOT: a calculator. Every figure it shows was priced on the
 * server at generation and frozen into the document. Switching options does not
 * recompute anything — it reads a different frozen answer. That is the
 * difference between a record of what was offered and a page whose numbers can
 * be edited from a developer console, and it is the reason the whole options
 * array crosses the wire instead of a rate sheet.
 *
 * The quoted option is preselected and first. A rep leads with one number; the
 * menu is for the household that wants to see the others, and for the moment
 * the conversation turns into "what would cash look like".
 */
export function PaymentMenu({
  options,
  selectedKey,
  onSelect,
  /** Hidden entirely when the rep has turned the menu off, or there is one option. */
  showMenu,
}: {
  options: ProposalPaymentOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
  showMenu: boolean;
}) {
  const selected = options.find((o) => o.key === selectedKey) ?? options[0];
  const f = selected.financing;
  const offerMenu = showMenu && options.length > 1;

  return (
    <div className="mt-8 overflow-hidden rounded-2xl bg-white text-neutral-900 shadow-xl ring-1 ring-black/5 print:shadow-none print:ring-neutral-300">
      {/* Two columns, or three when there is somewhere to send them. Reserving
          the third for a Qualify button that does not exist leaves a third of
          the card empty, which reads as something that failed to load. */}
      <div
        className={cn(
          "grid gap-px bg-neutral-200/70",
          f.applyUrl
            ? "sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]"
            : "sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
        )}
      >
        {/* ── What you picked ─────────────────────────────────────────── */}
        <div className="bg-white p-6">
          {offerMenu ? (
            <OptionPicker options={options} selectedKey={selected.key} onSelect={onSelect} />
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                How you pay
              </p>
              <p className="mt-1.5 font-display text-xl font-semibold leading-snug">
                {selected.label}
              </p>
            </>
          )}

          {f.lender && (
            <div className="mt-4 flex items-center gap-2.5">
              <LenderMark name={f.lender} logoUrl={f.lenderLogoUrl} size="md" />
              <span className="text-sm font-medium text-neutral-600">{f.lender}</span>
            </div>
          )}
        </div>

        {/* ── What it costs ───────────────────────────────────────────── */}
        <div className="flex flex-col justify-center gap-3 bg-white p-6">
          {selected.monthlyCents != null ? (
            <Line
              k={termLabel(selected)}
              v={
                <>
                  {usd(selected.monthlyCents, 0)}
                  <span className="text-base font-medium text-neutral-400">/mo</span>
                </>
              }
              strong
            />
          ) : (
            <Line
              k="Due at completion"
              v={usd(f.contractPriceCents ?? 0)}
              strong
            />
          )}

          {f.contractPriceCents != null && selected.monthlyCents != null && (
            <Line k="Total system price" v={usd(f.contractPriceCents)} />
          )}

          {/*
            The bill that does NOT go away.
            A proposal that shows a monthly payment and stops there implies the
            utility bill went to zero, and it never does. An offset under 100%
            means grid power is still bought every month, and even at full
            offset the utility bills its standing meter charge — which is why
            this figure is grid power PLUS that fee and cannot read $0.
            Printing it here, beside the payment, is the difference between a
            homeowner who was told and one who finds out in November.
          */}
          <Line
            k="Utility bill afterwards"
            v={`${usd(selected.postSolarMonthlyCents, 0)}/mo`}
            muted
          />
        </div>

        {/* ── What to do about it ─────────────────────────────────────── */}
        {f.applyUrl && (
          <div className="flex items-center bg-white p-6 print:hidden">
            <a
              href={f.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-neutral-900 px-8 py-4 font-display text-lg font-bold tracking-[0.12em] text-neutral-900 transition hover:bg-neutral-900 hover:text-white sm:w-auto"
            >
              QUALIFY <ExternalLink className="size-4" />
            </a>
          </div>
        )}
      </div>

      {f.applyUrl && (
        <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
          Opens {f.lender ?? "the lender"}&rsquo;s own secure application. Nothing is submitted from
          this page, and no information here is sent anywhere.
        </p>
      )}
    </div>
  );
}

/**
 * The menu itself.
 *
 * A native `<select>` under a styled shell rather than a bespoke listbox: this
 * document is read on a phone, in a driveway, by someone who has never used it
 * before, and the platform's own picker is the one control they already know.
 * It is also the one that works with a screen reader without being rebuilt.
 */
function OptionPicker({
  options,
  selectedKey,
  onSelect,
}: {
  options: ProposalPaymentOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const id = React.useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
      >
        How you pay
      </label>
      <div className="relative mt-1.5">
        <select
          id={id}
          value={selectedKey}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full appearance-none rounded-xl border border-neutral-300 bg-white py-3 pl-3.5 pr-10 font-display text-lg font-semibold text-neutral-900 outline-none transition focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/15"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
              {o.monthlyCents != null ? ` — ${usd(o.monthlyCents, 0)}/mo` : ""}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
      </div>
    </div>
  );
}

/**
 * What the monthly figure is actually FOR.
 *
 * A loan's payment runs for its term and then stops; a lease's runs for the
 * term and escalates; a PPA's is an average of a bill that moves with the
 * weather. Labelling all three "Monthly payment" is how a homeowner ends up
 * believing a 25-year lease is a 25-year loan.
 */
function termLabel(o: ProposalPaymentOption): string {
  const f = o.financing;
  if (f.product === "loan") return "Your monthly payment";
  if (f.product === "lease") return f.termYears ? `Monthly, ${f.termYears} years` : "Monthly";
  if (f.product === "ppa") return "Monthly, on average";
  return "Monthly";
}

function Line({
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
    <div className="flex items-baseline justify-between gap-4">
      <span className={cn("text-sm", muted ? "text-neutral-400" : "text-neutral-500")}>{k}</span>
      <span
        className={cn(
          "text-right tabular-nums",
          strong
            ? "font-display text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl"
            : muted
              ? "text-base font-medium text-neutral-500"
              : "text-lg font-semibold text-neutral-800"
        )}
      >
        {v}
      </span>
    </div>
  );
}
