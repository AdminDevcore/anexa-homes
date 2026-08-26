"use client";

import * as React from "react";
import { ExternalLink, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The document's shared furniture.
 *
 * Consolidated on purpose. The chapters used to carry five near-identical stat
 * components — `CostStat`, `ArrayStat`, `CoverStat`, `FactCard` and `Callout` —
 * which differed only in ground colour and type size. Five spellings of one
 * idea is how a document stops looking designed and starts looking assembled,
 * so there are now two: `Stat` for a figure in a grid, and `Spec` for a quiet
 * label-and-value row.
 */

/* ── chapters ──────────────────────────────────────────────────────────── */

export type ChapterTone = "paper" | "dark";

/**
 * One chapter of the document.
 *
 * A chapter is a SNAP TARGET: on a wide screen the deck settles it under the
 * nav so a rep advancing with an arrow key lands on a composed screen rather
 * than halfway between two. `scroll-margin-top` is what keeps the heading clear
 * of the sticky chrome — without it a jump link parks the title behind the nav.
 *
 * `min-h` rather than a fixed height, because chapters 4 and 5 are genuinely
 * taller than a viewport and clipping a payment table to make the deck tidy
 * would hide the terms somebody is being asked to sign.
 */
export function Chapter({
  id,
  index,
  total,
  eyebrow,
  title,
  lede,
  tone = "paper",
  wide = false,
  children,
}: {
  id: string;
  /** 1-based. The numbering is real — this is a document read in order. */
  index: number;
  total: number;
  eyebrow: string;
  title: string;
  lede?: React.ReactNode;
  tone?: ChapterTone;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <section
      data-section={id}
      data-chapter
      data-reveal
      // Marks a ground that carries light text, so the print test can find
      // every one of them without parsing a computed colour. Tailwind emits
      // oklch(), and a test that greps for rgb() passes by finding nothing.
      data-dark-ground={dark ? "" : undefined}
      className={cn(
        "relative scroll-mt-[var(--proposal-chrome-h)] overflow-hidden px-6 sm:px-10",
        "flex min-h-[calc(100svh-var(--proposal-chrome-h))] flex-col justify-center",
        "py-20 sm:py-24",
        "print:min-h-0 print:break-before-page print:py-8",
        // Chrome ships "Background graphics" OFF, so a dark chapter that does
        // not opt out prints white text on white paper. See proposal-print.
        dark
          ? "bg-neutral-950 text-neutral-100 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
          : "bg-transparent text-neutral-900",
      )}
    >
      <div className={cn("relative mx-auto w-full", wide ? "max-w-5xl" : "max-w-3xl")}>
        <ChapterMark index={index} total={total} eyebrow={eyebrow} dark={dark} />
        <h2
          className={cn(
            "mt-5 font-display text-[clamp(2.1rem,4.6vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.022em] text-balance",
            dark ? "text-white" : "text-neutral-950",
          )}
        >
          {title}
        </h2>
        {lede && (
          <p
            className={cn(
              "mt-5 max-w-[46ch] text-lg leading-relaxed",
              dark ? "text-neutral-300" : "text-neutral-600",
            )}
          >
            {lede}
          </p>
        )}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/**
 * The chapter number, the section name, and a rule running to the margin.
 *
 * The numbering encodes something true — this is a seven-part argument read in
 * order, and a homeowner who puts it down at chapter 3 can see how much is
 * left. It is not decoration borrowed from a template.
 */
function ChapterMark({
  index,
  total,
  eyebrow,
  dark,
}: {
  index: number;
  total: number;
  eyebrow: string;
  dark: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--proposal-accent)]">
        {eyebrow}
      </span>
      <span
        aria-hidden
        className={cn("h-px flex-1", dark ? "bg-white/15" : "bg-neutral-900/12")}
      />
      <span
        className={cn(
          "text-[11px] font-medium tabular-nums tracking-[0.16em]",
          dark ? "text-neutral-500" : "text-neutral-400",
        )}
      >
        {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
    </div>
  );
}

/* ── figures ───────────────────────────────────────────────────────────── */

/**
 * A figure in a grid.
 *
 * One component, four grounds. `accent` is spent on a figure that is genuinely
 * good news and withheld everywhere else — most of all from a negative lifetime
 * result, which must never wear the colour of a win.
 */
export function Stat({
  k,
  v,
  note,
  tone = "paper",
  size = "md",
  accent = false,
  i,
}: {
  k: string;
  v: React.ReactNode;
  note?: string;
  tone?: "paper" | "card" | "dark";
  size?: "sm" | "md" | "lg";
  accent?: boolean;
  i?: number;
}) {
  const dark = tone === "dark";
  return (
    <div
      data-stagger={i != null ? "" : undefined}
      style={i != null ? ({ ["--i" as string]: i } as React.CSSProperties) : undefined}
      className={cn(
        tone === "card" && "rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60",
        tone === "dark" && "bg-neutral-950 px-5 py-5",
        tone === "paper" && "border-t border-neutral-900/12 pt-4",
      )}
    >
      <dt
        className={cn(
          "text-[11px] font-semibold uppercase tracking-[0.16em]",
          dark ? "text-neutral-500" : "text-neutral-400",
        )}
      >
        {k}
      </dt>
      <dd
        className={cn(
          "mt-2 font-display font-semibold tabular-nums tracking-[-0.02em]",
          size === "sm" && "text-xl",
          size === "md" && "text-3xl",
          size === "lg" && "text-[clamp(2.4rem,5vw,3.4rem)] leading-none",
          accent ? "text-[var(--proposal-accent)]" : dark ? "text-white" : "text-neutral-950",
        )}
      >
        {v}
      </dd>
      {note && (
        <p className={cn("mt-1.5 text-sm", dark ? "text-neutral-400" : "text-neutral-500")}>
          {note}
        </p>
      )}
    </div>
  );
}

/** A quiet label→value list. Rows with no value never render. */
export function SpecList({ items }: { items: [string, React.ReactNode][] }) {
  const rows = items.filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-neutral-900/8 border-y border-neutral-900/12">
      {rows.map(([k, v], idx) => (
        <div
          key={k}
          data-stagger
          style={{ ["--i" as string]: idx } as React.CSSProperties}
          className="flex items-baseline justify-between gap-6 py-3.5"
        >
          <dt className="text-sm text-neutral-500">{k}</dt>
          <dd className="text-right font-medium tabular-nums text-neutral-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A label→value row on a dark ground. The money chapter is built from these. */
export function DarkRow({
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
    <div
      className={cn("flex items-start justify-between gap-6 px-5 py-3.5", strong && "bg-white/[0.06]")}
    >
      <dt className={cn("text-neutral-300", muted && "pl-4 text-sm text-neutral-400")}>{k}</dt>
      <dd
        className={cn(
          "text-right font-medium tabular-nums text-white",
          strong && "font-display text-lg font-bold",
          muted && "text-sm text-neutral-300",
        )}
      >
        {v}
      </dd>
    </div>
  );
}

export function EquipCard({
  i,
  label,
  e,
  unit,
}: {
  i: number;
  label: string;
  e: {
    manufacturer: string | null;
    model: string;
    ratingW: number | null;
    qty: number;
    specSheetUrl?: string | null;
    photoUrl?: string | null;
  } | null;
  unit: string;
}) {
  if (!e) return null;
  const name = [e.manufacturer, e.model].filter(Boolean).join(" ");
  return (
    <div
      data-stagger
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/60"
    >
      {/*
        The hardware, pictured.

        Absent rather than framed when there is no photo: an empty tile with a
        placeholder glyph on the one page that has to look trustworthy reads as
        a document that was not finished. `object-contain` on a white tile,
        because product shots arrive at every aspect ratio and cropping a panel
        to a square cuts the panel in half.
      */}
      {e.photoUrl && (
        <span className="mb-4 flex h-28 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-neutral-900/[0.06] [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from a
              route, not the image pipeline, and rendered on the public proposal
              where next/image's optimiser is not in play. */}
          <img
            src={e.photoUrl}
            alt={name ? `${name} — ${label.toLowerCase()}` : label}
            className="size-full object-contain p-2"
            loading="lazy"
            decoding="async"
          />
        </span>
      )}
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </p>
      <p className="mt-2 font-medium leading-snug text-neutral-900">
        {name}
      </p>
      <p className="mt-2 text-sm tabular-nums text-neutral-500">
        {e.ratingW ? `${e.ratingW.toLocaleString()} ${unit}` : "—"}
        {e.qty > 0 ? ` · ${e.qty} total` : ""}
      </p>
      {/* The manufacturer's own datasheet, when the catalogue records one.
          Absent rather than dead: a "View details" that goes nowhere is worse
          than no link on the one page that has to look trustworthy. */}
      {e.specSheetUrl && (
        <a
          href={e.specSheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition hover:decoration-neutral-900 print:hidden"
        >
          View details <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}

export function Impact({
  i,
  icon: Icon,
  value,
  label,
  source,
}: {
  i: number;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  source?: { label: string; url: string };
}) {
  return (
    <div
      data-stagger
      style={{ ["--i" as string]: i } as React.CSSProperties}
      className="flex flex-col border-t border-neutral-900/12 pt-4"
    >
      <Icon className="size-4 text-neutral-400" aria-hidden />
      <div className="mt-3 font-display text-2xl font-semibold tabular-nums tracking-[-0.02em] text-neutral-950">
        {value}
      </div>
      <div className="mt-0.5 text-xs leading-tight text-neutral-500">{label}</div>
      {source && (
        <div className="mt-auto pt-2">
          <SourceLink source={source} />
        </div>
      )}
    </div>
  );
}

/**
 * Where a number came from, as a link the homeowner can actually follow.
 *
 * "153 trees" is checkable arithmetic on an EPA factor, and a figure nobody can
 * check reads as marketing however true it is. Citing it costs one line and is
 * the difference between a claim and a calculation.
 *
 * Hidden on paper: a printed page cannot be clicked, and the assumptions block
 * in the footer carries the same provenance in words.
 */
export function SourceLink({ source }: { source: { label: string; url: string } }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.label}
      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-neutral-400 underline decoration-neutral-300 underline-offset-2 transition hover:text-neutral-700 print:hidden"
    >
      source <ArrowUpRight className="size-3" />
    </a>
  );
}

export function ContactCard({
  title,
  subtitle,
  lines,
}: {
  title: string;
  subtitle?: string;
  lines: (string | null | undefined)[];
}) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <div className="border-t border-neutral-900/12 pt-4">
      {subtitle && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
          {subtitle}
        </p>
      )}
      <p className="mt-1 font-display text-lg font-semibold text-neutral-900">{title}</p>
      <ul className="mt-2 space-y-0.5 text-sm text-neutral-600">
        {shown.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
