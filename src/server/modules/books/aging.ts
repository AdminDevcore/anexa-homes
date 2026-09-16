/**
 * AGING BUCKETS — shared by what we owe (A/P) and what we are owed (A/R).
 *
 * Both schedules answer the same question in opposite directions: how late is
 * it, counted from the DUE date. Keeping one definition means A/R and A/P can
 * never disagree about where the boundary between "31–60" and "61–90" sits,
 * which is the sort of quiet difference that makes two reports built from the
 * same ledger fail to tie out.
 *
 * A row with NO due date is "Current", not infinitely overdue. No due date
 * means nobody recorded terms — not that payment was due the day it arrived.
 */

export type AgingBucket = "Current" | "1–30" | "31–60" | "61–90" | "90+";

export const AGING_BUCKETS: readonly AgingBucket[] = [
  "Current",
  "1–30",
  "31–60",
  "61–90",
  "90+",
] as const;

const DAY = 86_400_000;

/** Whole days past due as of `asOf`. Negative (not yet due) reads as 0. */
export function daysOverdue(dueAt: Date | null | undefined, asOf: Date): number {
  if (!dueAt) return 0;
  return Math.floor((asOf.getTime() - dueAt.getTime()) / DAY);
}

export function bucketFor(daysOver: number): AgingBucket {
  if (daysOver <= 0) return "Current";
  if (daysOver <= 30) return "1–30";
  if (daysOver <= 60) return "31–60";
  if (daysOver <= 90) return "61–90";
  return "90+";
}

/** A zeroed tally with every bucket present, so a bucket with nothing in it
 * still prints as $0.00 rather than vanishing from the report. */
export function emptyBucketTotals(): Record<AgingBucket, number> {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
}
