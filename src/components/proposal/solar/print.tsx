"use client";

import * as React from "react";

/**
 * The solar proposal, as a sheet of paper.
 *
 * WHY THIS DOCUMENT PRINTS LANDSCAPE AND THE OTHERS DO NOT.
 *
 * `globals.css` sets `@page { size: 8.5in 11in }` for every printable in the
 * app — the roofing proposal, the cash bid, the generated contracts. Those are
 * letters and agreements and they belong on a portrait page.
 *
 * This document is not a letter. It is seven chapters that were designed as
 * SCREENS: a wide title, a figure beside it, a table that wants room to the
 * right rather than room below. Fold that onto a portrait sheet and every
 * chapter lands as a band of content across the top with a third of a page of
 * empty paper under it, because the layout has run out of things to put where
 * the sheet is long and has nothing to fill where it is wide. Sixteen pages,
 * eight of them more than half empty, and four chapters sliced across a fold
 * with their headings left behind on the previous sheet.
 *
 * Landscape is the same document on paper shaped the way it was drawn. It also
 * crosses the `lg` breakpoint (11in is 1056px, the breakpoint is 1024px), which
 * is what finally lets the cover print as the two-column composition it is on
 * screen instead of a page of type followed by a page of photograph.
 *
 * A NAMED page, not a second unnamed one. `@page { … }` has no specificity and
 * no scope: two of them in a document are settled by source order alone, so an
 * override written that way is one hoisted `<style>` away from silently
 * rotating the proposal — and nothing would fail, the PDF would simply come out
 * sideways. `@page anexa-solar` plus `html { page: anexa-solar }` says which
 * box this document uses instead of racing the other rule, and the whole thing
 * is inert anywhere this component is not rendered. Only SolarProposalView
 * renders it, so the roofing proposal, the cash bid and the generated contracts
 * keep the portrait box in globals.css untouched.
 *
 * Applied to `html` rather than to `#proposal-root`: a named page change forces
 * a page break, so naming only the subtree left the document ending on a blank
 * PORTRAIT thirteenth sheet for the boxes outside it.
 *
 * `8.5in 11in` in globals is written as explicit dimensions rather than
 * `letter portrait` for a reason that applies here too: Chrome parses the
 * orientation keyword and silently throws it away, so `11in 8.5in` is the only
 * spelling of landscape a print dialog cannot re-interpret. Read it back out of
 * the CSSOM to check — never out of the source.
 *
 * `margin: 0` is inherited from the same reasoning: Chrome draws the date, the
 * tab title and the full URL INSIDE the page margin box, and a proposal going
 * to a homeowner must not have `anexahomes.com/proposal/print/…` printed along
 * its edge. With no margin box there is nowhere to draw them, and the document
 * supplies its own inset instead.
 */
export function PrintStyles() {
  return <style>{PRINT_CSS}</style>;
}

