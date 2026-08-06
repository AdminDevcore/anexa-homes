/**
 * Address matching for every search box in the portal.
 *
 * A roofing crew thinks in addresses, not record names — "the Oak St job", "the
 * one in 75024". So every list search matches street, city, state and ZIP as a
 * single blob alongside whatever else that list searches. Both halves live here
 * (the in-memory haystack and the Prisma filter) so client- and server-side
 * searches never drift apart on which parts count as "the address".
 */

export type AddressParts = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

/**
 * "123 Oak St Plano TX 75024" — blanks dropped, single-spaced, never null.
 * For client-side filtering, where the whole row is flattened into one string.
 */
export function addressSearchText(parts: AddressParts | null | undefined): string {
  if (!parts) return "";
  return [parts.address, parts.city, parts.state, parts.zip]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Prisma `OR` fragments matching `q` against each address column, for models
 * that carry the four fields directly (Lead, Project). Spread into an existing
 * OR array — it is fragments, not a complete where clause.
 */
export function addressContains(q: string) {
  const contains = { contains: q, mode: "insensitive" as const };
  return [{ address: contains }, { city: contains }, { state: contains }, { zip: contains }];
}
