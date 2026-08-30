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
 * WHY THE CHAPTER GRID IS A CONTAINER QUERY AND NOT A BREAKPOINT.
 *
 * This document is laid out twice by the same CSS: once in a browser window and
 * once inside an 11in × 8.5in page box. A `lg:` utility resolves against the
 * VIEWPORT, and print.tsx carries a comment recording what that cost — an
 * 11in-wide sheet was observed laying out under the same breakpoint the 8.5in
 * one did, so the cover's two-column composition never fired on paper and had
 * to be spelled out again in print CSS. That is how this document ended up
 * designed twice.
 *
 * A container query resolves against the element's own inline size, which on
 * paper is the page box less the sheet inset — about 941px — and in a browser
 * is whatever the window gives it. One rule, one composition, both media. That
 * is the whole reason ~380 lines of print overrides could be deleted.
 *
 * 52rem (832px) is comfortably under the 941px a landscape sheet offers and
 * comfortably over a tablet in portrait, which is where the rail stops being
 * readable and the head should stack above the body.
 */
const RAIL = "@[52rem]:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] @[52rem]:gap-x-12 @[52rem]:items-start";

/**
 * One chapter of the document, composed for a LANDSCAPE sheet.
 *
 * The chapter mark, the title and the lede sit in a narrow rail and the content
 * takes the rest of the width. This was previously a print-only rearrangement:
 * on screen the furniture stacked above the content and cost two inches of
 * height, and print.tsx rebuilt it into a rail with a grid the component knew
 * nothing about. Now the rail IS the chapter, on both media, and the head and
 * body attributes below are real grid children rather than hooks for a
 * stylesheet to find.
 *
 * A chapter is a SNAP TARGET: on a wide screen the deck settles it under the
 * nav so a rep advancing with an arrow key lands on a composed screen rather
 * than halfway between two. `scroll-margin-top` is what keeps the heading clear
 * of the sticky chrome — without it a jump link parks the title behind the nav.
 *
 * `min-h` rather than a fixed height, because the money chapter is genuinely
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
  /**
   * Give the content the whole width and put the head above it.
   *
   * For a chapter whose body is one wide DRAWING — a chart that wants ten
   * inches more than it wants a title beside it. Everything else takes the
   * rail, which is the default because most chapters are an argument with a
   * figure next to it.
   */
  full = false,
  rail,
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
  full?: boolean;
  /**
   * What else belongs in the LEFT COLUMN, under the lede.
   *
   * Added after the first printed proof of the rebuild, which showed the thing
   * the old print stylesheet had also been fighting: a rail carrying four lines
   * of title and then five inches of nothing, beside a body that had overflowed
   * onto a second sheet. Both problems are the same problem, and the fix is to
   * let a chapter put its quiet content — a disclosure, a caveat, a list of
   * alternatives — in the space that was already there.
   *
   * For prose and small print. A figure or a table belongs in the body: the
   * rail is 17rem, and a table set in it wraps every row.
   */
  rail?: React.ReactNode;
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
        "@container relative scroll-mt-[var(--proposal-chrome-h)] overflow-hidden px-6 sm:px-10",
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
      <div
        data-chapter-inner
        className={cn("relative mx-auto grid w-full max-w-6xl gap-y-8", !full && RAIL)}
      >
        <div data-chapter-head>
          <ChapterMark index={index} total={total} eyebrow={eyebrow} dark={dark} />
          <h2
            className={cn(
              "mt-5 font-display font-semibold leading-[1.02] tracking-[-0.022em] text-balance",
              // Smaller in the rail than it was stacked: a 17rem column holds
              // about four words a line, and the old clamp put a three-line
              // heading in it.
              full
                ? "text-[clamp(2.1rem,4.6vw,3.4rem)]"
                : "text-[clamp(2rem,3.4vw,2.9rem)]",
              dark ? "text-white" : "text-neutral-950",
            )}
          >
            {title}
          </h2>
          {lede && (
            <p
              className={cn(
                "mt-4 max-w-[46ch] leading-relaxed",
                full ? "text-lg" : "text-[0.98rem]",
                dark ? "text-neutral-300" : "text-neutral-600",
              )}
            >
              {lede}
            </p>
          )}
          {rail && <div className="mt-8 hidden @[52rem]:block">{rail}</div>}
        </div>
        <div data-chapter-body className={cn(full && "mt-2")}>
          {children}
          {/* Narrow enough that there is no rail to put it in: the same content
              follows the body instead of disappearing. */}
          {rail && <div className="mt-10 @[52rem]:hidden">{rail}</div>}
        </div>
      </div>
    </section>
  );
}

