/**
 * When payroll runs, and what week it pays for.
 *
 * Pure date arithmetic — no database, no session, importable from a client
 * component so the "New payroll run" form opens on the right week instead of
 * asking somebody to remember it.
 *
 * ── THE SCHEDULE ───────────────────────────────────────────────────────────
 * Payroll is calculated on THURSDAY and pays the PRIOR WORKWEEK: MONDAY to
 * FRIDAY of the week before. Thursday 11 September pays Monday 1 September
 * through Friday 5 September. The five clear days between the Friday that
 * closes the week and the Thursday that pays it are the window in which
 * funding is confirmed and the run is reviewed.
 *
 * ── THE WEEKEND IS IN NO PERIOD, AND THAT IS THE POINT ─────────────────────
 * A workweek is Monday to Friday, so Saturday and Sunday fall outside every
 * period. An M1 confirmed on Saturday 6 September is NOT quietly folded back
 * into the Monday-1-to-Friday-5 week that had already closed the day before —
 * it is simply not in it. It lands on the next applicable cycle instead:
 * Thursday 18 September, whose period runs to Friday 12 September and whose
 * sweep has no lower bound. See `payables.ts`.
 *
 * ── THE PERIOD IS A CEILING, NOT A WINDOW ──────────────────────────────────
 * A commission is picked up by the first run whose period ENDS on or after the
 * day it was approved — there is no lower bound. That is deliberate and it is
 * what makes a late M1 safe: funding approved too late for one Thursday is
 * swept up by the next. Nothing "misses" a payroll and drops out of existence,
 * and no day of the week can strand money. The same property is what lets a
 * deleted run's lines be re-batched weeks later.
 *
 * The three constants below are the whole schedule. A different pay day or a
 * different workweek is an edit to them and nothing else.
 */

/** 0 = Sunday … 6 = Saturday. */
const PAY_DAY = 4; // Thursday
const WORKWEEK_START = 1; // Monday
const WORKWEEK_END = 5; // Friday

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** The pay Thursday on or before `d`. */
function payDayOnOrBefore(d: Date): Date {
  const day = startOfDay(d);
  const back = (day.getDay() - PAY_DAY + 7) % 7;
  return new Date(day.getTime() - back * DAY_MS);
}

export type PayrollPeriod = {
  /** Monday 00:00:00.000 of the workweek being paid. */
  periodStart: Date;
  /** Friday 23:59:59.999 of the workweek being paid. */
  periodEnd: Date;
  /** The Thursday the run is cut. */
  payDate: Date;
  /** What the run is called, e.g. "Week of 25 Aug 2026". */
  label: string;
};

/**
 * The period a run cut on `payDate` pays for.
 *
 * `payDate` is snapped back to its own pay day, so passing any day of the week
 * gives the period that week's Thursday pays — a run prepared on Wednesday and
 * cut on Thursday describes the same week.
 */
export function payrollPeriodFor(payDate: Date): PayrollPeriod {
  const thursday = payDayOnOrBefore(payDate);

  // Walk back to the FRIDAY that closed the prior workweek. `|| 7` forces a
  // full week when the pay day is itself the workweek's last day, so a period
  // can never end on its own pay date.
  const backToFriday = (thursday.getDay() - WORKWEEK_END + 7) % 7 || 7;
  const friday = startOfDay(new Date(thursday.getTime() - backToFriday * DAY_MS));

  // …and back across the workweek to its Monday. Five days inclusive, so four
  // days back — the weekend is outside the period on both ends.
  const workweekDays = ((WORKWEEK_END - WORKWEEK_START + 7) % 7) + 1;
  const periodStart = startOfDay(new Date(friday.getTime() - (workweekDays - 1) * DAY_MS));

  return {
    periodStart,
    periodEnd: endOfDay(friday),
    payDate: thursday,
    label: payrollLabel(periodStart),
  };
}

/** The period the NEXT run to be cut will pay for, given "now". */
export function currentPayrollPeriod(now: Date = new Date()): PayrollPeriod {
  return payrollPeriodFor(now);
}

/** "Week of 25 Aug 2026" — the run's name, stable and sortable by eye. */
export function payrollLabel(periodStart: Date): string {
  const d = periodStart.getDate();
  const m = periodStart.toLocaleString("en-US", { month: "short" });
  return `Week of ${d} ${m} ${periodStart.getFullYear()}`;
}

/** `YYYY-MM-DD` in LOCAL time — what a date input wants, without a UTC shift. */
export function toDateInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
