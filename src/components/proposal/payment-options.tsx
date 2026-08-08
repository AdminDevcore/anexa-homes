"use client";

import * as React from "react";
import { formatScopeCents } from "@/lib/scope";
import { activeFinanceOption, type PaymentPlan, type PaymentSelection } from "@/lib/proposal";
import { selectPaymentOptionAction } from "@/server/modules/proposals/actions";

/**
 * The close: one price, two ways to pay it.
 *
 * Because the terms are 0%, both columns total the same money — they differ
 * only in when it is paid, which is exactly the choice a homeowner is actually
 * making. The cash column always renders (the customer has to see the total
 * regardless); the monthly column appears only when the rep enabled financing
 * and picked at least one term.
 */
export function PaymentOptions({
  token,
  mode,
  plan,
  selected,
  cashLabel,
  cashCaption,
}: {
  token: string;
  mode: "public" | "preview";
  plan: PaymentPlan;
  selected: PaymentSelection | undefined;
  /** "Pay in full" on cash; the deductible framing on insurance. */
  cashLabel: string;
  cashCaption: string;
}) {
  const preview = mode === "preview";
  const [choice, setChoice] = React.useState<PaymentSelection | undefined>(selected);
  const [months, setMonths] = React.useState<number | null>(
    activeFinanceOption(plan, selected)?.months ?? null,
  );
  const [busy, setBusy] = React.useState<"cash" | "finance" | null>(null);

  const shown = plan.financeOptions.find((o) => o.months === months) ?? plan.headline;
  const hasFinance = plan.financeOptions.length > 0;

  async function choose(next: "cash" | "finance") {
    if (preview || busy) return;
    setBusy(next);
    const res = await selectPaymentOptionAction({
      token,
      mode: next,
      ...(next === "finance" && shown ? { months: shown.months } : {}),
    });
    setBusy(null);
    if (!res.ok) return;
    setChoice({
      mode: next,
      ...(next === "finance" && shown ? { months: shown.months } : {}),
      at: new Date().toISOString(),
    });
  }

  return (
    <div className="mt-10">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">
        {hasFinance ? "Choose how you'd like to pay" : "How you pay"}
      </p>

      <div className={`mt-5 grid gap-4 ${hasFinance ? "sm:grid-cols-2" : ""}`}>
        <Option
          title={cashLabel}
          amount={<Money cents={plan.totalCents} />}
          caption={cashCaption}
          chosen={choice?.mode === "cash"}
          busy={busy === "cash"}
          preview={preview}
          onChoose={() => choose("cash")}
        />

        {hasFinance && shown && (
          <Option
            title="Monthly payments"
            amount={
              <>
                <Money cents={shown.monthlyCents} />
                <span className="text-2xl font-medium text-white/60">/mo</span>
              </>
            }
            caption={`${shown.months} months · 0% interest · ${formatScopeCents(plan.totalCents)} total`}
            chosen={choice?.mode === "finance"}
            busy={busy === "finance"}
            preview={preview}
            onChoose={() => choose("finance")}
          >
            {plan.financeOptions.length > 1 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {plan.financeOptions.map((o) => (
                  <button
                    key={o.months}
                    type="button"
                    onClick={() => setMonths(o.months)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      o.months === shown.months
                        ? "bg-[var(--proposal-accent)] text-white"
                        : "bg-white/10 text-white/70 hover:bg-white/20"
                    }`}
                  >
                    {o.months} mo
                  </button>
                ))}
              </div>
            )}
          </Option>
        )}
      </div>

      {hasFinance && (
        <p className="mt-3 text-xs text-white/50">
          Estimated payments shown at 0% interest. Final financing terms are subject to approval.
        </p>
      )}
    </div>
  );
}

function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatScopeCents(cents)}</span>;
}

function Option({
  title,
  amount,
  caption,
  chosen,
  busy,
  preview,
  onChoose,
  children,
}: {
  title: string;
  amount: React.ReactNode;
  caption: string;
  chosen: boolean;
  busy: boolean;
  preview: boolean;
  onChoose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex break-inside-avoid flex-col rounded-2xl border p-6 transition-all duration-300 ${
        chosen
          ? "border-[var(--proposal-accent)] bg-[var(--proposal-accent)]/10"
          : "border-white/10 bg-white/[0.04] hover:border-white/25"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{title}</p>
      <p className="mt-3 font-display text-5xl font-bold leading-none tracking-tight text-white">{amount}</p>
      <p className="mt-2.5 text-sm text-neutral-300">{caption}</p>
      {children}
      <div className="mt-5 flex-1 items-end print:hidden">
        {chosen ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--proposal-accent)]">
            <span className="flex size-5 items-center justify-center rounded-full bg-[var(--proposal-accent)] text-[11px] text-white">
              ✓
            </span>
            Your selection
          </p>
        ) : (
          <button
            type="button"
            onClick={onChoose}
            disabled={busy || preview}
            className="w-full rounded-xl border border-white/25 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white hover:text-neutral-900 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-white"
          >
            {busy ? "Saving…" : preview ? "Preview only" : "Choose this"}
          </button>
        )}
      </div>
    </div>
  );
}
