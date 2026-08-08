"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type CarouselPhoto = { id: string; url: string; caption: string };

/**
 * Swipeable, scroll-snap photo carousel with prev/next controls, dot indicators,
 * and a full-screen lightbox on tap. Dark-chapter friendly (used on the editorial
 * proposal). Degrades to plain horizontal scrolling with no JS.
 */
export function PhotoCarousel({ photos, label }: { photos: CarouselPhoto[]; label?: string }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  const [lightbox, setLightbox] = React.useState<number | null>(null);

  const scrollToIndex = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(photos.length - 1, i));
    const child = el.children[clamped] as HTMLElement | undefined;
    if (child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  // Track the most-centered slide while scrolling.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children[i] as HTMLElement;
      const cCenter = c.offsetLeft - el.offsetLeft + c.clientWidth / 2;
      const d = Math.abs(cCenter - center);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    setActive(best);
  };

  // Lightbox keyboard nav.
  React.useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") setLightbox((n) => (n == null ? n : Math.min(photos.length - 1, n + 1)));
      if (e.key === "ArrowLeft") setLightbox((n) => (n == null ? n : Math.max(0, n - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, photos.length]);

  const single = photos.length === 1;

  return (
    <div className="relative">
      {/* Carousel track. On paper there is no swiping: everything past the first
          frame is scrolled out of view and would simply never print, so the same
          photos lay out as a grid. */}
      <div
        ref={scroller}
        onScroll={onScroll}
        data-photo-track
        className="hide-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 print:grid print:grid-cols-2 print:overflow-visible"
      >
        {photos.map((p, i) => (
          <figure
            key={p.id}
            className={`group relative shrink-0 snap-center overflow-hidden rounded-2xl print:w-full ${single ? "w-full" : "w-[86%] sm:w-[70%] lg:w-[62%]"}`}
          >
            <button type="button" onClick={() => setLightbox(i)} className="block w-full text-left" aria-label="Open photo full screen">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || label || "Inspection photo"} className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              {p.caption && (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10 text-sm font-medium text-white">
                  {p.caption}
                </figcaption>
              )}
            </button>
          </figure>
        ))}
      </div>

      {/* Controls */}
      {!single && (
        <>
          <button
            type="button"
            onClick={() => scrollToIndex(active - 1)}
            disabled={active === 0}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-lg backdrop-blur transition hover:bg-white disabled:opacity-0 print:hidden"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollToIndex(active + 1)}
            disabled={active === photos.length - 1}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-lg backdrop-blur transition hover:bg-white disabled:opacity-0 print:hidden"
          >
            <ChevronRight className="size-5" />
          </button>
          <div className="mt-3 flex justify-center gap-1.5 print:hidden">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => scrollToIndex(i)}
                aria-label={`Go to photo ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === active ? "w-6 bg-[var(--proposal-accent)]" : "w-1.5 bg-neutral-400/50 hover:bg-neutral-400/80"}`}
              />
            ))}
          </div>
        </>
      )}

      {/* Lightbox */}
      {lightbox != null && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 print:hidden"
          onClick={() => setLightbox(null)}
        >
          <button type="button" aria-label="Close" className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="size-6" />
          </button>
          {lightbox > 0 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox - 1); }}
              className="absolute left-4 grid size-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <ChevronLeft className="size-7" />
            </button>
          )}
          {lightbox < photos.length - 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => { e.stopPropagation(); setLightbox(lightbox + 1); }}
              className="absolute right-4 grid size-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <ChevronRight className="size-7" />
            </button>
          )}
          <figure className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[lightbox].url} alt={photos[lightbox].caption || ""} className="max-h-[82vh] w-auto rounded-lg object-contain" />
            {photos[lightbox].caption && <figcaption className="mt-3 text-center text-sm text-white/80">{photos[lightbox].caption}</figcaption>}
          </figure>
        </div>
      )}
    </div>
  );
}
