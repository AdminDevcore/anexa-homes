import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One row of filter choices, each a link: filters live in the URL and are read
 * on the server. "All" is the `null` option.
 */
export function FilterChips({
  label,
  options,
  active,
  hrefFor,
}: {
  label: string;
  options: { value: string | null; label: string }[];
  active: string | null;
  hrefFor: (value: string | null) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden className="mr-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {options.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={o.value ?? "all"}
            href={hrefFor(o.value)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              isActive
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
