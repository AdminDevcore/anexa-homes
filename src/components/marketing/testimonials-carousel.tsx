"use client";

import * as React from "react";
import Link from "next/link";
import { Star, ChevronLeft, ChevronRight, Quote } from "lucide-react";
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

  const scroll = React.useCallback((dir: number) => {
    const el = ref.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85 * dir;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    if (dir > 0 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
    else el.scrollBy({ left: amount, behavior: "smooth" });
  }, []);

  React.useEffect(() => {
    if (paused || items.length <= 1) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => scroll(1), 4500);
    return () => clearInterval(id);
  }, [paused, scroll, items.length]);

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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={k}
                    src={url}
                    alt="Review photo"
                    loading="lazy"
                    className="size-16 rounded-lg object-cover ring-1 ring-border"
                  />
                ))}
                {t.photoUrls.length > 3 ? (
                  <span className="grid size-16 place-items-center rounded-lg bg-foreground/5 text-xs font-medium text-muted-foreground">
                    +{t.photoUrls.length - 3}
                  </span>
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
    </div>
  );
}
