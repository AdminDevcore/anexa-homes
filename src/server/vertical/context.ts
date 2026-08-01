import { cache } from "react";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Vertical } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";

/**
 * Resolves "which vertical is this database call acting in?".
 *
 * Two sources, in priority order:
 *
 *  1. An explicit override set with runInVertical() / runUnscoped(). This is how
 *     code that has no HTTP request scope declares its intent: cron jobs, the
 *     website intake action, public token pages (/sign, /present, /bid), seeds
 *     and tests.
 *
 *  2. The active request's session + workspace cookie. This covers every server
 *     component, server action and route handler in the portal, which is the
 *     overwhelming majority of the 900+ query sites — they get scoping without
 *     changing a single line.
 *
 * If neither resolves and the model is vertical-scoped, the query throws rather
 * than guessing. Guessing is how data crosses workspaces.
 *
 * AsyncLocalStorage is used only for the explicit override, never as the primary
 * path, so we are not relying on ALS propagating across React Server Component
 * boundaries.
 */

type Override =
  | { mode: "vertical"; vertical: ActiveVertical }
  | { mode: "unscoped"; reason: string };

const storage = new AsyncLocalStorage<Override>();

export type Resolution =
  | { mode: "vertical"; vertical: ActiveVertical }
  | { mode: "unscoped"; reason: string }
  | { mode: "none" };

/** Raised whenever a query would read or write outside its vertical. */
export class CrossVerticalAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossVerticalAccessError";
  }
}

/** Raised when a vertical-scoped model is touched with no resolvable vertical. */
export class MissingVerticalContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingVerticalContextError";
  }
}

/**
 * Run `fn` with an explicit active vertical. Use for any code path that has no
 * portal session: cron routes, public token pages, the website intake action,
 * background jobs, seeds.
 */
export async function runInVertical<T>(
  vertical: ActiveVertical,
  fn: () => T | Promise<T>
): Promise<T> {
  // The `await` here is load-bearing, not stylistic.
  //
  // Prisma promises are LAZY: `prisma.lead.findMany()` builds a thenable and
  // does not touch the database until something subscribes to it. If we merely
  // returned `fn()`, AsyncLocalStorage.run() would have already exited by the
  // time the caller awaited, the query would execute with no store, and the
  // extension would see an empty context — silently unscoped.
  //
  // Awaiting inside the callback subscribes to the promise while still in the
  // ALS scope, so the query executes in context. Covered by every case in
  // src/server/vertical/__tests__/isolation.itest.ts.
  return storage.run({ mode: "vertical", vertical }, async () => await fn());
}

/**
 * Run `fn` with vertical filtering switched off, for the reads that are
 * legitimately company-wide: the employee roster, consolidated payroll, the
 * general ledger, company P&L rollups, and single-row lookups by unguessable
 * token that must find the row before its vertical is known.
 *
 * `reason` is required and is surfaced in audit logs — an unscoped read should
 * always be able to explain itself.
 */
export async function runUnscoped<T>(reason: string, fn: () => T | Promise<T>): Promise<T> {
  // Awaited inside the scope for the same lazy-promise reason as runInVertical.
  return storage.run({ mode: "unscoped", reason }, async () => await fn());
}

/**
 * Escape hatch for raw SQL that has been reviewed and cannot cross a vertical
 * boundary. The Prisma extension does not see $queryRaw/$executeRaw at all, so
 * this does not change behaviour — it exists to make the intent greppable and
 * to satisfy the CI guard in src/lib/__tests__/no-raw-sql.test.ts.
 */
export async function rawUnscoped<T>(reason: string, fn: () => T | Promise<T>): Promise<T> {
  return runUnscoped(`raw-sql: ${reason}`, fn);
}

/** The explicit override in force, if any. */
export function currentOverride(): Override | undefined {
  return storage.getStore();
}

/**
 * The session+cookie path, memoised for the lifetime of one request.
 *
 * This runs on EVERY query against a scoped model, and a page can issue
 * hundreds. React's cache() dedupes it to a single resolution per request;
 * without it the per-query async overhead measurably slowed the whole app
 * (~15-25% on a full E2E run), which is a real cost to pay for a value that
 * cannot change mid-request.
 *
 * Outside a React request scope (cron, scripts, tests) cache() degrades to a
 * plain call, which is correct — those paths use runInVertical()/runUnscoped()
 * and never reach here.
 */
const resolveFromRequest = cache(async (): Promise<Resolution> => {
  // Dynamic import breaks the module cycle db/client -> extension -> context ->
  // auth/session -> db/client. By the time this runs every module is loaded.
  try {
    const { getSessionUser } = await import("@/server/auth/session");
    const user = await getSessionUser();
    if (!user) return { mode: "none" };
    const { getActiveVertical } = await import("@/server/auth/vertical");
    return { mode: "vertical", vertical: await getActiveVertical(user) };
  } catch {
    // No request scope (cron, script, worker, unit test) or the session read
    // failed. Not an error here — the extension decides.
    return { mode: "none" };
  }
});

/**
 * Resolve the vertical for the current call. Never throws: the caller (the
 * Prisma extension) decides what a missing context means for the model at hand.
 */
export async function resolveVertical(): Promise<Resolution> {
  // An explicit override always wins and is a synchronous store read, so it
  // short-circuits before any of the memoised work below.
  const override = storage.getStore();
  if (override) return override;
  return resolveFromRequest();
}

/**
 * Narrow a Vertical from the DB (which may be a retired value like `others`) to
 * an active one, for the runInVertical() calls that derive their vertical from
 * a row they just read.
 */
export function asActiveVertical(v: Vertical): ActiveVertical {
  return v === "solar" ? "solar" : "roofing";
}
