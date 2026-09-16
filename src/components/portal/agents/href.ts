/**
 * A link to the same page with some query parameters changed. Filters live in
 * the URL and are read on the server, so every filter chip and page link is a
 * plain <Link>. `null` or "" removes a parameter; keys are sorted so the same
 * filters always produce the same URL.
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
