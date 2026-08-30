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
 * The photograph runs the full width of the sheet and the copy sits on top of
 * it in a small, half-transparent white card. Two earlier covers are buried
 * here: a full-bleed photo with four stat tiles burned into the dark (the tiles
 * repeated three of their own figures one screen later), and an editorial split
 * that demoted the photograph to a plate on the right. This keeps the picture
 * whole and keeps the type on paper — the card IS the paper.
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
        "relative flex scroll-mt-[var(--proposal-chrome-h)] items-center overflow-hidden bg-neutral-950",
        "min-h-[calc(100svh-var(--proposal-chrome-h))]",
        "px-5 py-14 sm:px-10 sm:py-16 lg:px-16",
        "print:min-h-[9.2in]",
      )}
    >
      {/* ── the photograph, edge to edge ─────────────────────────────────── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl}
        alt=""
        className="absolute inset-0 size-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
      />
      {/* A wash under the card only. A bright sky behind a 75%-white panel
          leaves its edge nowhere to land and the card stops reading as an
          object; this darkens the side it sits on and fades out well before
          the far edge, so the photograph is still the photograph. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-gradient-to-r from-neutral-950/45 via-neutral-950/15 to-transparent",
          "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
        )}
      />

      {/* ── the card ─────────────────────────────────────────────────────── */}
      <div
        data-cover-card
        className={cn(
          "relative w-full max-w-[30rem] rounded-2xl px-6 py-7 sm:px-8 sm:py-9",
          "bg-white/75 backdrop-blur-xl",
          "ring-1 ring-white/55 shadow-[0_28px_70px_-28px_rgba(2,6,23,0.65)]",
          "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--proposal-accent)]">
          Your solar proposal
        </p>

        <h1 className="mt-4 font-display text-[clamp(2.1rem,4vw,3rem)] font-semibold leading-[0.97] tracking-[-0.03em] text-neutral-950 text-balance">
          {/* Same rule as the comparison's heading, and the largest type on
              the document, so it matters most here: a prepaid lease does not
              give the household title to the hardware, and the claim stands
              down to one that is true of every product — see `ownershipNote`
              on SnapshotFinancing. */}
          {s.financing.ownershipNote ? "Power from your own roof" : "Own your power"}
          {name ? `, ${name}` : ""}.
        </h1>

        <p className="mt-4 text-[0.95rem] leading-relaxed text-neutral-700">
          {article(s.system.sizeKwDc)}{" "}
          <strong className="font-semibold text-neutral-900">
            {s.system.sizeKwDc.toFixed(2)} kW
          </strong>{" "}
          system for <span className="text-neutral-900">{s.customer.address}</span>, sized to cover{" "}
          <strong className="font-semibold text-neutral-900">{pctWhole(s.system.offsetPct)}</strong>{" "}
          of what your home uses.
        </p>

        <div className="mt-7">
          <Pitch pitch={pitch} s={s} />
        </div>

        <div className="mt-7 h-px bg-neutral-900/15" />

        <dl data-cover-meta className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
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
    </section>
  );
}

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      {/* A shade darker than the neutral-400 this used on solid paper: the panel
          is see-through, so every muted grey on it is sitting on a photograph. */}
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{k}</dt>
      <dd className="mt-1 text-[0.8rem] font-medium text-neutral-900">{children}</dd>
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
      <dl className="grid grid-cols-3 gap-x-4 gap-y-5">
        <CoverFact k="System size" v={`${s.system.sizeKwDc.toFixed(2)} kW`} />
        <CoverFact k="Year one" v={kwh(s.system.year1ProductionKwh)} />
        <CoverFact k="Of your usage" v={pctWhole(s.system.offsetPct)} />
      </dl>
    );
  }

  const { todayCents, afterCents } = pitch;
  return (
    <div>
      <BillSwap todayCents={todayCents} afterCents={afterCents} compact />
      {pitch.kind === "cash-then" && pitch.priceCents != null && (
        <p className="mt-4 text-[0.82rem] leading-relaxed text-neutral-700">
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
    <div className="border-t border-neutral-900/15 pt-2.5">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{k}</dt>
      <dd className="mt-1.5 font-display text-[1.35rem] font-semibold tabular-nums tracking-[-0.02em] text-neutral-950">
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
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
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
