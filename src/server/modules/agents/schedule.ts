import { Cron } from "croner";

/**
 * Agent schedules: 5-field cron expressions, evaluated in UTC like every entry
 * in vercel.json.
 *
 * croner also accepts 6- and 7-field patterns (seconds, years). Those are
 * refused here rather than passed through: the tick runs once a minute, so a
 * seconds field would promise something the runner can never deliver.
 *
 * Every Cron is built `paused` — these objects only answer "when next", they
 * never schedule anything themselves.
 */

const OPTIONS = { paused: true, timezone: "UTC" } as const;

export const SCHEDULE_PRESETS = [
  { label: "Every 5 minutes", schedule: "*/5 * * * *" },
  { label: "Every 15 minutes", schedule: "*/15 * * * *" },
  { label: "Every 30 minutes", schedule: "*/30 * * * *" },
  { label: "Hourly", schedule: "0 * * * *" },
  { label: "Daily at 13:00 UTC", schedule: "0 13 * * *" },
  { label: "Weekdays at 13:00 UTC", schedule: "0 13 * * 1-5" },
] as const;

export function validateSchedule(
  expr: string
): { ok: true; schedule: string } | { ok: false; error: string } {
  const schedule = expr.trim().replace(/\s+/g, " ");
  if (schedule.split(" ").length !== 5) {
    return { ok: false, error: "Use a 5-field cron expression: minute hour day month weekday." };
  }
  try {
    const next = new Cron(schedule, OPTIONS).nextRun(new Date());
    if (!next) return { ok: false, error: "That schedule never runs." };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Not a valid cron expression: ${why}` };
  }
  return { ok: true, schedule };
}

/** The next run strictly after `from`, or null when the expression is unusable. */
export function nextRunAfter(schedule: string, from: Date): Date | null {
  try {
    return new Cron(schedule, OPTIONS).nextRun(from);
  } catch {
    return null;
  }
}

export function nextRuns(schedule: string, from: Date, n: number): Date[] {
  try {
    return new Cron(schedule, OPTIONS).nextRuns(n, from);
  } catch {
    return [];
  }
}

/**
 * The next runs from now. A named helper rather than `new Date()` at the call
 * site: the React purity lint rule refuses an impure call during render, and
 * the config form previews these while the user types.
 */
export function upcomingRuns(schedule: string, n: number): Date[] {
  return nextRuns(schedule, new Date(), n);
}

/** What `Agent.nextRunAt` should hold. */
export function nextRunAtFor(
  agent: { enabled: boolean; schedule: string | null },
  now: Date
): Date | null {
  return agent.enabled && agent.schedule ? nextRunAfter(agent.schedule, now) : null;
}

export function describeSchedule(schedule: string | null): string {
  if (!schedule) return "Not scheduled";
  return SCHEDULE_PRESETS.find((p) => p.schedule === schedule)?.label ?? "Custom";
}
