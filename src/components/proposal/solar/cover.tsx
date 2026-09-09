"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import type { CoverPitch } from "@/lib/solar-proposal-pitch";
import { usd, kwh, pctWhole } from "../format";
import { GlassCard } from "./primitives";

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
  underChrome = false,
}: {
  s: SolarProposalSnapshot;
  name: string;
  pitch: CoverPitch;
  photoUrl?: string;
  /**
   * Run the photograph up BEHIND the sticky nav instead of starting below it.
   *
   * The bar is frosted glass over this section (see `glassOverHero` on
   * ProposalChrome) and glass with nothing behind it is just a white stripe —
   * the two settings are one decision made in two files. The section takes back
   * the height it borrows and pads its content past the bar, so the card still
   * centres in the part of the cover anybody can see.
   *
   * Off when a banner is stacked between the two, which would be the thing the
   * cover slid under.
   */
  underChrome?: boolean;
}) {
  return (
    <section
      data-section="cover"
      data-chapter
      className={cn(
        "relative flex scroll-mt-[var(--proposal-chrome-h)] items-center overflow-hidden bg-neutral-950",
        "px-5 pb-14 sm:px-10 sm:pb-16 lg:px-16",
        "print:min-h-[9.2in]",
        underChrome
          ? [
              "-mt-[var(--proposal-nav-h)] print:mt-0",
              "min-h-[calc(100svh-var(--proposal-chrome-h)+var(--proposal-nav-h))]",
              "pt-[calc(var(--proposal-nav-h)+3.5rem)] sm:pt-[calc(var(--proposal-nav-h)+4rem)]",
            ]
          : ["min-h-[calc(100svh-var(--proposal-chrome-h))]", "pt-14 sm:pt-16"],
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

      {/* ── the card ─────────────────────────────────────────────────────
          The SAME component every plate in the document uses. The cover is the
          sheet nobody is allowed to redesign, and the cheapest way to keep the
          eight chapters behind it looking like they belong to it is to make
          them literally the same object. Nothing about how this renders
          changed when it was extracted — see GlassCard. */}
      <GlassCard data-cover-card className="relative w-full max-w-[30rem]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--proposal-accent)]">
          Your solar proposal
        </p>

        <h1 className="mt-4 font-display text-[clamp(2.1rem,4vw,3rem)] font-semibold leading-[0.97] tracking-[-0.03em] text-neutral-950 text-balance">
          Own your power
          {name ? `, ${name}` : ""}.
        </h1>

        {/* The address used to sit in the middle of this sentence. It is in the
            block below now, written properly and labelled, and a cover that
            states the same address twice in two different punctuations is the
            thing this change was made to stop. */}
        <p className="mt-4 text-[0.95rem] leading-relaxed text-neutral-700">
          {article(s.system.sizeKwDc)}{" "}
          <strong className="font-semibold text-neutral-900">
            {s.system.sizeKwDc.toFixed(2)} kW
          </strong>{" "}
          system, sized to cover{" "}
          <strong className="font-semibold text-neutral-900">{pctWhole(s.system.offsetPct)}</strong>{" "}
          of what your home uses.
        </p>

        <div className="mt-7">
          <Pitch pitch={pitch} s={s} />
        </div>

        <div className="mt-7 h-px bg-neutral-900/15" />

        {/* ── who it is for, and who wrote it ────────────────────────────
            The block a proposal is expected to open with. Before this the
            cover named the household ONCE, in the greeting, by first name —
            warm, and useless as a document: nothing on the sheet said whose
            house it was, how to reach them, or which of the three quotes on a
            kitchen table this one was. The greeting keeps the first name; the
            record goes here. */}
        <div data-cover-parties className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
          <Party
            k="Prepared for"
            lead={s.customer.name}
            lines={[addressLine(s.customer.address), s.customer.email, tel(s.customer.phone)]}
          />
          <Party
            k="Prepared by"
            lead={s.company.name}
            /* The rep the household actually deals with, and their own line —
               falling back to the company's only where there is no rep on the
               deal. A main office number under a consultant's name sends a
               homeowner to a switchboard. */
            lines={[
              s.representative?.name,
              tel(s.representative?.phone ?? s.company.phone),
              s.representative?.email ?? s.company.email,
            ]}
          />
        </div>

        <div className="mt-5 h-px bg-neutral-900/15" />

        <dl data-cover-meta className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
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
        </dl>
      </GlassCard>
    </section>
  );
}

/**
 * One side of the cover's address block.
 *
 * `lead` is the name and is always drawn; `lines` are dropped where they are
 * empty rather than rendered as an em dash or a blank row. A household with no
 * email on file gets a three-line block, not a four-line one with a hole in it —
 * and the two columns are top-aligned so an uneven pair still shares a baseline
 * where it matters, at the name.
 */
function Party({
  k,
  lead,
  lines,
}: {
  k: string;
  lead: string;
  lines: (string | null | undefined)[];
}) {
  const rest = lines.map((l) => l?.trim()).filter(Boolean) as string[];
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{k}</p>
      {/* `break-words`, not `truncate`: an email is the one line on this card
          that must be readable in full, and a 28-character address on a phone
          is allowed to take two lines rather than end in an ellipsis. */}
      <p className="mt-1.5 break-words text-[0.85rem] font-semibold leading-snug text-neutral-950">
        {lead || "—"}
      </p>
      {rest.map((line) => (
        <p key={line} className="mt-1 break-words text-[0.78rem] leading-snug text-neutral-700">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * A US number as it is SPOKEN — "(361) 555-0134".
 *
 * Phone numbers are stored exactly as they were typed, which on a lead imported
 * from a list means ten bare digits. That is fine in a table and wrong on the
 * cover of a document. Anything that is not a plain 10- (or 1+10-) digit number
 * — an extension, an international number, something half-typed — is passed
 * through untouched rather than mangled into a shape it does not have.
 */
export function tel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length !== 10 || /[a-z]/i.test(raw)) return raw;
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
}

/**
 * The frozen address string, with the comma the old generator put in front of
 * the ZIP taken back out: "Victoria, TX, 77901" → "Victoria, TX 77901".
 *
 * Display-only, and deliberately anchored to a trailing ZIP so it cannot touch
 * anything else in the line. Documents generated from now on never need it —
 * see `formatMailingAddress` — but the ones already in the database are frozen
 * and are not going to be rewritten for a comma.
 */
export function addressLine(address: string | null | undefined): string | null {
  if (!address) return null;
  return address.replace(/,\s*(\d{5}(?:-\d{4})?)\s*$/, " $1");
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
