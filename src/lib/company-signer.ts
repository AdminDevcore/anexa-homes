/**
 * The person who signs for us — the shape of one, and the rules that keep a
 * template's mapping pointing at the same line after somebody renames it.
 *
 * Pure: no Prisma, no session. The server module reads and writes rows; this
 * decides what a credential key is, which signer applies, and how a signer
 * becomes autofill values.
 */

/** One extra labelled line on a signer: "NABCEP #", "TDLR #", "State of TX". */
export type SignerCredential = {
  /**
   * Slug of the label AT THE MOMENT IT WAS CREATED, and never recomputed.
   *
   * A template maps `{{signer.cred.nabcep}}`. If the key were derived from the
   * label on every read, correcting "NABCEP" to "NABCEP #" would silently
   * repoint that token at nothing, and the document would print a blank line
   * where a certification number belongs. Freezing the key means the label is
   * free to change and the mapping survives.
   */
  key: string;
  label: string;
  value: string;
};

/**
 * A label reduced to a token-safe key. `{{...}}` paths are matched by
 * `[\w.]+` in autofill's TOKEN_RE, so a key may only hold word characters —
 * anything else would produce a token the resolver cannot see.
 */
export function credentialKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "credential"
  );
}

/**
 * Make a key unique within one signer's list.
 *
 * Two lines labelled "Licence" would otherwise share a key, and the second
 * would be unreachable — the resolver stops at the first match. Suffixing keeps
 * both mappable.
 */
export function uniqueCredentialKey(label: string, taken: Iterable<string>): string {
  const base = credentialKey(label);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/**
 * Read the `credentials` JSON column into a list, tolerating anything.
 *
 * Rows written before a shape change, or by hand, must not take a settings
 * screen down — an unreadable credential is dropped, not thrown on.
 */
export function parseCredentials(raw: unknown): SignerCredential[] {
  if (!Array.isArray(raw)) return [];
  const out: SignerCredential[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) continue;
    const value = typeof r.value === "string" ? r.value.trim() : "";
    // A missing key is recovered from the label rather than dropping the line.
    const key = typeof r.key === "string" && r.key.trim() ? r.key.trim() : uniqueCredentialKey(label, seen);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, value });
  }
  return out;
}

/** A signer, as everything downstream of the database sees them. */
export type ResolvedSigner = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  licenseNumber: string;
  credentials: SignerCredential[];
  signatureData: string | null;
  /** The initials mark, falling back to the signature so a slot is never blank. */
  initialsData: string | null;
};

type SignerRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  credentials: unknown;
  signatureData: string | null;
  initialsData: string | null;
};

export function toResolvedSigner(row: SignerRow): ResolvedSigner {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    licenseNumber: row.licenseNumber ?? "",
    credentials: parseCredentials(row.credentials),
    signatureData: row.signatureData,
    initialsData: row.initialsData ?? row.signatureData,
  };
}

/**
 * Which saved signer signs a given document.
 *
 * The template's own choice wins; otherwise the company default. A template
 * pointing at a signer who has since been deactivated falls through to the
 * default rather than resolving to nobody — the document still needs signing,
 * and refusing the send over a retired colleague helps no one.
 */
export function pickSigner<T extends { id: string; active: boolean; isDefault: boolean }>(
  signers: T[],
  templateSignerId: string | null | undefined
): T | null {
  const usable = signers.filter((s) => s.active);
  if (templateSignerId) {
    const named = usable.find((s) => s.id === templateSignerId);
    if (named) return named;
  }
  return usable.find((s) => s.isDefault) ?? null;
}

/** Signature capture caps. A saved mark is a small transparent PNG, not artwork. */
export const SIGNATURE_MAX_WIDTH = 600;
export const SIGNATURE_MAX_HEIGHT = 200;
/** Ceiling on the uploaded file, before normalisation. */
export const SIGNATURE_MAX_BYTES = 4 * 1024 * 1024;
