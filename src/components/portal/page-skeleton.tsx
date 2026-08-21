import { Skeleton } from "@/components/ui/skeleton";

/**
 * What a portal page shows while the server is still building it.
 *
 * Next's App Router blocks the navigation until the RSC payload arrives unless
 * a route has a loading boundary. With none anywhere in the portal, clicking a
 * nav item did nothing at all — the old page just sat there, for as long as the
 * query took — and an interface that does nothing when you click it reads as
 * broken long before it reads as slow.
 *
 * The shape matters: a skeleton that mirrors the page about to arrive makes the
 * swap feel like the content resolving, while a spinner makes it feel like a
 * wait. Same duration, different experience.
 */
export function PageSkeleton({
  rows = 6,
  layout = "table",
}: {
  rows?: number;
  layout?: "table" | "cards" | "detail";
}) {
  return (
    <div className="animate-in fade-in duration-200">
      {/* Page title + action */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-3.5 w-36" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {layout === "table" && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
          <div className="overflow-hidden rounded-xl border border-border">
            <Skeleton className="h-11 w-full rounded-none opacity-60" />
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-t border-border px-4 py-3.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-52" />
                <Skeleton className="ml-auto h-5 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            ))}
          </div>
        </div>
      )}

      {layout === "cards" && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-28" />
              <Skeleton className="mt-2 h-3 w-16" />
            </div>
          ))}
        </div>
      )}

      {layout === "detail" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      )}
    </div>
  );
}
