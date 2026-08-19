/**
 * The visual identity of a financing partner — its logo, or a stand-in.
 *
 * Shared by the settings screen, the deal panel and the customer proposal, so
 * one lender looks like the same lender everywhere a person meets it. Pure
 * functions with no React and no Prisma: the proposal renders this server-side
 * from a frozen snapshot, and settings renders it in the browser from live rows.
 */

/**
 * Where the bytes are served from.
 *
 * `v` is the logo's own updatedAt rather than a request-time clock: the value
 * ends up frozen inside proposal snapshots, and a timestamp that moved on every
 * render would bust the cache on every open for no reason.
 */
export function lenderLogoUrl(lenderId: string, updatedAt: Date | number | null | undefined): string | null {
  if (!updatedAt) return null;
  const v = typeof updatedAt === "number" ? updatedAt : updatedAt.getTime();
  return `/api/solar/lender-logo?lender=${encodeURIComponent(lenderId)}&v=${v}`;
}

/**
 * Up to two initials, from the words that carry the name.
 *
 * "Amos Capital Fund" is Amos, not ACF, to a rep — but two letters read as a
 * mark and one reads as a typo, so the second word supplies the second letter.
 * Corporate suffixes are dropped: "Bank of America, N.A." must not become "BN".
 */
const SKIP_WORDS = new Set([
  "the", "of", "and", "for", "a", "an",
  "na", "n.a", "inc", "llc", "ltd", "lp", "llp", "co", "corp", "plc", "sa", "ag", "gmbh",
]);

export function lenderInitials(name: string): string {
  const words = name
    .split(/[\s\-–—_/&,.]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0 && !SKIP_WORDS.has(w.toLowerCase()));

  // Nothing but suffixes and punctuation — fall back to the raw string so a
  // lender named "&" still gets a mark instead of an empty box.
  if (words.length === 0) {
    const bare = name.replace(/[^\p{L}\p{N}]/gu, "");
    return (bare.slice(0, 2) || "?").toUpperCase();
  }
  if (words.length === 1) {
    // One word: two letters of it, because a single letter reads as unfinished.
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The monogram palette.
 *
 * Fixed pairs rather than a generated hue: a hashed hue lands on mud and on
 * neon with equal probability, and this sits next to a customer's money. Each
 * pair is a light tint with text dark enough to read on paper — the proposal
 * prints, so these are chosen to survive a monochrome-ish office printer too.
 */
export const LENDER_MARK_COLORS = [
  { bg: "#E0F2FE", fg: "#075985" }, // sky
  { bg: "#DCFCE7", fg: "#166534" }, // green
  { bg: "#FEF3C7", fg: "#92400E" }, // amber
  { bg: "#EDE9FE", fg: "#5B21B6" }, // violet
  { bg: "#FFE4E6", fg: "#9F1239" }, // rose
  { bg: "#CCFBF1", fg: "#115E59" }, // teal
  { bg: "#E0E7FF", fg: "#3730A3" }, // indigo
  { bg: "#FFEDD5", fg: "#9A3412" }, // orange
] as const;

/**
 * Which pair a lender gets. Deterministic on the name, so a partner keeps the
 * same colour on every screen and across every deploy — a mark that changes
 * colour is a mark nobody learns to recognise.
 */
export function lenderMarkColor(name: string): { bg: string; fg: string } {
  let h = 0;
  const key = name.trim().toLowerCase();
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return LENDER_MARK_COLORS[h % LENDER_MARK_COLORS.length];
}
