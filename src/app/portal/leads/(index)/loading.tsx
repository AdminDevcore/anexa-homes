import { PageSkeleton } from "@/components/portal/page-skeleton";

/**
 * The appointments list, in a route group so this boundary covers the LIST and
 * nothing else.
 *
 * A `loading.tsx` at `leads/` would sit above `leads/[id]` as well, and a
 * Suspense boundary above a route flushes the shell — and the 200 with it —
 * before that route can call `notFound()`. That is what made a deal nobody may
 * see render as blank chrome instead of a 404. The `(index)` group keeps the
 * skeleton on the screen that wants one without putting a boundary over the
 * screens that must be able to refuse.
 */
export default function LeadsLoading() {
  return <PageSkeleton />;
}
