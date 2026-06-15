// Helpers for the signing experience. Kept pure (no DOM) so the field-mapping
// logic — the part that previously put the full signature into initials fields —
// is unit-testable.

export type AdoptedSignature = {
  /** Data URL of the full signature image. */
  signature?: string | null;
  /** Data URL of the initials image. */
  initials?: string | null;
};

/** First + last initial of a name, uppercased. "Mustafa Joulani" -> "MJ". */
export function deriveInitials(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  const first = tokens[0][0] ?? "";
  const last = tokens.length > 1 ? tokens[tokens.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Map an adopted signature/initials onto the signer's signature & initials
 * fields. Signature fields get the signature image; initials fields get the
 * initials image — never the other way around.
 */
export function mapAdoptedToFields(
  fields: { id: string; type: string }[],
  adopted: AdoptedSignature
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "initials") {
      if (adopted.initials) out[f.id] = adopted.initials;
    } else if (f.type === "signature") {
      if (adopted.signature) out[f.id] = adopted.signature;
    }
  }
  return out;
}
