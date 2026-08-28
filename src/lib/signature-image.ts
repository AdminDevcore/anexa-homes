/**
 * A typed name, rendered to the same kind of artefact a drawn signature is.
 *
 * BOTH ROUTES HAVE TO PRODUCE AN IMAGE. A signature that is stored as a string
 * when typed and as a PNG when drawn forces every renderer downstream — the
 * document, the print sheet, the certificate, the filed PDF — to carry two code
 * paths and to make the typed one look like a different, lesser thing. It is
 * not a lesser thing: under ESIGN a typed name adopted as a signature is a
 * signature. So it is drawn to a canvas here and travels as pixels, exactly
 * like the finger-drawn one.
 *
 * Client-only: `document` is required. Callers are "use client" components.
 */
export function cursiveImage(text: string, width = 600, height = 200): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#0B0B0C";
  c.font = `${Math.round(height * 0.32)}px 'Brush Script MT', cursive`;
  c.textBaseline = "middle";
  c.fillText(text, 20, height / 2);
  return canvas.toDataURL("image/png");
}

/**
 * Is this string a signature image we are willing to store and render?
 *
 * Data URLs are the one place a "picture" can carry script — `image/svg+xml`
 * can hold a `<script>` element, and this value is rendered back into a page
 * that a customer, a rep and a lender all open. Only the two raster types the
 * pads actually produce are accepted, so an SVG cannot arrive by any route.
 *
 * Shared by the server (which must not trust the client) and the pad (which
 * fails fast rather than posting something the server will reject).
 */
const SIGNATURE_PREFIXES = ["data:image/png;base64,", "data:image/jpeg;base64,"] as const;

/** Roughly 700KB of base64 — far more than a pad produces, far less than a bomb. */
export const SIGNATURE_MAX_CHARS = 700_000;

export function isSignatureImage(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value.length > SIGNATURE_MAX_CHARS) return false;
  if (!SIGNATURE_PREFIXES.some((p) => value.startsWith(p))) return false;
  // Everything after the comma must be base64 and nothing else.
  return /^[A-Za-z0-9+/=]+$/.test(value.slice(value.indexOf(",") + 1));
}
