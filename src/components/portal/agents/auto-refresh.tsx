"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page every few seconds while something on it is queued or
 * running, so a Run now is followed through to its result without a reload.
 * Stops as soon as nothing on the page is in flight, gives up after ten
 * minutes, and never polls a tab nobody is looking at.
 */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    // Still in flight after ten minutes is stuck, not slow — a hung handler, a
    // timeout of up to 240 s, the reaper arriving later — and wants a reload,
    // not a poll re-running two queries three times a minute for as long as
    // the tab stays open.
    const until = Date.now() + 10 * 60 * 1000;
    const id = window.setInterval(() => {
      if (Date.now() > until) {
        window.clearInterval(id);
        return;
      }
      // A hidden tab has nobody reading it; showing it again refreshes anyway.
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
