# Marketing "Brushed Metal" Redesign — Design

**Date:** 2026-06-15

## Goal
Re-skin the public marketing site to a premium **brushed-silver / chrome on
near-black** aesthetic (matching the new metallic ANEXA logo), keeping the
**orange (#F4631E) only for primary CTAs**. Whole marketing site; home hero
keeps a real home photo, reskinned.

## Decisions (brainstorming)
- Accent: brushed-metal dominant; orange reserved for primary buttons/CTAs.
- Scope: home landing + shared header/footer/buttons + service pages.
- Hero: home-at-dusk photo, reskinned dark/metal, new logo featured.
- Re-skin, not rebuild: reuse structure, copy, Reveal/TiltCard/marquee, fonts.

## Approach

### 1. Tokens & utilities — `globals.css`
- Add a metal scale: `--metal` (#C7CCD1), `--metal-bright` (#EEF1F4),
  `--metal-dim` (#8A9096); a brushed-steel angled gradient for rims/text.
- Deepen backgrounds to refined near-black with a faint top gradient + subtle grain.
- Repoint shared accent classes from gold→metal: the `.eyebrow` label class and
  `.gold-gradient-text` (→ silver sheen). Keep `--gold` for CTAs only.
- `.glass-card` rim: gold iridescent → **chrome/brushed** rim + top highlight.
- New helpers: `.metal-text` (brushed-silver gradient text), `.metal-rim`,
  `.metal-divider`.

### 2. Buttons — `glass.tsx`
- Primary pill stays **orange** (`glass-pill-gold`) for "Request inspection".
- Secondary pill → brushed-metal/dark.

### 3. Hero — `hero.tsx`
- Keep `home-dusk.jpg` + parallax; darker cinematic overlay.
- Add the new brushed-metal mark (`/anexa-metal.png`) above the headline.
- Metal eyebrow; Fraunces headline with a silver sheen on the key phrase;
  orange primary CTA + metal secondary; stats strip with thin metal dividers.

### 4. Sections / header / footer / service pages
- Swap hardcoded `text-gold`/`bg-gold` on eyebrows, icons, dividers, and section
  accents → metal tones (via the repointed shared classes + targeted edits).
- Header/footer accents → metal; CTA buttons stay orange.
- `service-page.tsx` inherits the same treatment.

### 5. Logo asset
- `public/anexa-metal.png` (added) used in the hero (and footer). Nav keeps the
  clean wordmark lockup (square reflective logo doesn't read at nav size).

## Verification
typecheck + production build green before deploy; then deploy and screenshot-
review (tune iteratively). No DB/schema changes.

## Out of scope
New copy, new sections, the portal/app UI (marketing only).

## Files
`globals.css`, `hero.tsx`, `home-sections.tsx`, `site-header.tsx`,
`site-footer.tsx`, `glass.tsx`, `service-page.tsx`, `public/anexa-metal.png`.