const PRINT_CSS = `
@page anexa-solar { size: 11in 8.5in; margin: 0; }

@media print {
  html { page: anexa-solar; }

  /* ── paper ──────────────────────────────────────────────────────────────
     The page's own warm ground is painted by each chapter. The document
     element behind them goes white so a short last page is paper, not a
     mis-registered wash of colour running off the sheet. */
  html, body { background: #fff !important; }

  /* ── what is hidden on paper cannot be opened ─────────────────────────
     Two <details> live in this document and they behave differently: the
     disclosure accordions in the footer drop their summary and print their
     contents as a plain list, while the FAQ keeps its question AND gains its
     answer. Chrome hides a closed <details> through ::details-content, so
     'display: block' on the element alone reveals nothing — that pseudo has to
     be told as well, which is why the FAQ used to print as five questions with
     no answers under them. */
  #proposal-root details { display: block; }
  #proposal-root details > summary { display: none; }
  #proposal-root details[data-keep-summary] > summary { display: flex; }
  #proposal-root details::details-content {
    content-visibility: visible !important;
    block-size: auto !important;
    contain-intrinsic-block-size: none !important;
  }
  #proposal-root a[href]::after { content: ""; }

  /* ── a chapter is a sheet ───────────────────────────────────────────────
     'min-height' and not 'height': chapters 4 and 5 carry a payment table and a
     twenty-five-year model and are honestly taller than one page. Clipping them
     to keep the deck tidy would hide terms somebody is being asked to sign.
     What the minimum buys is the other case — a chapter SHORTER than the sheet
     now fills it and centres in it, instead of sitting at the top with the rest
     of the page blank underneath.

     'break-inside: auto' overrides the document-wide 'avoid' in globals.css.
     A box whose minimum height is the whole page cannot avoid an internal break
     without pushing itself onto the next sheet and leaving this one empty. */
  #proposal-root [data-chapter] {
    break-before: page;
    break-inside: auto;
    min-height: 8.5in;
    justify-content: center;
  }

  /* The inset lives here rather than in the page margin, so it has to clear a
     printer's unprintable edge on its own. Backgrounds still bleed to the paper
     edge — padding is inside the box — so the dark chapters stay full-bleed.

     THE BOTTOM INSET IS A MARGIN ON THE CONTENT, NOT PADDING ON THE SECTION,
     and the difference is a blank page. A chapter whose content runs to within
     half an inch of the fold cannot fit its own bottom padding, and padding is
     not allowed to be dropped — so Chrome opens another sheet to put it on and
     the reader turns over to a page with nothing but background on it. A margin
     at a fragmentation break is truncated instead, which is the behaviour this
     wants: the last line sits closer to the edge on the one page that is
     genuinely full, and no empty sheet is printed. */
  #proposal-root [data-section]:not([data-section="cover"]) {
    padding: 0.5in 0.6in 0;
  }
  #proposal-root [data-chapter-inner] { margin-bottom: 0.45in; }

  /* ── the rail ───────────────────────────────────────────────────────────
     The chapter mark, the title and the lede move to a column of their own and
     the content takes the remaining six and a half inches. This is the single
     move that makes the landscape sheet work: on screen the title block sits
     ABOVE the content and costs two inches of height that a wide sheet cannot
     spare, and the width it frees is width the tables and figures were designed
     for. 'align-items: start' so a short rail does not stretch its rule. */
  #proposal-root [data-chapter-inner] {
    max-width: none;
    width: 100%;
    display: grid;
    grid-template-columns: 2.85in minmax(0, 1fr);
    column-gap: 0.6in;
    align-items: start;
  }
  #proposal-root [data-chapter-head] { grid-column: 1; }
  #proposal-root [data-chapter-body] { grid-column: 2; margin-top: 0; }
  #proposal-root [data-chapter-body] > :first-child { margin-top: 0; }

  /* Two chapters would rather have the whole width than a title beside it: the
     twenty-five-year maths, whose two futures and chart are read across, and
     the plan, whose six steps go two columns wide. They keep the screen
     arrangement, with the title above the content. */
  #proposal-root [data-print-layout="stack"] [data-chapter-inner] { display: block; }
  #proposal-root [data-print-layout="stack"] [data-chapter-body] { margin-top: 1.6rem; }

  /* ── type, at the size the rail can hold ────────────────────────────────
     The screen sizes are set in viewport units, and the print viewport is the
     page box — 1056px wide — so a chapter title resolves to 48px. In a 2.85in
     column that is four words a line and a heading three lines deep. */
  #proposal-root [data-chapter-head] h2 { font-size: 1.95rem; line-height: 1.06; }
  #proposal-root [data-chapter-head] p { font-size: 0.95rem; line-height: 1.55; margin-top: 0.9rem; }
  #proposal-root [data-print-layout="stack"] [data-chapter-head] h2 { font-size: 2.1rem; }

  /* ── the cover ──────────────────────────────────────────────────────────
     One sheet exactly: type on the left, the photograph as a full-height plate
     on the right.

     The two columns are spelled out HERE rather than left to the 'lg' variant
     the screen uses, because a print layout does not resolve its media queries
     against the page box: an 11in-wide sheet still lays out under the same
     breakpoint the 8.5in one did, so 'lg:grid-cols-*' never fires and the
     photograph fell into a second row — off the bottom of a fixed-height
     section and straight over the chapter behind it. Anything a printed page
     needs from a breakpoint has to be written out. */
  #proposal-root [data-section="cover"] {
    min-height: 0;
    height: 8.5in;
    padding: 0;
    grid-template-columns: 7fr 5fr;
  }
  #proposal-root [data-section="cover"] > div { min-height: 0; }
  #proposal-root [data-section="cover"] > div:first-child { padding: 0.5in 0.45in 0.5in 0.7in; }
  #proposal-root [data-section="cover"] h1 { font-size: 3.4rem; line-height: 0.96; }
  #proposal-root [data-section="cover"] img { height: 100%; }

  /* ── seams ──────────────────────────────────────────────────────────────
     Where a chapter is genuinely longer than a sheet, it breaks at a place
     somebody chose. Left to Chrome the fold lands wherever the content happens
     to run out — mid-table, or one line into a heading whose page-mates are
     overleaf. Each of these marks a block that starts a page of its own, and
     stops being a continuation while it does: it drops the screen's rule and
     spacing and takes the top inset back, because nothing else on a fresh sheet
     will supply one. */
  #proposal-root [data-print-break] {
    break-before: page;
    margin-top: 0 !important;
    padding-top: 0.42in;
    border-top: 0 !important;
  }
  #proposal-root [data-print-break] > :first-child { margin-top: 0 !important; }
  #proposal-root [data-print-keep] { break-inside: avoid; }

  /* A gap that reads as a pause on a scrolling screen reads as wasted paper on
     a sheet. These are the joints where a chapter's second thought begins. */
  #proposal-root [data-print-tight] {
    margin-top: 1rem !important;
    padding-top: 0.9rem !important;
  }

  /* ── chapter 3, the design ──────────────────────────────────────────────
     'display: contents' dissolves the body wrapper so the specification list
     and the roof drawing become items of the chapter's own grid. The specs
     read down the rail under the title and the drawing takes the six and a
     half inches beside them — one composed sheet, where portrait gave four:
     a page of specs, two pages of a roof photograph stretched to fill them,
     and a page carrying three equipment cards.

     The hardware and the explainer follow on a sheet of their own. */
  #proposal-root [data-section="system"] [data-chapter-body] { display: contents; }
  #proposal-root [data-section="system"] [data-chapter-body] > * { grid-column: 1 / -1; }
  #proposal-root [data-section="system"] [data-chapter-head] { grid-row: 1; }
  #proposal-root [data-section="system"] [data-print-slot="specs"] {
    grid-column: 1;
    grid-row: 2;
    display: block;
    margin-top: 1.4rem;
  }
  #proposal-root [data-section="system"] [data-print-slot="specs"] > * { margin-bottom: 0.85rem; }
  #proposal-root [data-section="system"] [data-print-slot="plate"] {
    grid-column: 2;
    grid-row: 1 / span 2;
    margin-top: 0;
    align-self: start;
  }
  /* Second sheet: the three components read down a column of their own with
     the explainer beside them, rather than three cards adrift on one page and
     five paragraphs adrift on the next. */
  #proposal-root [data-print-slot="hardware"] {
    display: grid;
    grid-template-columns: 3in minmax(0, 1fr);
    column-gap: 0.6in;
    align-items: start;
  }
  #proposal-root [data-print-slot="hardware"] > * { grid-column: 1; }
  #proposal-root [data-print-slot="hardware"] > div:not([data-print-slot]) {
    grid-template-columns: minmax(0, 1fr);
  }
  #proposal-root [data-print-slot="how"] {
    grid-column: 2;
    grid-row: 1 / span 4;
    margin-top: 0;
    border-top: 0;
    padding-top: 0;
  }
  /* A catalogue that names no hardware leaves the explainer alone on the sheet,
     and half a page of text with an empty column beside it is not a spread. */
  #proposal-root [data-print-slot="hardware"]:not(:has(> p)) { display: block; }

  /* No drawing means no right-hand column to put one in, so the specification
     takes the sheet rather than reading down a two-and-a-half-inch rail with
     six inches of nothing next to it. This is the shape of a deal whose layout
     has not been drawn yet. */
  #proposal-root [data-section="system"]:not(:has([data-print-slot="plate"]))
    [data-print-slot="specs"] {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: 3rem;
  }

  /* ── chapter 4, the money ───────────────────────────────────────────────
     The menu and the price table sit beside the title; the battery credit is
     the chapter's second sheet and takes the whole width of it, so a
     continuation page is not a column of content with two and a half inches of
     empty margin down its left-hand side. */
  #proposal-root [data-section="cost"] [data-chapter-body] { display: contents; }
  #proposal-root [data-section="cost"] [data-chapter-body] > * { grid-column: 2; }
  #proposal-root [data-section="cost"] [data-print-slot="battery"] { grid-column: 1 / -1; }
  /* The credit FOLLOWS the table rather than claiming a sheet of its own. It
     used to force one, which on a deal whose table crosses a fold left the
     table's last row alone on a page of its own with the credit overleaf —
     three sheets to say what fits on two. It keeps itself whole instead, and
     carries its own top inset so it stands clear whether it lands under the
     table or at the top of the next sheet. */
  #proposal-root [data-print-slot="battery"] {
    break-inside: avoid;
    padding-top: 0.32in;
  }
  /* No battery programme means BatteryCredit renders nothing, and an empty box
     must not leave a gap behind it. */
  #proposal-root [data-print-slot="battery"]:empty { padding-top: 0; }

  #proposal-root [data-section="cost"] dl > div { padding-top: 0.7rem; padding-bottom: 0.7rem; }
  /* The price table may cross a fold. It carries 'break-inside-avoid' for the
     screen, and on a big enough deal that turns into two thirds of a dark sheet
     left empty so the whole table can start on the next one. Rows still avoid
     breaking (globals.css), so the fold lands between two of them — which is
     what a long table on paper is supposed to do. The last row is held back
     from being the one that crosses: the total of a price table, alone at the
     top of a sheet, is the one row that must not be read on its own. */
  #proposal-root [data-section="cost"] dl { break-inside: auto; }
  #proposal-root [data-section="cost"] dl > div:last-child { break-before: avoid; }

  /* ── chapter 5, the maths ───────────────────────────────────────────────
     The two futures are a COMPARISON and have to be read side by side; stacked
     they are two claims a page apart. The chart is capped by width rather than
     height because its height comes from a viewBox — squeeze the box and the
     drawing scales, clip the box and the last year falls off the paper. */
  #proposal-root [data-print-slot="compare"] > div { grid-template-columns: 1fr 1fr; }
  #proposal-root [data-print-slot="compare"] > div > * { break-inside: avoid; }
  #proposal-root [data-print-slot="chart"] {
    max-width: 6in;
    margin-inline: auto;
  }
  #proposal-root [data-print-slot="chart"] figure { margin-top: 0; }

  /* The lifetime figure shares the chart's sheet, so it is set at the size a
     sheet can hold rather than the size a screen can. */
  #proposal-root [data-lifetime] { padding: 1.3rem 1.7rem; }
  #proposal-root [data-lifetime] > div { gap: 1rem 2rem; }
  #proposal-root [data-lifetime] > p { margin-top: 0.9rem; }
  #proposal-root [data-lifetime-figure] { font-size: 3rem; margin-top: 0.5rem; }

  /* The programme and the year-by-year table are one sheet, which needs the
     table set at the tighter rhythm. */
  #proposal-root [data-print-slot="programme"] { padding: 1.2rem 1.4rem; }
  /* Everything after the programme shares its sheet, and the sheet is exactly
     as tall as it is: at the screen's rhythm this ran seven pixels past the
     fold and printed an eighth page carrying nothing but the tail of a
     footnote. */
  #proposal-root [data-print-slot="programme"] ~ * { margin-top: 0.75rem; }
  #proposal-root [data-section="savings"] table th,
  #proposal-root [data-section="savings"] table td {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }

  /* ── chapter 6, the plan ────────────────────────────────────────────────
     Six steps down one column is nine inches of paper. Two columns is one
     sheet, with the impact figures still under them. */
  #proposal-root [data-print-slot="steps"] {
    column-count: 3;
    column-gap: 0.4in;
  }
  #proposal-root [data-print-slot="steps"] > li {
    break-inside: avoid;
    padding-top: 0.15rem;
    padding-bottom: 0.15rem;
  }
  /* The numbered disc is sized for a thumb on a tablet. On paper it is only a
     number, and three rows of it were an inch of height the sheet needed. The
     'who does it' chips are sized the same way: tap targets on a screen, a
     caption on paper. */
  #proposal-root [data-print-slot="steps"] > li > span {
    width: 2.25rem;
    height: 2.25rem;
    font-size: 1rem;
  }
  #proposal-root [data-print-slot="steps"] ul { margin-top: 0.3rem; }
  #proposal-root [data-print-slot="steps"] ul > li {
    padding-top: 0.1rem;
    padding-bottom: 0.1rem;
  }
  #proposal-root [data-print-slot="steps"] + p { margin-top: 0.4rem; }

  /* The four equivalences read BESIDE the sentence that introduces them rather
     than as a band under it, and the home-value note runs full width below
     both. Stacked the way the screen has them this chapter ran past the fold
     and printed a sheet carrying one paragraph. */
  #proposal-root [data-section="timeline"] [data-print-tight] {
    display: grid;
    grid-template-columns: 4.6in minmax(0, 1fr);
    column-gap: 0.5in;
    align-items: start;
    margin-top: 0.5rem !important;
    padding-top: 0.5rem !important;
  }
  #proposal-root [data-section="timeline"] [data-print-tight] > h3,
  #proposal-root [data-section="timeline"] [data-print-tight] > p { grid-column: 1; }
  #proposal-root [data-print-slot="impact"] {
    grid-column: 2;
    grid-row: 1 / span 2;
    margin-top: 0;
  }
  #proposal-root [data-print-slot="uplift"] {
    grid-column: 1 / -1;
    break-inside: avoid;
    margin-top: 0.4rem;
    padding-top: 0.4rem;
  }
  /* Set as the aside it is: a note about resale beside a percentage, at the
     size the rest of the small print on this document uses. */
  #proposal-root [data-print-slot="uplift"] p { max-width: none; }
  #proposal-root [data-print-slot="uplift"] > div > p:first-child { font-size: 1.05rem; }
  #proposal-root [data-print-slot="uplift"] > div > p + p { font-size: 0.875rem; line-height: 1.5; }

  /* ── chapter 7, the close ───────────────────────────────────────────────
     The signature block is the tallest thing on this sheet and the questions
     have to fit under it, so the answers are set at the tighter of the two
     rhythms this document uses. */
  #proposal-root [data-section="accept"] details { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  #proposal-root [data-section="accept"] details p { margin-top: 0.35rem; }

  /* ── the closing sheet ──────────────────────────────────────────────────
     Who did the work and what was assumed. It was the runt of the document —
     a page and a half of column, then a sixteenth page carrying one line of
     reference number. One sheet now, the small print in two columns, and the
     assumptions that were hidden inside a closed <details> are on it. */
  #proposal-root [data-colophon] {
    break-before: page;
    min-height: 8.5in;
    padding: 0.5in 0.6in 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  #proposal-root [data-colophon] > div { max-width: none; margin-bottom: 0.45in; }
  #proposal-root [data-colophon] [data-colophon-legal] { column-count: 2; column-gap: 0.6in; }
  #proposal-root [data-colophon] [data-colophon-legal] > * { break-inside: avoid; }
}
`;
