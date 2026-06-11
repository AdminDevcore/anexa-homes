export type FormatConfig = { currency?: string; locale: string; timeZone?: string };

/** Build a money formatter that turns integer minor units (cents) into a currency string. */
export function makeMoney(cfg: { currency: string; locale: string }) {
  return (cents: number, opts?: { compact?: boolean }): string => {
    const amount = (cents ?? 0) / 100;
    return new Intl.NumberFormat(cfg.locale, {
      style: "currency",
      currency: cfg.currency,
      notation: opts?.compact ? "compact" : "standard",
      maximumFractionDigits: opts?.compact ? 1 : 0,
    }).format(amount);
  };
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  return typeof d === "string" ? new Date(d) : d;
}

export function makeDate(cfg: { locale: string; timeZone?: string }) {
  return (d: Date | string | null | undefined): string => {
    const date = toDate(d);
    if (!date) return "—";
    return new Intl.DateTimeFormat(cfg.locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: cfg.timeZone,
    }).format(date);
  };
}

export function makeDateTime(cfg: { locale: string; timeZone?: string }) {
  return (d: Date | string | null | undefined): string => {
    const date = toDate(d);
    if (!date) return "—";
    return new Intl.DateTimeFormat(cfg.locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: cfg.timeZone,
    }).format(date);
  };
}
