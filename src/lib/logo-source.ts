/**
 * Finding a company's logo on its own website.
 *
 * Every lender already publishes its mark — in the tab icon, in the icon a
 * phone uses when you save the site to a home screen, in the card that appears
 * when the URL is pasted into a chat. This reads those declarations out of a
 * page so an admin does not have to go hunting for a PNG.
 *
 * Pure parsing and pure address rules only: the fetching, and the DNS lookup
 * that the address rules are applied to, live in the server action. Split that
 * way because the interesting failure modes here — a page that declares six
 * icons, a URL that resolves to localhost — are exactly the cases worth having
 * tests for, and neither needs a network to exercise.
 */

/** A logo the page declared, and how good a bet it is. */
export type LogoCandidate = {
  url: string;
  /** Why it was picked, for the message the admin reads afterwards. */
  source: "apple-touch-icon" | "icon" | "og:image" | "twitter:image" | "favicon.ico";
};

/** Attribute lookup inside one raw tag. Quoted or bare, single or double. */
function attr(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i")) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i"));
  return m ? m[1].trim() : null;
}

/** `sizes="180x180 90x90"` → 32400. Undeclared sorts last, not first. */
function declaredArea(tag: string): number {
  const sizes = attr(tag, "sizes");
  if (!sizes) return 0;
  let best = 0;
  for (const part of sizes.split(/\s+/)) {
    const m = part.match(/^(\d+)[xX](\d+)$/);
    if (m) best = Math.max(best, Number(m[1]) * Number(m[2]));
  }
  // "any" means a vector, which upscales to whatever we ask for.
  return sizes.toLowerCase().includes("any") ? Number.MAX_SAFE_INTEGER : best;
}

/**
 * `.ico` is ranked last and `.svg` first among equals.
 *
 * Not taste: sharp cannot decode ICO at all, so an .ico candidate is a likely
 * dead end, while an SVG rasterises to whatever size we ask for.
 */
function formatRank(url: string): number {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".svg")) return 2;
  if (path.endsWith(".ico")) return 0;
  return 1;
}

/** Absolute, http(s), and de-duplicated. Anything else is dropped silently. */
function absolute(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Every logo a page declares, best bet first.
 *
 * Apple touch icons lead because they are the one icon a site is obliged to
 * publish square, opaque and large — a favicon is often 16px, and og:image is
 * usually a wide banner with a headline baked into it, which looks wrong beside
 * a lender's name. og:image is still kept, because a site with no usable icon
 * and a decent card image is better served by the card image than by nothing.
 */
export function pickLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  // A <base href> retargets every relative URL on the page, and sites that use
  // one tend to be exactly the sites whose icons sit on a separate CDN host.
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  const declaredBase = baseTag ? absolute(attr(baseTag, "href"), baseUrl) : null;
  const base = declaredBase ?? baseUrl;

  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];

  const apple: { url: string; area: number; fmt: number }[] = [];
  const icons: { url: string; area: number; fmt: number }[] = [];

  for (const tag of links) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const url = absolute(attr(tag, "href"), base);
    if (!url) continue;
    // A mask-icon is a monochrome silhouette meant to be tinted by Safari. It
    // renders as a solid black blob anywhere else, so it is never a logo.
    if (rel.includes("mask-icon")) continue;
    const entry = { url, area: declaredArea(tag), fmt: formatRank(url) };
    if (rel.some((r) => r.startsWith("apple-touch-icon"))) apple.push(entry);
    else if (rel.includes("icon")) icons.push(entry);
  }

  const byQuality = (a: { area: number; fmt: number }, b: { area: number; fmt: number }) =>
    b.area - a.area || b.fmt - a.fmt;
  apple.sort(byQuality);
  icons.sort(byQuality);

  const out: LogoCandidate[] = [
    ...apple.map((e) => ({ url: e.url, source: "apple-touch-icon" as const })),
    ...icons.map((e) => ({ url: e.url, source: "icon" as const })),
  ];

  for (const tag of metas) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (key !== "og:image" && key !== "og:image:url" && key !== "twitter:image") continue;
    const url = absolute(attr(tag, "content"), base);
    if (url) out.push({ url, source: key === "twitter:image" ? "twitter:image" : "og:image" });
  }

  // The undeclared convention. Last, because sharp cannot read ICO — but sites
  // that serve a PNG from this path do exist, and it costs one request.
  const fallback = absolute("/favicon.ico", baseUrl);
  if (fallback) out.push({ url: fallback, source: "favicon.ico" });

  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

/** http(s) only, and parseable. Everything else is refused before any fetch. */
export function parseHttpUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  // A bare domain is what someone actually types. Assume https rather than
  // rejecting it, which is what every browser address bar does.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Addresses this server must never be talked into fetching.
 *
 * The URL being fetched is supplied by an admin, so this is not the classic
 * hostile-user SSRF — but "paste a link and we fetch it" is still a server
 * making requests on someone else's say-so, and the cost of getting the range
 * list right once is a few lines. Loopback, private, link-local (which is where
 * cloud metadata endpoints live) and unspecified are all refused.
 */
export function isBlockedAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  const v6 = ip.toLowerCase().split("%")[0];
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  // IPv4 wearing an IPv6 hat — ::ffff:127.0.0.1 must not slip through.
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  return false;
}
