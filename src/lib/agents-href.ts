/**
 * A link to the same page with some query parameters changed. Filters live in
 * the URL and are read on the server, so every filter chip and page link is a
 * plain <Link>. `null` or "" removes a parameter; keys are sorted so the same
 * filters always produce the same URL.
 *
 * A FILTER PATCH ALWAYS INCLUDES `page: null`. Nothing here drops a page
 * number, so without it `page=5` rides through a filter change: the list
 * clamps, nothing errors, and the view quietly shows page 1 while the address
 * bar claims page 5. Resetting to the first page is what the reader expects,
 * and saying so at each call site is the only way to get it.
 *
 * `current` is NOT checked against an allowlist — whatever is in it propagates
 * into every link built from it. Pass the page's own validated values, never
 * `await searchParams` straight through, or an arbitrary caller-supplied key
 * rides along on every chip.
 */
export function hrefWith(
  path: string,
  current: Record<string, string | null | undefined>,
  patch: Record<string, string | number | null | undefined>
): string {
  const merged: Record<string, string | number | null | undefined> = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const key of Object.keys(merged).sort()) {
    const value = merged[key];
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
