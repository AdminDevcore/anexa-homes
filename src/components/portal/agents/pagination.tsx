import Link from "next/link";

/** Previous / Next for a server-rendered list. Not drawn when there is one page. */
export function Pagination({
  page,
  pageCount,
  total,
  noun,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  noun: string;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const step = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{`Page ${page} of ${pageCount} · ${total} ${noun}`}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={`${step} hover:bg-muted/40`}>
            Previous
          </Link>
        ) : (
          <span className={`${step} text-muted-foreground opacity-50`}>Previous</span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={`${step} hover:bg-muted/40`}>
            Next
          </Link>
        ) : (
          <span className={`${step} text-muted-foreground opacity-50`}>Next</span>
        )}
      </div>
    </nav>
  );
}
