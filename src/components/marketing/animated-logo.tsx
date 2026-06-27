"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

// The "ANEXA HOMES" lockup, animated: the triangle mark glows/shimmers while
// the wordmark types itself in letter-by-letter (on load and again on hover).
// Uses the real lockup artwork — the text is revealed via a stepped clip, so it
// never mismatches the brand font. The mark is 305/1454 ≈ 21% of the lockup
// width, so the type-in starts just past it.
const LOCKUP_W = 1454;
const LOCKUP_H = 329;

export function AnimatedLogo({ className }: { className?: string }) {
  // Bumping `cycle` remounts the typing layer, restarting the animation —
  // once on mount (page load) and again on every hover.
  const [cycle, setCycle] = React.useState(0);

  return (
    <Link
      href="/"
      aria-label="Anexa Homes home"
      className={cn("anexa-logo group relative inline-flex items-center", className)}
      onMouseEnter={() => setCycle((c) => c + 1)}
    >
      {/* Metallic sheen + glow, masked to the triangle mark only. */}
      <span aria-hidden className="anexa-mark-shimmer" />

      {/* Typing layer: full lockup revealed in steps, with a blinking caret. */}
      <span key={cycle} aria-hidden className="anexa-type">
        <Image
          src="/anexa-lockup.png"
          alt=""
          width={LOCKUP_W}
          height={LOCKUP_H}
          priority
          className="anexa-type-img h-9 w-auto max-w-none object-contain sm:h-11 lg:h-12"
        />
        <span className="anexa-caret" />
      </span>

      <span className="sr-only">Anexa Homes</span>
    </Link>
  );
}
