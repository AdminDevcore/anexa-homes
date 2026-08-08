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
}: {
  companyName: string;
  logoUrl: string | null;
  navItems: ChromeNavItem[];
}) {
  const [progress, setProgress] = React.useState(0);
  const [activeId, setActiveId] = React.useState<string>(navItems[0]?.id ?? "");

  // Scroll progress (whole-document).
  React.useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

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

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/85 backdrop-blur-md print:hidden">
      {/* scroll progress */}
      <div
        className="absolute inset-x-0 top-0 h-[3px] origin-left bg-[var(--proposal-accent)] transition-transform duration-150 ease-out"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden
      />
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
            className="hidden items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 sm:inline-flex"
          >
            <Printer className="size-4" /> PDF
          </button>
        </div>
      </div>
    </header>
  );
}
