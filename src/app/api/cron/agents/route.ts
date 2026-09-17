import { runUnscoped } from "@/server/vertical/context";
import { assertCronRequest } from "@/server/auth/cron";
import { tick } from "@/server/modules/agents/tick";

// Agents: every minute, run whatever is due. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>`; it refuses when CRON_SECRET is unset.
//
// 300 s is the limit src/server/modules/agents/budget.ts is built on, and a
// test reads this file to make sure the two agree. Unscoped only to FIND the
// work: every handler, change and alert runs inside its own run's workspace.
//
// VERIFY ANY CHANGE ON A PRODUCTION BUILD. `next dev` loads context.ts twice,
// so runInVertical silently no-ops there.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    const report = await runUnscoped("cron: agents tick, every company and workspace", () => tick(new Date()));
    return Response.json({ ok: true, ...report });
  } catch (err) {
    console.error("[cron:agents] failed", err);
    return new Response("Error", { status: 500 });
  }
}
