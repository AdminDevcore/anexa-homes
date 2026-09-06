import { describe, it, expect } from "vitest";
import {
  payrollPeriodFor,
  currentPayrollPeriod,
  payrollLabel,
  toDateInputValue,
} from "../schedule";

/**
 * Thursday pays the prior WORKWEEK — Monday to Friday of the week before.
 *
 * Written against real calendar dates rather than offsets, because off-by-one
 * week arithmetic reads correct and pays somebody for the wrong five days.
 * The worked example the business gave is the first test: Monday 1 September
 * through Friday 5 September, paid the following Thursday.
 */

/** Local midday, so the assertions match how the module reads a date. */
const at = (iso: string, h = 12) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, h);
};

const ymd = (d: Date) => toDateInputValue(d);

/** Whole calendar days between two dates, ignoring the time of day. */
const daysBetween = (a: Date, b: Date) => {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(b) - day(a)) / (24 * 60 * 60 * 1000));
};

describe("payrollPeriodFor", () => {
  it("THE WORKED EXAMPLE: Thu 11 Sep pays Mon 1 Sep – Fri 5 Sep", async () => {
    const p = payrollPeriodFor(at("2025-09-11"));
    expect(ymd(p.periodStart)).toBe("2025-09-01");
    expect(ymd(p.periodEnd)).toBe("2025-09-05");
    expect(ymd(p.payDate)).toBe("2025-09-11");
  });

  it("the period is five days: Monday to Friday, no weekend", () => {
    const p = payrollPeriodFor(at("2025-09-11"));
    expect(p.periodStart.getDay()).toBe(1); // Monday
    expect(p.periodEnd.getDay()).toBe(5); // Friday
    expect(daysBetween(p.periodStart, p.periodEnd)).toBe(4); // Mon..Fri inclusive = 5 days
  });

  it("starts at midnight and ends at the last millisecond of the Friday", () => {
    const p = payrollPeriodFor(at("2025-09-11"));
    expect([p.periodStart.getHours(), p.periodStart.getMinutes(), p.periodStart.getSeconds()]).toEqual([0, 0, 0]);
    expect([p.periodEnd.getHours(), p.periodEnd.getMinutes(), p.periodEnd.getSeconds()]).toEqual([23, 59, 59]);
    expect(p.periodEnd.getMilliseconds()).toBe(999);
  });

  it("SATURDAY AND SUNDAY BELONG TO NO PERIOD — they are never folded backwards", () => {
    // Saturday 6 September is the day after the Mon-1-to-Fri-5 week closed.
    const saturday = at("2025-09-06");
    const thatWeek = payrollPeriodFor(at("2025-09-11"));
    expect(saturday.getTime()).toBeGreaterThan(thatWeek.periodEnd.getTime());

    // It falls inside the NEXT cycle instead: Thu 18 Sep, period Mon 8 – Fri 12.
    const nextWeek = payrollPeriodFor(at("2025-09-18"));
    expect(ymd(nextWeek.periodStart)).toBe("2025-09-08");
    expect(ymd(nextWeek.periodEnd)).toBe("2025-09-12");
    expect(saturday.getTime()).toBeLessThan(nextWeek.periodEnd.getTime());
  });

  it("a period never ends on or after its own pay date", () => {
    // Five clear days between the Friday that closes the week and the Thursday
    // that pays it — the window funding is confirmed in.
    for (const d of ["2025-09-11", "2025-09-18", "2026-01-01", "2026-09-03"]) {
      const p = payrollPeriodFor(at(d));
      expect(p.periodEnd.getTime()).toBeLessThan(p.payDate.getTime());
      // Friday → the following Thursday: Sat, Sun, Mon, Tue, Wed are the five
      // clear days in which funding is confirmed and the run reviewed.
      expect(daysBetween(p.periodEnd, p.payDate)).toBe(6);
    }
  });

  it("snaps back to the pay day, so any day of the week names the same period", () => {
    // Wed 10 Sep is BEFORE that Thursday's run — it belongs to the previous cycle.
    const wed = payrollPeriodFor(at("2025-09-10"));
    expect(ymd(wed.payDate)).toBe("2025-09-04");
    expect(ymd(wed.periodStart)).toBe("2025-08-25");
    expect(ymd(wed.periodEnd)).toBe("2025-08-29");

    // Fri 12, Sat 13 and Sun 14 are after Thursday 11 — same period as it.
    for (const d of ["2025-09-12", "2025-09-13", "2025-09-14"]) {
      const p = payrollPeriodFor(at(d));
      expect(ymd(p.payDate)).toBe("2025-09-11");
      expect(ymd(p.periodStart)).toBe("2025-09-01");
    }
  });

  it("consecutive pay days cover consecutive workweeks, with the weekend between", () => {
    const a = payrollPeriodFor(at("2025-09-11"));
    const b = payrollPeriodFor(at("2025-09-18"));
    expect(ymd(b.periodStart)).toBe("2025-09-08");
    // Three days from Friday to the next Monday: the weekend sits between the
    // periods and is inside neither.
    expect(daysBetween(a.periodEnd, b.periodStart)).toBe(3);
  });

  it("crosses a year boundary without losing a week", () => {
    // Thu 1 Jan 2026 pays the last full workweek of 2025.
    const p = payrollPeriodFor(at("2026-01-01"));
    expect(ymd(p.periodStart)).toBe("2025-12-22");
    expect(ymd(p.periodEnd)).toBe("2025-12-26");
    expect(p.label).toBe("Week of 22 Dec 2025");
  });

  it("names the run after the Monday it starts", () => {
    expect(payrollLabel(at("2025-09-01", 0))).toBe("Week of 1 Sep 2025");
    expect(payrollPeriodFor(at("2025-09-11")).label).toBe("Week of 1 Sep 2025");
  });

  it("currentPayrollPeriod is the period for today's cycle", () => {
    const now = at("2025-09-13");
    expect(currentPayrollPeriod(now)).toEqual(payrollPeriodFor(now));
  });
});

describe("toDateInputValue", () => {
  it("formats local calendar days, not UTC ones", () => {
    // Late-evening local time is the NEXT day in UTC; a toISOString() slice
    // would hand the date input tomorrow and shift the whole period.
    expect(toDateInputValue(new Date(2026, 7, 24, 23, 30))).toBe("2026-08-24");
    expect(toDateInputValue(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
  });
});
