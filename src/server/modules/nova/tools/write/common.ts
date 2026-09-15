import { formatDay } from "../../format";
import { z } from "../define";

export const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
export const WHEN = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm, 24-hour.");

/** A due date as a calendar day, the way the task pickers store it — not an instant. */
export const dayWords = (day: string) => formatDay(new Date(`${day}T12:00:00Z`), "UTC");

export const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/**
 * The portal actions Nova calls return no id for what they create, so the row
 * is found again by what was written, by this user, just now. The margin
 * covers clock skew between the app and the database.
 */
export const justNow = (startedAt: Date) => ({ gte: new Date(startedAt.getTime() - 5_000) });

export const DEAL_GONE = { ok: false as const, reason: "not_found" as const, message: "That deal no longer exists." };

/** A spoken option against a configured label: case, dashes and punctuation ignored. */
export function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}
