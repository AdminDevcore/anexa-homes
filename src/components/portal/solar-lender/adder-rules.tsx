"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AdderRuleOption, LenderDraft, LenderRow } from "./types";
import { Caution, Hint, Pill } from "@/components/portal/settings-kit/fields";

/**
 * What ONE lender does with each adder: on top of its price, or out of it.
 *
 * Three states in the data and two on the screen, deliberately. The table
 * distinguishes "this partner says on top", "this partner says inside" and "no
 * rule, ask the catalogue" — but a person setting this up is answering a yes/no
 * question about a partner they know, so the switch is yes/no and the third
 * state is what it STARTS at. Where a lender has no rule the row shows the
 * catalogue's answer and says so; saving turns every row into an explicit rule,
 * which is what makes it possible to say "not for this one" about an adder the
 * catalogue puts on top.
 *
 * CONTROLLED. The draft belongs to the lender panel, so the single Save at the
 * bottom of the screen commits these together with everything else about the
 * partner. It used to carry its own Save, which meant setting a partner up
 * involved two saves in two places and no way to tell which of them you had
 * already pressed.
 */
export function AdderRulesPanel({
  lender,
  catalogue,
  draft,
  lenderDraft,
  canEdit,
  onChange,
}: {
  lender: LenderRow;
  catalogue: AdderRuleOption[];
  draft: Record<string, boolean>;
  /** Read for the price the rules sit on top OF — which may be unsaved. */
  lenderDraft: LenderDraft;
  canEdit: boolean;
  onChange: (next: Record<string, boolean>) => void;
}) {
  const onTop = catalogue.filter((a) => draft[a.id]);
  /** Rows this lender has never ruled on, so the screen can say whose answer it is showing. */
  const unruled = catalogue.filter((a) => lender.adderRules[a.id] === undefined);
  const priced = lenderDraft.ppwMode !== "normal" || lenderDraft.batteryMode !== "normal";
  const ppw = lenderDraft.ppwMode !== "normal" ? lenderDraft.maxFinalPpw.trim() : "";

  if (catalogue.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No sellable adders in the catalogue yet. Add the extra work you sell on{" "}
        <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
          Solar Equipment
        </Link>{" "}
        and each partner can then say whether it funds it on top of its price.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Where extra work is paid from</h3>
          <Pill tone={onTop.length > 0 ? "gold" : "plain"}>
            {onTop.length === 0
              ? "everything inside the price"
              : `${onTop.length} of ${catalogue.length} on top${ppw ? ` of $${ppw}/W` : ""}`}
          </Pill>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          On a partner with a fixed or maximum $/W, every adder comes out of that figure by default:
          the homeowner&rsquo;s number does not move and the work is paid for out of what you keep.
          Switch one on here and this partner funds it{" "}
          <span className="font-medium text-foreground">on top</span>{" "}of that figure instead. It is
          still part of the gross, so the dealer fee is taken on it like every other adder: at an 18%
          fee a 10&nbsp;kW job at $5.50/W is $55,000, and the same job with a $7,000 roof on top is
          $63,537.
        </p>
        {!priced && (
          <div className="mt-3">
            <Caution>
              This partner has no fixed or maximum price, so its adders are quoted the ordinary way
              and nothing here changes a deal. Set one on the Pricing tab and these start applying.
            </Caution>
          </div>
        )}
      </div>

      <ul className="grid gap-2 lg:grid-cols-2">
        {catalogue.map((a) => {
          const checked = !!draft[a.id];
          const inherited = lender.adderRules[a.id] === undefined;
          return (
            <li key={a.id}>
              <label
                className={cn(
                  "flex h-full items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
                  checked ? "border-gold/50 bg-gold/[0.06]" : "border-border bg-card",
                  canEdit ? "cursor-pointer hover:border-gold/40" : "cursor-default"
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-gold"
                  checked={checked}
                  disabled={!canEdit}
                  aria-label={`${a.label} rides on top of ${lender.name}'s price`}
                  onChange={(e) => onChange({ ...draft, [a.id]: e.target.checked })}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{a.label}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {a.rateLabel}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {checked
                      ? "Added to the loan on top, at this price."
                      : "Comes out of this partner's price."}
                    {inherited && " Showing the catalogue's answer — not set here yet."}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {unruled.length > 0 && (
        <Hint>
          {unruled.length} of these{" "}
          {unruled.length === 1 ? "is showing the catalogue's" : "are showing the catalogue's"}{" "}
          answer. Saving this partner makes them its own.
        </Hint>
      )}

      {/* The one thing that is NOT true of this screen, said before somebody
          assumes otherwise: the flag is copied onto a deal when the adder is
          picked, so this moves the next quote and not the last one. */}
      <Hint>
        Applies to work added from now on. A deal already carrying an adder keeps what it was quoted
        at until somebody sets its lender again on the Financing step, which re-reads these.
      </Hint>
    </div>
  );
}
