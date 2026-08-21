"use client";

import * as React from "react";
import Link from "next/link";
import { Star, ChevronLeft, ChevronRight, Quote, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CarouselReview = {
  id?: string;
  name: string;
  location: string | null;
  service?: string | null;
  rating: number;
  quote: string;
  photoUrls?: string[];
};

export function TestimonialsCarousel({
  items,
  stats,
}: {
  items: CarouselReview[];
  stats?: { count: number; average: number } | null;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [paused, setPaused] = React.useState(false);
  // Full-screen photo viewer (lightbox) for review images.
  const [lightbox, setLightbox] = React.useState<{ urls: string[]; i: number } | null>(null);

  const scroll = React.useCallback((dir: number) => {
    const el = ref.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85 * dir;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    if (dir > 0 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
    else el.scrollBy({ left: amount, behavior: "smooth" });
  }, []);

  React.useEffect(() => {
    if (paused || lightbox || items.length <= 1) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => scroll(1), 4500);
    return () => clearInterval(id);
  }, [paused, lightbox, scroll, items.length]);

  // Lightbox keyboard controls: Esc closes, ←/→ navigate within a review's photos.
  React.useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowRight") setLightbox((lb) => (lb ? { ...lb, i: (lb.i + 1) % lb.urls.length } : lb));
      else if (e.key === "ArrowLeft") setLightbox((lb) => (lb ? { ...lb, i: (lb.i - 1 + lb.urls.length) % lb.urls.length } : lb));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {stats && stats.count > 0 ? (
        <div className="mb-8 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, j) => (
                <Star
                  key={j}
                  className={
                    j < Math.round(stats.average)
                      ? "size-5 fill-[var(--metal-bright)] text-metal"
                      : "size-5 text-muted-foreground/30"
                  }
                />
              ))}
            </div>
            <span className="font-display text-2xl font-semibold">{stats.average.toFixed(1)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Based on {stats.count} verified review{stats.count === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}
      <div
        ref={ref}
        className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((t, i) => (
          <figure
            key={t.id ?? `${t.name}-${i}`}
            className="flex shrink-0 basis-[88%] snap-start flex-col rounded-2xl border border-border bg-card p-7 transition-shadow hover:shadow-xl hover:shadow-black/5 sm:basis-[48%] lg:basis-[31.5%]"
          >
            <div className="flex items-center justify-between">
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star
                    key={j}
                    className={
                      j < t.rating
                        ? "size-4 fill-[var(--metal-bright)] text-metal"
                        : "size-4 text-muted-foreground/30"
                    }
                  />
                ))}
              </div>
              <Quote className="size-6 text-metal/25" />
            </div>
            <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-foreground/85">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            {t.photoUrls && t.photoUrls.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {t.photoUrls.slice(0, 3).map((url, k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLightbox({ urls: t.photoUrls!, i: k })}
                    className="cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-border transition-transform hover:scale-[1.04]"
                    aria-label="View review photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Review photo" loading="lazy" className="size-16 object-cover" decoding="async" />
                  </button>
                ))}
                {t.photoUrls.length > 3 ? (
                  <button
                    type="button"
                    onClick={() => setLightbox({ urls: t.photoUrls!, i: 3 })}
                    className="grid size-16 cursor-zoom-in place-items-center rounded-lg bg-foreground/5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10"
                    aria-label="View all review photos"
                  >
                    +{t.photoUrls.length - 3}
                  </button>
                ) : null}
              </div>
            ) : null}
            <figcaption className="mt-5 flex items-center gap-3 border-t pt-4">
              <span className="grid size-10 place-items-center rounded-full bg-foreground/5 font-display text-sm font-semibold text-metal-dim">
                {t.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold">{t.name}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {[t.location, t.service].filter(Boolean).join(" · ")}
                </div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button variant="outline" size="icon" aria-label="Previous" onClick={() => scroll(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button asChild className="bg-gold text-gold-foreground hover:bg-gold/90">
          <Link href="/reviews">Leave a Review</Link>
        </Button>
        <Button variant="outline" size="icon" aria-label="Next" onClick={() => scroll(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Full-screen photo viewer */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          {lightbox.urls.length > 1 ? (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); setLightbox((lb) => (lb ? { ...lb, i: (lb.i - 1 + lb.urls.length) % lb.urls.length } : lb)); }}
              className="absolute left-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.urls[lightbox.i]}
            alt="Review photo"
            onClick={(e) => e.stopPropagation()}
            decoding="async"
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          />
          {lightbox.urls.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Next photo"
                onClick={(e) => { e.stopPropagation(); setLightbox((lb) => (lb ? { ...lb, i: (lb.i + 1) % lb.urls.length } : lb)); }}
                className="absolute right-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <ChevronRight className="size-6" />
              </button>
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
                {lightbox.i + 1} / {lightbox.urls.length}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
