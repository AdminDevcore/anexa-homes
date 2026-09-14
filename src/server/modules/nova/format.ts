import { utcToZonedWallClock, zonedWallClockToUtc } from "@/lib/tz";

/**
 * How Nova turns stored values into words.
 *
 * Two rules, both from the brief: a missing value is said to be NOT SET — never
 * a zero, never a guess — and money is exact to the cent. Precision elsewhere
 * matches what the deal page itself shows, so what Nova says and what the
 * screen says are the same figure.
 */

export const NOT_SET = "not set";

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return NOT_SET;
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/** Two decimals, like the System size tile. A 0 kW system is one nobody has drawn. */
export function formatKw(kw: number | null | undefined): string {
  if (kw == null || !(kw > 0)) return NOT_SET;
  return `${kw.toFixed(2)} kW`;
}

/** A whole percent, like the Offset tile. */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return NOT_SET;
  return `${Math.round(pct)}%`;
}

// Newer ICU puts a narrow no-break space before AM/PM; a speech engine and a
// test both want a plain one.
const plainSpaces = (s: string) => s.replace(/[  ]/g, " ");

export function formatDateTime(date: Date | null | undefined, timeZone: string): string {
  if (!date) return NOT_SET;
  return plainSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  );
}

export function formatDay(date: Date | null | undefined, timeZone: string): string {
  if (!date) return NOT_SET;
  return plainSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  );
}

/** "YYYY-MM-DD" for an instant, read in the company's timezone. */
export function dayInZone(date: Date, timeZone: string): string {
  return utcToZonedWallClock(date, timeZone).slice(0, 10);
}

// --- Phones ------------------------------------------------------------------
//
// Leads hold phones in more than one shape — "(214) 555-0101" and "2145550101"
// both occur — and nothing normalises them on the way in. A plain `contains`
// search misses whichever shape it was not typed in, so Nova compares digits.

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

const national = (digits: string) =>
  digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

/** A query made only of digits and phone punctuation, with at least 4 digits. */
export function looksLikePhone(query: string): boolean {
  return phoneDigits(query).length >= 4 && /^[\d\s()+\-.]+$/.test(query.trim());
}

export function phoneMatches(stored: string | null | undefined, query: string): boolean {
  const s = national(phoneDigits(stored));
  const q = national(phoneDigits(query));
  if (q.length < 4 || !s) return false;
  return s.includes(q);
}

// --- Date ranges -------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days, inclusive of both ends, in the company's timezone — so "this
 * month" means this month where the company is, not in UTC.
 */
export function zonedDayRange(
  from: string,
  to: string,
  timeZone: string
): { start: Date; endExclusive: Date } {
  if (!DAY.test(from) || !DAY.test(to)) throw new Error("Dates must be written YYYY-MM-DD.");
  if (to < from) throw new Error("The range ends before it starts.");
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start: zonedWallClockToUtc(`${from}T00:00`, timeZone),
    endExclusive: zonedWallClockToUtc(`${next.toISOString().slice(0, 10)}T00:00`, timeZone),
  };
}