/* ── plates ────────────────────────────────────────────────────────────── */

/**
 * A chapter whose PICTURE is the page.
 *
 * The cover's grammar, extended: something runs the full bleed of the sheet —
 * a photograph, this customer's own roof, a chart — the type sits on it in a
 * half-transparent white card, and the figures run along the foot.
 *
 * It exists because the document alternates. Chapters that own a visual are
 * plates and chapters that own numbers are paper, and the alternation is what
 * stops two tables ever sitting next to each other. A run of label→value rows
 * is what this document used to be from end to end.
 *
 * THE BACKGROUND IS A PROP, not a URL. Two of the three plates are not
 * photographs at all — one is the array drawn on satellite imagery by a client
 * component that owns its own zoom, one is an SVG — and a component that took
 * a src could render neither.
 */
export function Plate({
  id,
  index,
  total,
  eyebrow,
  title,
  lede,
  background,
  card,
  figures,
  caption,
  /**
   * How hard to darken the picture.
   *
   * `full` is the gradient a photograph needs to carry white type top and
   * bottom. `soft` is for a background that is already dark and mostly empty —
   * a chart on near-black — where the same wash would flatten the drawing it
   * exists to make readable.
   */
  veil = "full",
  children,
}: {
  id: string;
  index: number;
  total: number;
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** Rendered edge to edge behind everything. Absolutely positioned by us. */
  background: React.ReactNode;
  /** The glass card, top right. */
  card?: React.ReactNode;
  /** Three or four figures along the foot. See FigureRow. */
  figures?: React.ReactNode;
  /** One line under the figures — provenance, not argument. */
  caption?: React.ReactNode;
  veil?: "full" | "soft";
  children?: React.ReactNode;
}) {
  return (
    <section
      data-section={id}
      data-chapter
      data-reveal
      data-dark-ground
      data-plate
      className={cn(
        "@container relative flex scroll-mt-[var(--proposal-chrome-h)] flex-col overflow-hidden",
        "min-h-[calc(100svh-var(--proposal-chrome-h))] bg-neutral-950 text-white",
        "px-6 py-14 sm:px-10 sm:py-16",
        "print:min-h-0 print:break-before-page",
        "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
      )}
    >
      <div aria-hidden className="absolute inset-0">
        {background}
      </div>
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
          veil === "full"
            ? "bg-[linear-gradient(180deg,rgba(8,10,12,0.78)_0%,rgba(8,10,12,0.22)_44%,rgba(8,10,12,0.92)_100%)]"
            : "bg-[linear-gradient(180deg,rgba(8,10,12,0.72)_0%,rgba(8,10,12,0.35)_50%,rgba(8,10,12,0.78)_100%)]",
        )}
      />

      {/* ── the head, and the card beside it ───────────────────────────── */}
      <div className="relative mx-auto grid w-full max-w-6xl gap-y-8 @[52rem]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @[52rem]:gap-x-10">
        <div data-chapter-head>
          <ChapterMark index={index} total={total} eyebrow={eyebrow} dark />
          <h2 className="mt-5 font-display text-[clamp(2.1rem,4.2vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.025em] text-balance text-white">
            {title}
          </h2>
          {lede && (
            <p className="mt-4 max-w-[42ch] leading-relaxed text-neutral-200">{lede}</p>
          )}
        </div>
        {card && <div className="@[52rem]:justify-self-end @[52rem]:w-full">{card}</div>}
      </div>

      {children && (
        <div className="relative mx-auto mt-8 w-full max-w-6xl">{children}</div>
      )}

      {/* ── the figures, along the foot ────────────────────────────────── */}
      {(figures || caption) && (
        <div className="relative mx-auto mt-auto w-full max-w-6xl pt-10">
          {figures}
          {caption && (
            <p className="mt-6 max-w-[74ch] text-[11px] leading-relaxed text-neutral-400 @[52rem]:max-w-[58%]">
              {caption}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The half-transparent white panel the type sits on.
 *
 * ONE component, shared by the cover and every plate, which is the point of
 * extracting it: the cover is the sheet nobody is allowed to redesign, and the
 * cheapest way to keep eight chapters looking like they belong to it is to make
 * them literally the same object.
 *
 * `data-glass-card` is what print.tsx dials the translucency up on. Chrome does
 * not render backdrop-filter when printing, so a 75%-white panel prints as flat
 * 75% white over an undiffused photograph and the type lands on roof shingles.
 */
export function GlassCard({
  className,
  children,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      data-glass-card
      className={cn(
        "rounded-2xl bg-white/75 px-6 py-7 text-neutral-900 backdrop-blur-xl sm:px-8 sm:py-9",
        "ring-1 ring-white/55 shadow-[0_28px_70px_-28px_rgba(2,6,23,0.65)]",
        "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Three or four figures across the foot of a plate.
 *
 * Replaces four near-identical stat grids that were spelled differently in
 * every chapter that had one. A figure with no value is DROPPED by the caller
 * rather than rendered as an em dash: this row is the largest type on the
 * sheet after the title, and a blank slot in it reads as a document that did
 * not finish loading.
 */
export function FigureRow({ items }: { items: { k: string; v: React.ReactNode; note?: string; accent?: boolean }[] }) {
  const shown = items.filter((i) => i.v != null && i.v !== "");
  if (shown.length === 0) return null;
  return (
    <dl
      className={cn(
        "grid gap-x-8 gap-y-6",
        shown.length >= 4 ? "grid-cols-2 @[40rem]:grid-cols-4" : "grid-cols-1 @[40rem]:grid-cols-3",
      )}
    >
      {shown.map((i, idx) => (
        <div key={i.k} data-stagger style={{ ["--i" as string]: idx } as React.CSSProperties}>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
            {i.k}
          </dt>
          <dd
            className={cn(
              "mt-1.5 font-display text-[clamp(1.7rem,3vw,2.4rem)] font-semibold leading-none tabular-nums tracking-[-0.025em]",
              i.accent ? "text-[var(--proposal-accent)]" : "text-white",
            )}
          >
            {i.v}
          </dd>
          {i.note && <p className="mt-1.5 text-sm text-neutral-400">{i.note}</p>}
        </div>
      ))}
    </dl>
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
          // shrink-0 and nowrap: in a 17rem rail a long eyebrow ("What we are
          // installing") pushed the count onto a second line and broke it in
          // half — "02 /" over "06".
          "shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums tracking-[0.16em]",
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

/**
 * A quiet label→value list. Rows with no value never render.
 *
 * `dense` is for a sheet that is carrying a drawn figure as well — the payment
 * chapter runs a display-size number, a list of terms and the battery ladder on
 * one page, and eight pixels a row is the difference between that composing and
 * spilling onto a sheet of its own.
 */
export function SpecList({
  items,
  dense = false,
}: {
  items: [string, React.ReactNode][];
  dense?: boolean;
}) {
  const rows = items.filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-neutral-900/8 border-y border-neutral-900/12">
      {rows.map(([k, v], idx) => (
        <div
          key={k}
          data-stagger
          style={{ ["--i" as string]: idx } as React.CSSProperties}
          className={cn(
            "flex items-baseline justify-between gap-6",
            dense ? "py-2" : "py-3.5",
          )}
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
            /* NOT lazy — see LenderMark. An image below the fold is never
               decoded before page.pdf() writes the sheet, so a lazy product
               shot prints as an empty tile. */
            loading="eager"
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
