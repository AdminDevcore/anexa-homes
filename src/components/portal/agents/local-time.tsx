"use client";

import * as React from "react";
import { renderedAt, timeAgo } from "@/lib/agent-labels";

const noSubscribe = () => () => {};

/**
 * False during the server render and hydration, true after. For anything that
 * depends on the viewer's clock or time zone, which the server cannot know:
 * rendering it on the server would disagree with the browser and fail
 * hydration.
 */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(noSubscribe, () => true, () => false);
}

/** "4 min ago" (or the local date and time), with the local date and time on hover. UTC until hydrated. */
export function LocalTime({ iso, mode = "relative" }: { iso: string; mode?: "relative" | "absolute" }) {
  const client = useIsClient();
  if (!client) return <time dateTime={iso}>{`${iso.slice(0, 16).replace("T", " ")} UTC`}</time>;
  const local = new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={iso} title={local}>
      {mode === "relative" ? timeAgo(iso, renderedAt()) : local}
    </time>
  );
}
