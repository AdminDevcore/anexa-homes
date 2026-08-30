"use client";

import * as React from "react";
import { Printer } from "lucide-react";

export type ChromeNavItem = { id: string; label: string };

/**
 * Sticky wayfinding for the public proposal: a slim nav with the company
 * mark, jump links that highlight the active section, and a scroll-progress
 * bar. Also drives the scroll-reveal animation by toggling `.is-in` on
 * `[data-reveal]` sections.
 *
 * Rendered once at the top of PresentationView. All effects degrade safely:
 * with no JS the content is fully visible and the page just scrolls normally.
 */
export function ProposalChrome({
  companyName,
  logoUrl,
  navItems,
  offsetTop = 0,
  glassOverHero = false,
}: {
  companyName: string;
  logoUrl: string | null;
  navItems: ChromeNavItem[];
  /**
   * Pixels of chrome already pinned above this bar. Zero on the customer's own
   * page, where the top of the viewport is the proposal's to take. Non-zero when
   * the rep previews the proposal inside the portal, whose shell header got
   * there first — without an offset both bars pin to y=0 and the proposal's nav
   * paints straight over the CRM's.
   */
  offsetTop?: number;
  /**
   * Opt in to frosted glass while the document's first section is under the bar.
   *
   * OFF by default, and it has to be: this bar is shared with the roofing
   * proposal and the battery one, whose covers are near-black. Sixty per cent
   * white over near-black is grey, and the inactive jump links go with it — so
   * the translucency is granted per document, by the one whose cover is a
   * photograph the bar is meant to sit ON rather than above.
   *
   * It also only lasts as long as that section does. Chapters further down are
   * dark for the same reason, so the bar takes its solid ground back the moment
   * the hero has passed under it.
   */
  glassOverHero?: boolean;
}) {
  const headerRef = React.useRef<HTMLElement>(null);
  const [progress, setProgress] = React.useState(0);
  const [overHero, setOverHero] = React.useState(glassOverHero);
  const [activeId, setActiveId] = React.useState<string>(navItems[0]?.id ?? "");

  // Scroll progress (whole-document).
  React.useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0);

      // Measured against the BAR'S OWN bottom edge rather than a scroll offset:
      // how far down the page this bar pins depends on what else is stacked
      // above it (the portal shell, an internal-preview notice, a superseded
      // banner), and a hard-coded threshold would be wrong in three of the four
      // places this document is read.
      if (glassOverHero) {
        const hero = document.querySelector<HTMLElement>('[data-section="cover"]');
        const bar = headerRef.current;
        const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
        setOverHero(!!hero && hero.getBoundingClientRect().bottom > barBottom);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [glassOverHero]);

  // Reveal-on-scroll + active-section tracking via IntersectionObserver.
  React.useEffect(() => {
    const root = document.getElementById("proposal-root");
    if (root) root.classList.add("proposal-js");

    const revealEls = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const revealObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            revealObs.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    revealEls.forEach((el) => revealObs.observe(el));

    const sectionEls = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    const activeObs = new IntersectionObserver(
      (entries) => {
        // Pick the entry nearest the top that's on screen.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.getAttribute("data-section");
          if (id) setActiveId(id);
        }
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sectionEls.forEach((el) => activeObs.observe(el));

    return () => {
      revealObs.disconnect();
      activeObs.disconnect();
    };
  }, []);

  const jump = (id: string) => {
    document.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** Frosted only while there is a photograph under the bar to frost. */
  const glass = glassOverHero && overHero;

  return (
    <header
      ref={headerRef}
      data-testid="proposal-chrome"
      // The z-index tracks the offset: on the customer's own page this bar
      // outranks everything, but embedded it has to stay under the portal
      // shell's header (z-30) so a menu opened from the CRM is never covered by
      // a preview of the document.
      className={
        "sticky border-b print:hidden " +
        // Only the document that can actually change ground gets the crossfade,
        // so every other caller's class list is what it was.
        (glassOverHero ? "transition-colors duration-300 " : "") +
        (glass
          ? "border-white/30 bg-white/60 backdrop-blur-xl backdrop-saturate-150 "
          : "border-neutral-200 bg-white/85 backdrop-blur-md ") +
        (offsetTop > 0 ? "z-20" : "z-50")
      }
      style={{ top: offsetTop }}
    >
      {/* scroll progress */}
      <div
        className="absolute inset-x-0 top-0 h-[3px] origin-left bg-[var(--proposal-accent)] transition-transform duration-150 ease-out"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden
      />
      {/* h-14 + the header's 1px border is PROPOSAL_NAV_PX in lib/proposal —
          change one and change the other, or jump links land behind this bar. */}
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        {/* brand */}
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex shrink-0 items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={companyName} className="h-6 w-auto object-contain" />
          ) : (
            <span className="font-display text-base font-bold text-neutral-900">{companyName}</span>
          )}
        </button>

        {/* jump links */}
        <nav className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
          {navItems.map((it) => (
            <button
              key={it.id}
              onClick={() => jump(it.id)}
              className={
                "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors " +
                (activeId === it.id
                  ? "bg-neutral-900 text-white"
                  : glass
                    ? "text-neutral-700 hover:bg-white/70 hover:text-neutral-900"
                    : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900")
              }
            >
              {it.label}
            </button>
          ))}
        </nav>

        {/* actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className={
              "hidden items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-neutral-700 transition sm:inline-flex " +
              (glass
                ? "border-white/60 bg-white/40 hover:bg-white/70"
                : "border-neutral-200 hover:bg-neutral-50")
            }
          >
            <Printer className="size-4" /> PDF
          </button>
        </div>
      </div>
    </header>
  );
}
