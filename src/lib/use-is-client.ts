"use client";

import * as React from "react";

const noSubscribe = () => () => {};

/**
 * False during the server render and hydration, true after. For anything that
 * depends on the viewer's clock or time zone, which the server cannot know:
 * rendering it on the server would disagree with the browser and fail
 * hydration.
 *
 * `useSyncExternalStore` returns the SERVER snapshot during hydration, so the
 * first client render matches the markup exactly and React re-renders straight
 * after — rather than a `suppressHydrationWarning` papering over a real
 * mismatch.
 */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(noSubscribe, () => true, () => false);
}
