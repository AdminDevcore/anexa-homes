"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll-reveal wrapper that is SSR/no-JS safe and never leaves content blank:
 *  - Default state is fully visible (so server-rendered HTML, no-JS, crawlers, and
 *    reduced-motion users always see content — nothing starts at opacity:0 in SSR).
 *  - Above-the-fold elements stay visible immediately (no hide → no flash).
 *  - Only elements that are below the fold get hidden (before paint, off-screen) and
 *    fade in when scrolled into view.
 *  - prefers-reduced-motion disables the animation entirely (motion-safe + a runtime
 *    check), leaving content visible.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

type Phase = "static" | "hidden" | "shown";

export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [phase, setPhase] = React.useState<Phase>("static");

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Respect reduced motion: stay static (visible, no animation).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rect = el.getBoundingClientRect();
    const inView = rect.top < window.innerHeight * 0.9 && rect.bottom > 0;
    // Above the fold: leave visible — never hide it, so it can't flash blank.
    if (inView) return;

    // Below the fold: hide (before paint, off-screen) then reveal on scroll-in.
    setPhase("hidden");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as React.ElementType;
  return (
    <Tag
      ref={ref}
      className={cn(
        className,
        phase !== "static" &&
          "motion-safe:transition-all motion-safe:duration-500 motion-safe:ease-out",
        phase === "hidden" && "motion-safe:translate-y-4 motion-safe:opacity-0"
      )}
      style={phase === "hidden" && delay ? { transitionDelay: `${delay * 60}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
