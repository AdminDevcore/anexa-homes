/**
 * Where a checklist slot's example photo is served from.
 *
 * `v` is the example's own updatedAt rather than a request-time clock: the URL
 * is cached hard, so a value that moved on every render would re-download the
 * same image on every open, and a value that never moved would leave a replaced
 * example stale in the browser for a day.
 *
 * A pure function with no React and no Prisma — the settings screen, the deal's
 * photo folder and the field checklist all build the same URL for the same slot.
 */
export function photoExampleUrl(
  itemId: string,
  updatedAt: Date | number | null | undefined
): string | null {
  if (!updatedAt) return null;
  const v = typeof updatedAt === "number" ? updatedAt : updatedAt.getTime();
  return `/api/photo-templates/example?item=${encodeURIComponent(itemId)}&v=${v}`;
}
