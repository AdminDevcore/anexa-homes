/**
 * The reporting window every period-scoped screen shares.
 *
 * Lifted out of builders.ts so a page that is not a Report can ask for the same
 * window without importing the whole report catalogue — the Team Performance
 * screen is one, and it exists precisely because managers have no Report grant.
 */

export type Period = { from: Date; to: Date; label: string; preset: string };

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/** Before this company, before this product. Stands in for "no lower bound". */
const DAWN = new Date("2000-01-01T00:00:00.000Z");

/**
 * A `<input type="date">` value as a LOCAL calendar day.
 *
 * `new Date("2026-06-01")` is parsed as UTC midnight, which west of Greenwich
 * is the evening of May 31 — and `startOfDay` then rounds it down to May 31,
 * so a range typed as "June" silently reported from the last day of May.
 */
function parseDay(value: string): Date | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const loose = new Date(value);
  return Number.isNaN(loose.getTime()) ? null : loose;
}

export function resolvePeriod(preset?: string, fromStr?: string, toStr?: string): Period {
  const now = new Date();
  if (preset === "custom" && fromStr && toStr) {
    const fromDay = parseDay(fromStr);
    const toDay = parseDay(toStr);
    if (fromDay && toDay) {
      return {
        from: startOfDay(fromDay),
        to: endOfDay(toDay),
        label: `${fromStr} → ${toStr}`,
        preset: "custom",
      };
    }
  }
  const to = endOfDay(now);
  switch (preset) {
    case "all":
      return { from: DAWN, to, label: "All time", preset: "all" };
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to, label: "This month", preset: "month" };
    case "last_month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from, to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)), label: "Last month", preset: "last_month" };
    }
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { from: new Date(now.getFullYear(), q * 3, 1), to, label: "This quarter", preset: "quarter" };
    }
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1), to, label: "Year to date", preset: "ytd" };
    case "week":
    default: {
      const day = (now.getDay() + 6) % 7; // Monday = 0
      const from = startOfDay(new Date(now));
      from.setDate(now.getDate() - day);
      return { from, to, label: "This week", preset: "week" };
    }
  }
}
