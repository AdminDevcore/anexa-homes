"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { usd } from "./format";

/**
 * THE TAX-CREDIT SWITCH — one deal, read two ways.
 *
 * A household on a credit-funded programme has two futures and the document
 * used to print both figures as static tiles side by side, with everything
 * underneath — the payment headline, the year-by-year card, the payback year —
 * silently committed to one of them. A reader could see $355.78 and $161.33 in
 * the same panel and had no way to tell which of the two the thirty-year table
 * beneath was actually built on.
 *
 * So the two figures became a control. Whichever side is lit is the one the
 * WHOLE document is written in: flip it and the headline, the menu, the year
 * card, the table, the chart and the payback year all move together. Both
 * models were frozen at generation — nothing here computes.
 *
 * IT PRINTS. This is the one control on the document that does, and it is not
 * an exception to the rule that a control in a PDF is a dead thing with a
 * chevron on it — on paper it stops being a control and becomes what it always
 * was underneath: two figures, with the one this copy is written in marked. A
 * printed document that showed only the lit figure would be a document whose
 * reader cannot tell which future they are holding.
 */
export function CreditSwitch({
  on,
  onChange,
  offMonthlyCents,
  onMonthlyCents,
  tone = "paper",
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** What the loan asks for while the credits go unclaimed. */
  offMonthlyCents: number | null;
  /** What it asks for once they are applied. */
  onMonthlyCents: number | null;
  /**
   * `paper` for the cream sheets, `card` for the white panels in the back
   * matter. The two grounds want different borders — a hairline that reads on
   * cream disappears on white.
   */
  tone?: "paper" | "card";
  className?: string;
}) {
  const id = React.useId();

  return (
    <div className={className}>
      <p
        id={`${id}-label`}
        className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400"
      >
        Your federal tax credits
      </p>
      {/* A radio group rather than a checkbox: there are two named states and
          each one has a figure of its own, so a screen reader should hear both
          and which is chosen — not "tax credits, checked". */}
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="mt-2 grid grid-cols-2 gap-2"
      >
        <Face
          selected={!on}
          onSelect={() => onChange(false)}
          label="Not applied"
          amountCents={offMonthlyCents}
          tone={tone}
        />
        <Face
          selected={on}
          onSelect={() => onChange(true)}
          label="Applied"
          amountCents={onMonthlyCents}
          tone={tone}
          accent
        />
      </div>
      {/* WHAT THE SWITCH ACTUALLY DID, in a sentence, because a lit tile is not
          self-explanatory: a reader has to be told that the figures further
          down the page moved with it. */}
      <p className="mt-2 text-[0.78rem] leading-relaxed text-neutral-500">
        {on
          ? "Every figure in this proposal is shown with your credits claimed and applied to the loan."
          : "Every figure in this proposal is shown without your credits — what you pay if they are never claimed."}
      </p>
    </div>
  );
}

/** One side of the switch: what it is called, and what it costs a month. */
function Face({
  selected,
  onSelect,
  label,
  amountCents,
  tone,
  accent = false,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  amountCents: number | null;
  tone: "paper" | "card";
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-xl border p-3 text-left transition",
        // The unlit side stays legible rather than greying out: it is the other
        // half of the answer, not a disabled control.
        selected
          ? accent
            ? "border-[color:var(--proposal-accent)] bg-[color:var(--proposal-accent)]/12 ring-1 ring-[color:var(--proposal-accent)]/40"
            : "border-neutral-900/45 bg-white ring-1 ring-neutral-900/20"
          : tone === "card"
            ? "border-neutral-200 bg-neutral-50 hover:border-neutral-400"
            : "border-neutral-900/12 bg-white/60 hover:border-neutral-900/30",
        "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"
      )}
    >
      <span className="flex items-center gap-1.5">
        {/* The mark carries the state as SHAPE as well as colour — the printed
            copy is frequently a black-and-white photocopy by the time anybody
            files it. */}
        <span
          aria-hidden
          className={cn(
            "grid size-3 shrink-0 place-items-center rounded-full border",
            "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
            selected
              ? accent
                ? "border-[color:var(--proposal-accent)] bg-[color:var(--proposal-accent)]"
                : "border-neutral-900 bg-neutral-900"
              : "border-neutral-400 bg-transparent"
          )}
        />
        <span
          className={cn(
            "text-[9px] font-semibold uppercase leading-tight tracking-[0.14em]",
            selected ? "text-neutral-600" : "text-neutral-400"
          )}
        >
          {label}
        </span>
      </span>
      <span className="mt-1 block font-display text-base font-bold tabular-nums text-neutral-950">
        {amountCents != null ? `${usd(amountCents, 2)}/mo` : "—"}
      </span>
    </button>
  );
}
