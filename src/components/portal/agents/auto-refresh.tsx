"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page every few seconds while something on it is queued or
 * running, so a Run now is followed through to its result without a reload.
 * Stops as soon as nothing on the page is in flight.
 */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
