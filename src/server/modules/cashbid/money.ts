/** Format cents as a currency string (client-safe — no server imports here). */
export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(
      Math.round(cents) / 100,
    );
  } catch {
    return `$${(Math.round(cents) / 100).toLocaleString()}`;
  }
}

/** Split a cash-bid total into deposit (upfront) + balance (on completion). */
export function bidAmounts(totalCents: number, depositPercent: number) {
  const pct = Math.min(100, Math.max(0, Math.round(depositPercent)));
  const total = Math.max(0, Math.round(totalCents));
  const depositCents = Math.round((total * pct) / 100);
  return { depositPercent: pct, totalCents: total, depositCents, balanceCents: Math.max(0, total - depositCents) };
}
