"use client";

import * as React from "react";

/**
 * The document read as a deck.
 *
 * The same seven chapters serve two audiences that read them differently: a
 * homeowner scrolling a phone, and a rep advancing chapters on a tablet at a
 * kitchen table. Rather than building two documents, the chapters snap.
 *
 * Three deliberate limits:
 *
 *  1. **`proximity`, never `mandatory`.** Chapters 4 and 5 are taller than a
 *     viewport — a payment table and a 25-year projection legitimately are.
 *     Mandatory snap fights a reader trying to scroll INSIDE one of those and
 *     yanks them back to its top, which is unusable on exactly the two screens
 *     that carry the terms somebody is being asked to sign.
 *  2. **Wide screens only.** Below 768px there is no rep and no keyboard, just
 *     a thumb, and snapping a thumb-scroll is worse than not.
 *  3. **Never in print, never under reduced motion.**
 */
export function DeckStyles() {
  return (
    <style>{`
      @media (min-width: 768px) and (prefers-reduced-motion: no-preference) {
        html:has(#proposal-root) { scroll-snap-type: y proximity; }
        #proposal-root [data-chapter] { scroll-snap-align: start; }
      }
      @media print {
        html:has(#proposal-root) { scroll-snap-type: none; }
      }
    `}</style>
  );
}

/** Elements that own their own arrow keys. The deck never steals from these. */
function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * `←` `→` `PageUp` `PageDown` move by chapter.
 *
 * Bound to the window rather than to a container because the document IS the
 * scroller here, and a rep presenting has not clicked anything — there is no
 * focused element to hang a handler on.
 *
 * The signature field is the reason `isTyping` exists: a customer typing their
 * name into the acceptance box presses arrow keys to correct a typo, and a deck
 * that answered by scrolling them away from the form they were completing would
 * be a bug on the single most important control in the document.
 */
export function useDeckKeys(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(e.target)) return;

      const dir =
        e.key === "ArrowRight" || e.key === "PageDown"
          ? 1
          : e.key === "ArrowLeft" || e.key === "PageUp"
            ? -1
            : 0;
      if (dir === 0) return;

      const chapters = Array.from(document.querySelectorAll<HTMLElement>("#proposal-root [data-chapter]"));
      if (chapters.length === 0) return;

      // Where the reader actually is: the last chapter whose top has passed the
      // chrome. A tolerance keeps a chapter resting a pixel or two under the
      // nav from reading as "the previous one".
      const chromeH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--proposal-chrome-h"),
      );
      const line = (Number.isFinite(chromeH) ? chromeH : 0) + 4;
      let current = 0;
      chapters.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= line) current = i;
      });

      const next = Math.min(chapters.length - 1, Math.max(0, current + dir));
      if (next === current && !(dir === -1 && current === 0)) return;
      e.preventDefault();
      chapters[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
