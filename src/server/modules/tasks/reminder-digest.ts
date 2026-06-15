// Pure digest builders for the weekly task-reminder cron. No DB / IO imports so
// this stays unit-testable in isolation (the orchestrator in reminders.ts wires
// these to Prisma + email).

const DAY_MS = 24 * 60 * 60 * 1000;

export type DigestTask = {
  title: string;
  dealName: string;
  createdAt: Date;
  dueAt: Date | null;
};

export const ageDays = (createdAt: Date, now: number) => Math.max(0, Math.floor((now - createdAt.getTime()) / DAY_MS));
export const isOverdue = (dueAt: Date | null, now: number) => dueAt != null && dueAt.getTime() < now;
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** A single rep's digest: their open tasks oldest-first, overdue flagged. */
export function buildRepDigest(tasks: DigestTask[], now: number): { heading: string; lines: string[]; overdue: number } {
  const overdue = tasks.filter((t) => isOverdue(t.dueAt, now)).length;
  const sorted = [...tasks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // oldest first
  const lines = sorted.map((t) => {
    const age = `open ${ageDays(t.createdAt, now)}d`;
    const due = t.dueAt ? (isOverdue(t.dueAt, now) ? ` · ⚠ overdue (due ${fmtDate(t.dueAt)})` : ` · due ${fmtDate(t.dueAt)}`) : "";
    return `${t.title} — ${t.dealName} · ${age}${due}`;
  });
  const heading = `You have ${tasks.length} open follow-up${tasks.length === 1 ? "" : "s"} (${overdue} overdue)`;
  return { heading, lines, overdue };
}

export type RepRollup = { name: string; count: number; overdue: number; oldestDays: number };

/** A manager/admin rollup: one line per rep, most-stale first. */
export function buildManagerRollup(reps: RepRollup[]): { heading: string; lines: string[]; total: number } {
  const total = reps.reduce((s, r) => s + r.count, 0);
  const lines = [...reps]
    .sort((a, b) => b.oldestDays - a.oldestDays || b.overdue - a.overdue)
    .map((r) => `${r.name} — ${r.count} open, ${r.overdue} overdue, oldest ${r.oldestDays}d`);
  const heading = `${total} open follow-up${total === 1 ? "" : "s"} across your team`;
  return { heading, lines, total };
}
