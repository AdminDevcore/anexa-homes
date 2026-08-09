import { runTaskReminders } from "@/server/modules/tasks/reminders";
import { runUnscoped } from "@/server/vertical/context";

// Weekly open-task reminder digest. Vercel Cron calls this with
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    // A cron has no session and therefore no active workspace, so the isolation
    // extension refuses every Task read with MissingVerticalContextError — this
    // digest has been failing since the multi-workspace flag went on, quietly,
    // because the catch below turns it into a logged 500.
    //
    // Unscoped is the right answer rather than looping per workspace: the digest
    // is "here is everything still open, assigned to you", one email per person.
    // Splitting it by workspace would send a dual-workspace employee two emails
    // that each look like their whole list.
    const result = await runUnscoped(
      "cron: weekly open-task digest, every workspace",
      () => runTaskReminders()
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:task-reminders] failed", err);
    return new Response("Error", { status: 500 });
  }
}
