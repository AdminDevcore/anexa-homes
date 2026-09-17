"use client";

import { renderedAt, timeAgo, utcStamp } from "@/lib/agent-labels";
import { useIsClient } from "@/lib/use-is-client";

/**
 * "4 min ago" (or the local date and time), with the local date and time on
 * hover. UTC until hydrated.
 *
 * THE RELATIVE TIME DOES NOT TICK, on purpose. `timeAgo` is computed once per
 * render and the page is a server component with no polling, so "just now"
 * stays "just now" on a tab left open. Every other figure on the row — the
 * run's status, whether it is still going — is equally frozen, so a label that
 * refreshed itself would be the one live-looking thing on a stale row, which
 * is a worse lie than a stale one. The `title` carries the absolute time, and
 * any real action calls router.refresh(), which re-reads the lot. If a live
 * queue ever wants one, a shared 60s tick belongs with that queue, not here.
 */
export function LocalTime({ iso, mode = "relative" }: { iso: string; mode?: "relative" | "absolute" }) {
  const client = useIsClient();
  // The prop type `string` is wider than the real contract (an ISO instant).
  // Slicing a malformed one rendered silent garbage into the text and an
  // invalid `dateTime` attribute nothing would have complained about.
  const utc = utcStamp(iso);
  if (utc === null) return <span>—</span>;
  if (!client) return <time dateTime={iso}>{utc}</time>;
  const local = new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={iso} title={local}>
      {mode === "relative" ? timeAgo(iso, renderedAt()) : local}
    </time>
  );
}
