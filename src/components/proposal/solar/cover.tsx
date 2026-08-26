"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import type { CoverPitch } from "@/lib/solar-proposal-pitch";
import { usd, kwh, pctWhole } from "../format";

/**
 * "An 8.00 kW", "A 6.40 kW" — the article follows how the number is SPOKEN,
 * and 8/11/18 are the sizes that start with a vowel sound.
 */
export function article(kw: number): "A" | "An" {
  const whole = Math.floor(kw);
  if (whole === 8 || whole === 11 || whole === 18) return "An";
  const lead = String(whole);
  if (lead.startsWith("8") || lead.startsWith("11") || lead.startsWith("18")) return "An";
  return "A";
}

/**
 * The cover.
 *
 * Editorial paper rather than the full-bleed photograph it used to be: type on
 * the left at display size, the photograph demoted to a plate on the right. The
 * old cover put four stat tiles over a dark image and then repeated three of
 * them one screen later — the tiles are gone and the specs are one line.
 *
 * What the cover PROMISES is decided by `coverPitch`, not here. See that module
 * for why a fixed "your new monthly payment" cover is a lie on a real class of
 * financed deals.
 */
export function Cover({
  s,
  name,
  pitch,
  photoUrl = "/img/solar.jpg",
}: {
  s: SolarProposalSnapshot;
  name: string;
  pitch: CoverPitch;
  photoUrl?: string;
}) {
  return (
    <section
      data-section="cover"
      data-chapter
      className={cn(
        "relative grid scroll-mt-[var(--proposal-chrome-h)] items-stretch",
        "min-h-[calc(100svh-var(--proposal-chrome-h))]",
        "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
        "print:min-h-[9.2in]",
      )}
    >
      {/* ── type side ───────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center px-6 py-16 sm:px-10 sm:py-20 lg:py-24">
        <div className="mx-auto w-full max-w-2xl lg:mx-0 lg:ml-auto lg:pr-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--proposal-accent)]">
            Your solar proposal
          </p>

          <h1 className="mt-6 font-display text-[clamp(2.8rem,7vw,4.9rem)] font-semibold leading-[0.95] tracking-[-0.03em] text-neutral-950 text-balance">
            Own your power{name ? `, ${name}` : ""}.
          </h1>

          <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-neutral-600">
            {article(s.system.sizeKwDc)}{" "}
            <strong className="font-semibold text-neutral-900">
              {s.system.sizeKwDc.toFixed(2)} kW
            </strong>{" "}
            system for{" "}
            <span className="text-neutral-900">{s.customer.address}</span>, sized to cover{" "}
            <strong className="font-semibold text-neutral-900">
              {pctWhole(s.system.offsetPct)}
            </strong>{" "}
            of what your home uses.
          </p>

          <div className="mt-10">
            <Pitch pitch={pitch} s={s} />
          </div>

          <div className="mt-10 h-px bg-neutral-900/12" />

          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
            <Meta k="Prepared">
              {new Date(s.generatedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Meta>
            <Meta k="Reference">
              <span className="tabular-nums">{s.reference}</span>
            </Meta>
            {s.representative && <Meta k="Your consultant">{s.representative.name}</Meta>}
          </dl>
        </div>
      </div>

      {/* ── plate ───────────────────────────────────────────────────────── */}
      <div className="relative min-h-[16rem] overflow-hidden bg-neutral-950 lg:min-h-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt=""
          className="size-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
        />
      </div>
    </section>
  );
}

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">{k}</dt>
      <dd className="mt-1 text-sm font-medium text-neutral-900">{children}</dd>
    </div>
  );
}

/* ── the promise ───────────────────────────────────────────────────────── */

function Pitch({ pitch, s }: { pitch: CoverPitch; s: SolarProposalSnapshot }) {
  if (pitch.kind === "coverage") {
    /**
     * The money is not the strong part of this deal, so the cover does not
     * pretend it is. Three true facts instead, and the payment is argued
     * properly in chapter 4 where its assumptions sit beside it.
     */
    return (
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
        <CoverFact k="System size" v={`${s.system.sizeKwDc.toFixed(2)} kW`} />
        <CoverFact k="Year one" v={kwh(s.system.year1ProductionKwh)} />
        <CoverFact k="Of your usage" v={pctWhole(s.system.offsetPct)} />
      </dl>
    );
  }

  const { todayCents, afterCents } = pitch;
  return (
    <div>
      <BillSwap todayCents={todayCents} afterCents={afterCents} />
      {pitch.kind === "cash-then" && pitch.priceCents != null && (
        <p className="mt-5 text-sm leading-relaxed text-neutral-600">
          After one payment of{" "}
          <strong className="font-semibold tabular-nums text-neutral-900">
            {usd(pitch.priceCents)}
          </strong>{" "}
          for the system, which is yours from the day it is switched on.
        </p>
      )}
    </div>
  );
}

function CoverFact({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-t border-neutral-900/12 pt-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{k}</dt>
      <dd className="mt-1.5 font-display text-2xl font-semibold tabular-nums tracking-[-0.02em] text-neutral-950">
        {v}
      </dd>
    </div>
  );
}

/**
 * The bill, before and after, DRAWN.
 *
 * Two numbers side by side are a comparison the reader has to perform. Two bars
 * are a comparison already performed — the argument lands before the figures
 * are read, which is the entire reason the cover leads with it.
 *
 * Bars are proportional to the larger figure, so the shorter one is honestly
 * shorter. Both are labelled and both carry their number: the drawing is
 * evidence, never the only place the value appears.
 */
export function BillSwap({
  todayCents,
  afterCents,
  compact = false,
}: {
  todayCents: number;
  afterCents: number;
  compact?: boolean;
}) {
  const max = Math.max(todayCents, afterCents, 1);
  const rows: [string, number, boolean][] = [
    ["You pay today", todayCents, false],
    ["You pay after", afterCents, true],
  ];
  return (
    /*
      ONE grid holding both rows, not a grid per row.
      Per-row grids size their own `auto` column, so "$180" and "$50" produced
      two different value widths and the two bar tracks ended at two different
      x-positions — a comparison drawn on two different scales, which is the one
      thing this figure must never be.
    */
    <dl
      className={cn(
        "grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-4",
        compact ? "gap-y-3" : "gap-y-4",
      )}
    >
      {rows.map(([label, cents, good]) => (
        <React.Fragment key={label}>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
            {label}
          </dt>
          <div
            className={cn(
              "relative overflow-hidden rounded-[3px] bg-neutral-900/[0.07]",
              compact ? "h-5" : "h-7",
            )}
          >
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-[3px]",
                "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
                good ? "bg-[var(--proposal-accent)]" : "bg-neutral-900/25",
              )}
              style={{ width: `${Math.max(3, (cents / max) * 100)}%` }}
              aria-hidden
            />
          </div>
          <dd
            className={cn(
              "text-right font-display font-semibold tabular-nums tracking-[-0.02em] text-neutral-950",
              compact ? "text-lg" : "text-2xl",
            )}
          >
            {usd(cents)}
            <span className="ml-0.5 font-sans text-xs font-normal text-neutral-500">/mo</span>
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
