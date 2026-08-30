"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { usd } from "./format";

/**
 * THE TAX-CREDIT SWITCH — one deal, read two ways.
 *
 * A household on a credit-funded programme has two futures, and the document
 * used to print both figures as static tiles with nothing saying which one the
 * rest of it had been written in. Now there is a switch, whichever way it is
 * thrown is what the WHOLE document says, and it lives in the document's own
 * nav bar so it is reachable from any sheet rather than buried in the column
 * of the one sheet that happened to hold it.
 *
 * OFF is the document exactly as it has always read — the quoted payment, and
 * the thirty years modelled the way a credit-funded loan actually runs. ON is
 * the same deal with the credits already applied: the lower payment from the
 * first month. Both were computed at generation and frozen; nothing here
 * calculates anything.
 *
 * IT DOES NOT PRINT. It is a control, and a control in a PDF is a dead thing
 * with a slider on it — the same rule the payment menu next door follows. What
 * prints instead is `CreditBasis`, below: the same fact set as type.
 */
export function CreditSwitch({
  on,
  onChange,
  monthlyCents,
  compact = false,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** What the payment is under the state the switch is currently in. */
  monthlyCents: number | null;
  /** Drop the figure and shorten the label — for the narrow nav bar. */
  compact?: boolean;
  className?: string;
}) {
  return (
    /* ONE BUTTON, pill and words together. Split into a switch beside a label,
       the words looked clickable, were not, and a rep tapping "Tax credit
       applied" on a phone got nothing — which reads as a broken control rather
       than a missed target. */
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors print:hidden",
        "hover:bg-neutral-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--proposal-accent)]/50",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          on
            ? "border-[color:var(--proposal-accent)] bg-[color:var(--proposal-accent)]"
            : "border-neutral-300 bg-neutral-200"
        )}
      >
        <span
          className={cn(
            "inline-block size-[18px] rounded-full bg-white shadow-sm transition-transform",
            on ? "translate-x-[22px]" : "translate-x-[3px]"
          )}
        />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block whitespace-nowrap font-medium leading-tight",
            compact ? "text-[13px]" : "text-sm",
            on ? "text-neutral-900" : "text-neutral-500"
          )}
        >
          Tax credit applied
        </span>
        {/* The consequence, beside the control that caused it. Dropped in the
            nav, where the figure is three inches away in 60px type anyway. */}
        {!compact && (
          <span className="mt-0.5 block text-xs tabular-nums text-neutral-500">
            {monthlyCents != null ? `${usd(monthlyCents, 2)} a month` : " "}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * WHAT THE SWITCH IS ASSUMING, as type — and ONLY once it is on.
 *
 * The switch does not print, so a document showing the credit-funded payment
 * with nothing on the page saying so would be a payment nobody can account for
 * — and the two figures differ by more than a factor of two. So when the switch
 * is ON this states the basis, and states the other figure too, because a
 * document that shows only the number that flatters the deal is the thing this
 * whole feature was added to stop.
 *
 * WHEN IT IS OFF IT RENDERS NOTHING, as of 2026-08-30. It used to print the
 * mirror sentence — "Before your federal tax credits. Once they are claimed and
 * applied to the loan, it becomes $161.33 a month." — which put the credit
 * conversation in front of a homeowner on the sheet where the rep had
 * deliberately not started it yet. Off means the credits are not part of this
 * copy, and a caption naming them is part of this copy. The rep throws the
 * switch when the conversation reaches them, and every mention arrives at once.
 *
 * Null rather than a caller-side condition so there is ONE rule and no future
 * call site can leak the off-state copy back onto a sheet.
 */
export function CreditBasis({
  on,
  otherMonthlyCents,
  className,
}: {
  on: boolean;
  /** The payment under the OTHER state — the one this copy is not showing. */
  otherMonthlyCents: number | null;
  className?: string;
}) {
  if (!on) return null;
  return (
    <p className={cn("text-[0.82rem] leading-relaxed text-neutral-500", className)}>
      <span className="font-medium text-neutral-700">
        With your federal tax credits applied.
      </span>{" "}
      {otherMonthlyCents != null && (
        <>
          Until they are claimed and applied to the loan, the payment is{" "}
          <strong className="font-semibold tabular-nums text-neutral-700">
            {usd(otherMonthlyCents, 2)}
          </strong>{" "}
          a month.
        </>
      )}
    </p>
  );
}
