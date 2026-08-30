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
 * with a slider on it — the same rule the payment menu next door follows.
 *
 * NOTHING PRINTS IN ITS PLACE, and that is deliberate as of 2026-08-30. There
 * used to be a caption — "With your federal tax credits applied. Until they are
 * claimed and applied to the loan, the payment is $355.78 a month." — stating
 * the scenario and naming the figure from the other one. It went because a
 * household is not being asked to hold two payments in their head: they are
 * shown a deal, whole, under one assumption, and the rep throws the switch to
 * show them the other. Each filed PDF is one of the two, complete.
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
