"use client";

import * as React from "react";

/**
 * The solar proposal, as a sheet of paper.
 *
 * WHAT THIS FILE IS NO LONGER. Until 2026-08-30 it was a second design of the
 * whole document: a rail grid the chapters knew nothing about, per-section
 * overrides for `specs`, `plate`, `hardware`, `battery`, `ladder`, `compare`,
 * `chart`, `programme`, `steps`, `impact` and `uplift`, two escape hatches for
 * forcing and tightening seams, and a set of type sizes that existed only on
 * paper. About 380 lines.
 *
 * It existed because the chapters were composed as PORTRAIT SCREEN SECTIONS and
 * the sheet is landscape, so every chapter had to be taken apart and rebuilt
 * here. The document was designed twice, the two designs disagreed, and the
 * disagreement is what printed: six chapters became nine sheets, four of them
 * orphan continuations with no chapter mark, three of them a third empty.
 *
 * The chapters are now composed for a landscape sheet in the first place — see
 * the container query on `Chapter`, which resolves against the element's own
 * width and therefore fires identically in a browser and in a page box. What is
 * left here is only what is genuinely about PAPER: the page box, the background
 * opt-in Chrome needs, where a break is allowed to land, and the two blocks
 * that are evidence rather than argument.
 *
 * WHY THIS DOCUMENT PRINTS LANDSCAPE AND THE OTHERS DO NOT.
 *
 * `globals.css` sets `@page { size: 8.5in 11in }` for every printable in the
 * app — the roofing proposal, the cash bid, the generated contracts. Those are
 * letters and agreements and they belong on a portrait page. This one is a deck
 * of composed sheets, and it is drawn at the proportions of the paper it prints
 * on.
 *
 * A NAMED page, not a second unnamed one. `@page { … }` has no specificity and
 * no scope: two of them in a document are settled by source order alone, so an
 * override written that way is one hoisted `<style>` away from silently
 * rotating the proposal — and nothing would fail, the PDF would simply come out
 * sideways. `@page anexa-solar` plus `html { page: anexa-solar }` says which
 * box this document uses instead of racing the other rule, and the whole thing
 * is inert anywhere this component is not rendered.
 *
 * Applied to `html` rather than to `#proposal-root`: a named page change forces
 * a page break, so naming only the subtree left the document ending on a blank
 * PORTRAIT sheet for the boxes outside it.
 *
 * `11in 8.5in` is spelled as explicit dimensions rather than `letter landscape`
 * because Chrome parses the orientation keyword and silently throws it away.
 * Read it back out of the CSSOM to check — never out of the source.
 *
 * `margin: 0` is the same kind of decision: Chrome draws the date, the tab
 * title and the full URL INSIDE the page margin box, and a proposal going to a
 * homeowner must not have `anexahomes.com/proposal/print/…` printed along its
 * edge. With no margin box there is nowhere to draw them, and the document
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
     NOTHING IN THE DOCUMENT USES <details> ANY MORE. The questions and the
     assumptions moved to the back matter as ordinary open markup in the
     2026-08-30 rebuild, which reaches the same guarantee by removing the
     mechanism rather than by configuring it.

     These rules stay as a LANDMINE GUARD. The failure they prevent is silent:
     Chrome hides a closed <details> through ::details-content, so 'display:
     block' on the element alone reveals nothing, and the FAQ once printed as
     five questions with no answers under them. The next person to reach for an
     accordion in a document that gets printed will not know that, and six
     lines of CSS is a cheap way for them not to have to. */
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
     'min-height' and not 'height': the money chapter carries a payment table
     and is honestly taller than one page on a big enough deal. Clipping it to
     keep the deck tidy would hide terms somebody is being asked to sign. What
     the minimum buys is the other case — a chapter SHORTER than the sheet now
     fills it, instead of sitting at the top with the rest blank underneath.

     'break-inside: auto' overrides the document-wide 'avoid' in globals.css.
     A box whose minimum height is the whole page cannot avoid an internal break
     without pushing itself onto the next sheet and leaving this one empty. */
  #proposal-root [data-chapter] {
    break-before: page;
    break-inside: auto;
    min-height: 8.5in;
  }

  /* A PAPER chapter centres its composition in the sheet. A PLATE does not:
     its head is at the top and its figures are pushed to the foot by
     'margin-top: auto', and centring the column would collapse that. */
  #proposal-root [data-chapter]:not([data-plate]) { justify-content: center; }

  /* The inset lives here rather than in the page margin, so it has to clear a
     printer's unprintable edge on its own. Backgrounds still bleed to the paper
     edge — padding is inside the box — so the dark chapters and the plates stay
     full-bleed.

     THE BOTTOM INSET IS A MARGIN ON THE CONTENT, NOT PADDING ON THE SECTION,
     and the difference is a blank page. A chapter whose content runs to within
     half an inch of the fold cannot fit its own bottom padding, and padding is
     not allowed to be dropped — so Chrome opens another sheet to put it on and
     the reader turns over to a page with nothing but background on it. A margin
     at a fragmentation break is truncated instead. */
  #proposal-root [data-section]:not([data-section="cover"]) {
    padding: 0.5in 0.6in 0;
  }
  #proposal-root [data-chapter-inner] { margin-bottom: 0.45in; }

  /* ── the glass card ─────────────────────────────────────────────────────
     Chrome does not render backdrop-filter when printing, so a 75%-white panel
     prints as flat 75% white over an undiffused photograph and the type lands
     on roof shingles. 0.93 keeps the picture reading through the panel without
     the blur doing any of the work.

     On [data-glass-card] rather than on the cover alone, because the cover and
     every plate are now literally the same component and a card on a roof
     aerial has exactly the same problem the cover's did. */
  #proposal-root [data-glass-card] {
    background: rgba(255, 255, 255, 0.93);
    backdrop-filter: none;
    box-shadow: none;
  }

  /* ── the cover ──────────────────────────────────────────────────────────
     One sheet exactly: the photograph fills the whole page box and the copy
     rides on it in a card.

     The inset is spelled out HERE rather than left to the 'lg' variant the
     screen uses. This is the observation the whole rebuild came from: a print
     layout does not reliably resolve viewport media queries against the page
     box, so no 'lg:*' utility can be counted on to fire. Everything else in the
     document now uses container queries, which do. The cover is the one sheet
     nobody is allowed to redesign, so it keeps the spelled-out rules it was
     shipped with. */
  #proposal-root [data-section="cover"] {
    min-height: 0;
    height: 8.5in;
    margin-top: 0;
    padding: 0.7in;
    align-items: center;
    justify-content: flex-start;
  }
  #proposal-root [data-section="cover"] img { height: 100%; }
  #proposal-root [data-cover-card] {
    width: 5.35in;
    max-width: 5.35in;
    padding: 0.42in 0.44in;
  }
  #proposal-root [data-section="cover"] h1 { font-size: 2.6rem; line-height: 0.98; }
  /* Prepared and Reference are one line or they are two: the flex row wraps a
     whole item at a time, and 2rem of gutter is enough to push the second onto
     a line of its own on a card this wide. */
  #proposal-root [data-cover-meta] { column-gap: 1.5rem; }
  /* Prepared for · Prepared by stay TWO columns on paper. The card is 5.35in
     here whatever the window was, so the pair has ~2.1in a side — enough for an
     address and an email, and the one thing that must not happen is the block
     stacking into eight lines and pushing the card off the sheet. */
  #proposal-root [data-cover-parties] {
    grid-template-columns: 1fr 1fr;
    column-gap: 1.1rem;
  }

  /* ── seams inside a chapter ─────────────────────────────────────────────
     Where a chapter genuinely runs past a sheet — a long price table, a deal
     with six adders — the fold has to land between two rows and never inside
     one, and never immediately before a total. These are the only structural
     print rules the chapters still need, and they are about FRAGMENTATION
     rather than about layout. */
  #proposal-root [data-chapter] dl { break-inside: auto; }
  #proposal-root [data-chapter] dl > div { break-inside: avoid; }
  /* The total of a price table, alone at the top of a sheet, is the one row
     that must not be read on its own. */
  #proposal-root [data-section="cost"] dl > div:last-child { break-before: avoid; }
  /* A disclosure is two paragraphs under a heading, and half of one is worse
     than none. */
  #proposal-root [data-chapter] h3 { break-after: avoid; }

  /* ── the back matter ────────────────────────────────────────────────────
     Evidence, not argument: no chapter mark, no minimum height, no centring. It
     starts where the document ends and runs as long as it honestly is. The
     small print sets in two columns; the table above it does not. */
  #proposal-root [data-backmatter] {
    break-before: page;
    padding: 0.5in 0.6in 0;
  }
  #proposal-root [data-backmatter] > div { max-width: none; margin-bottom: 0.45in; }
  #proposal-root [data-backmatter] section { break-inside: auto; }
  #proposal-root [data-backmatter] table { break-inside: auto; }
  #proposal-root [data-backmatter] thead { display: table-header-group; }
  #proposal-root [data-backmatter] tr { break-inside: avoid; }
  #proposal-root [data-backmatter] h2 { break-after: avoid; }
  #proposal-root [data-colophon-legal] { column-count: 2; column-gap: 0.6in; }
  #proposal-root [data-colophon-legal] > * { break-inside: avoid; }

  /* ── the certificate ────────────────────────────────────────────────────
     Hidden on screen and revealed here — the ID selector outranks Tailwind's
     'hidden', so nothing about it has to be arranged twice.

     It is EVIDENCE about the document rather than part of it: no minimum
     height, no centring. 'break-inside: auto' lets it fold between rows rather
     than spilling a whole page to keep a table whole, and the header row
     repeats across the fold so a continuation sheet is readable on its own.

     Two columns of small print is right for the disclosures on the back matter
     and wrong here: a certificate is checked line by line against another
     document, and a reviewer should never have to work out which column
     continues where. */
  #proposal-root [data-certificate] {
    display: block;
    break-before: page;
    break-inside: auto;
    /* Bottom inset as a MARGIN on the content, not padding on the section —
       the same reason it is done that way for the chapters above. */
    padding: 0.5in 0.6in 0;
    background: #fff;
  }
  #proposal-root [data-certificate] > div { max-width: none; margin-bottom: 0.45in; }
  /* The closing note belongs with the trail it closes. Alone at the top of a
     sheet it reads as a page somebody forgot to delete. */
  #proposal-root [data-certificate] > div > p:last-child { break-before: avoid; }
  #proposal-root [data-certificate] table { break-inside: auto; }
  #proposal-root [data-certificate] thead { display: table-header-group; }
  #proposal-root [data-certificate] tr { break-inside: avoid; }
  /* The groups above the trail are short and are read as units. */
  #proposal-root [data-certificate] dl { break-inside: avoid; }

  /* Set to fit ONE sheet for the ordinary document — generated, sent, opened,
     signed. A deal shopped five times with two re-prices genuinely has more
     history than a page holds and is allowed the second sheet; a four-event
     trail spilling twenty pixels past the fold is not history, it is spacing. */
  #proposal-root [data-certificate] h2 { font-size: 1.45rem; }
  #proposal-root [data-certificate] > div > p { margin-top: 0.6rem; }
  #proposal-root [data-certificate] [data-cert-group] { margin-top: 0.7rem; }
  #proposal-root [data-certificate] dl > div { padding-top: 0.18rem; padding-bottom: 0.18rem; }
  #proposal-root [data-certificate] table th,
  #proposal-root [data-certificate] table td { padding-top: 0.28rem; padding-bottom: 0.28rem; }
}
`;
