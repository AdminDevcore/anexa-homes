import Link from "next/link";
import { FileQuestion } from "lucide-react";

/**
 * What every `notFound()` under /portal renders.
 *
 * Before this existed the answer was nothing at all: Next fell back to its own
 * bare 404 document, and because a Suspense boundary had already flushed the
 * portal shell, what a rep actually saw was the sidebar and header wrapped
 * around an empty <main> — no record, no message, nothing to click. A refusal
 * that looks like a broken page gets reported as a bug and erodes trust in the
 * screens that are working.
 *
 * It says "not found" and nothing more specific ON PURPOSE. A record that does
 * not exist and a record belonging to another rep have to be indistinguishable,
 * or the message itself becomes the leak: a rep who guesses ids could tell the
 * two apart and learn which ones are real. Same words, same status, both times.
 */
export default function PortalNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full border border-border/70 bg-muted/40 p-4">
        <FileQuestion className="size-7 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold">Not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This page does not exist, or it belongs to a record you do not have access to. If you
        expected to see something here, ask an admin to check it is assigned to you.
      </p>
      <Link
        href="/portal/dashboard"
        className="mt-6 inline-flex items-center rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
