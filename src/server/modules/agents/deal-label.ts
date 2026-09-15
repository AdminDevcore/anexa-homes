/** The Lead fields a label needs. */
export const DEAL_LABEL_SELECT = { firstName: true, lastName: true, address: true, city: true } as const;

/** "Maria Lopez · 12 Elm St, Dallas": who and where, the way Operations says a deal on the phone. */
export function dealLabel(lead: { firstName: string; lastName: string; address: string | null; city: string | null }): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim() || "Unnamed customer";
  const place = [lead.address?.trim(), lead.city?.trim()].filter(Boolean).join(", ");
  return place ? `${name} · ${place}` : name;
}
