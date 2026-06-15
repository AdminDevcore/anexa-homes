"use client";

import * as React from "react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { TESTIMONIALS } from "@/lib/site";
import { Button } from "@/components/ui/button";

export function TestimonialsCarousel() {
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
    if (paused) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => scroll(1), 4500);
    return () => clearInterval(id);
  }, [paused, scroll]);

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div
        ref={ref}
        className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TESTIMONIALS.map((t) => (
          <figure
            key={t.name}
            className="flex shrink-0 basis-[88%] snap-start flex-col rounded-2xl border border-border bg-card p-7 sm:basis-[48%] lg:basis-[31.5%]"
          >
            <div className="flex gap-0.5">
              {Array.from({ length: t.rating }).map((_, j) => (
                <Star key={j} className="size-4 fill-[var(--metal-bright)] text-metal" />
              ))}
            </div>
            <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-foreground/85">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-5 border-t pt-4">
              <div className="font-semibold">{t.name}</div>
              <div className="text-sm text-muted-foreground">{t.location}</div>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous" onClick={() => scroll(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Next" onClick={() => scroll(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
