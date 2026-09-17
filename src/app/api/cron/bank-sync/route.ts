import { NextResponse } from "next/server";
import { runUnscoped } from "@/server/vertical/context";
import { assertCronRequest } from "@/server/auth/cron";
import { syncAllConnections } from "@/server/modules/bank-feeds/sync";

/**
 * Pull every active bank connection.
 *
 * ── WHY THE CRON IS THE GUARANTEE ───────────────────────────────────────────
 * Webhooks are the fast path, not the reliable one. Plaid does not replay
 * deliveries missed while we were down, and a deploy that 404s for thirty
 * seconds is enough to lose one. A feed that only updated on a webhook would
 * therefore be silently stale, which is indistinguishable from a bank with no
 * activity — the failure mode the Amos runbook describes almost exactly.
 *
 * So the sweep is the guarantee and the webhook is the latency improvement.
 *
 * ── UNSCOPED ────────────────────────────────────────────────────────────────
 * This crosses every company and has no workspace of its own; a cron has no
 * async-local context for the isolation extension to read. The rows it touches
 * are SHARED by classification, so there is nothing to stamp.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;

  const { synced, results } = await runUnscoped(
    "bank sync: sweep every company's active connections",
    () =>
      syncAllConnections({
        // No user did this. A system actor is named rather than borrowing
        // somebody's id, so the audit trail says what actually happened.
        actor: { kind: "system", label: "cron:bank-sync" },
      })
  );

  const failed = results.filter((r) => r.error);
  // Loud: a connection that will not sync is a set of books quietly going stale.
  for (const f of failed) {
    console.error(`[cron:bank-sync] connection ${f.connectionId}: ${f.error}`);
  }

  return NextResponse.json({
    ok: true,
    synced,
    added: results.reduce((s, r) => s + r.added, 0),
    modified: results.reduce((s, r) => s + r.modified, 0),
    removed: results.reduce((s, r) => s + r.removed, 0),
    // A connection with pages left is picked up on the next run rather than
    // holding this one open past the function ceiling.
    incomplete: results.filter((r) => r.hasMore).length,
    failed: failed.length,
  });
}
