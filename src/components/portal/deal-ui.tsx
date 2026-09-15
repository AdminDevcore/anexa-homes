import { cn } from "@/lib/utils";
import { FoldableCard } from "@/components/portal/deal-card-fold";

/**
 * The card / label / value vocabulary of the deal detail page.
 *
 * These lived as private helpers at the bottom of `leads/[id]/page.tsx`, which
 * meant the Solar redesign could only restyle them by restyling Roofing too.
 *
 * Extracted as a FAITHFUL move: with no props beyond the original ones, every
 * one of these renders byte-identical markup to what it replaced, so the Roofing
 * deal page is untouched. The Solar look is opt-in through `tone="solar"` and
 * the additive slots below. That is deliberate — a shared primitive that
 * silently restyles the other vertical is how a scoped redesign becomes an
 * unscoped one.
 *
 * Deliberately server components (no "use client"): they render inside an async
 * server page and take an icon *component* as a prop, which cannot cross the RSC
 * boundary into a client module.
 */

type IconType = React.ComponentType<{ className?: string }>;

/** Which accent tints a card. Solar deals read sky, roofing reads brand orange. */
export type DealTone = "brand" | "solar";

export function Card({
  title,
  icon: Icon,
  tone = "brand",
  description,
  action,
  bodyClassName,
  className,
  foldKey,
  children,
}: {
  title?: string;
  icon?: IconType;
  tone?: DealTone;
  description?: string;
  /** Right-aligned header slot — a toggle, a filter, one small button. */
  action?: React.ReactNode;
  bodyClassName?: string;
  className?: string;
  /**
   * An arrow at the top right that folds the card down to its header,
   * remembered per browser under this key. Opt-in, and only on a titled card:
   * without it a card renders exactly the markup it always has.
   */
  foldKey?: string;
  children: React.ReactNode;
}) {
  const solar = tone === "solar";
  const sectionClassName = cn(
    "rounded-xl border border-border bg-card",
    // Solar-only lift. Roofing keeps the flat card it has today.
    solar && "overflow-hidden shadow-sm",
    className
  );
  const headerClassName = cn(
    "border-b border-border px-5 py-3.5",
    solar
      ? // min-w-0 is load-bearing: this card sits in a grid column whose
        // automatic minimum size is the min-content width of its
        // contents, and without it the header's text sets a floor that
        // makes the whole column overflow the viewport on a phone.
        "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2"
      : "flex items-center gap-2"
  );
  const solarTitle = (
    <div className="flex min-w-0 items-center gap-2.5">
      {Icon && (
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-solar/10 text-solar">
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <h2 className="truncate font-semibold tracking-tight">{title}</h2>
        {description && (
          // Clamped, never `truncate`. `truncate` implies
          // white-space: nowrap, whose min-content width is the WHOLE
          // sentence — enough to blow out the page on a phone. A clamp
          // wraps (min-content = longest word) and still can't grow
          // the header unboundedly.
          <p className="line-clamp-2 text-xs font-normal text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );

  if (foldKey && title) {
    return (
      <FoldableCard
        foldKey={foldKey}
        label={title}
        className={sectionClassName}
        headerClassName={headerClassName}
        header={
          solar ? (
            solarTitle
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              {Icon && <Icon className="size-4 shrink-0 text-gold" />}
              <div className="min-w-0">
                <h2 className="font-semibold">{title}</h2>
                {description && (
                  <p className="line-clamp-2 text-xs font-normal text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
          )
        }
        action={action}
        bodyClassName={cn("p-5", bodyClassName)}
      >
        {children}
      </FoldableCard>
    );
  }

  return (
    <section className={sectionClassName}>
      {title && (
        <header className={headerClassName}>
          {solar ? (
            <>
              {solarTitle}
              {action}
            </>
          ) : (
            <>
              {Icon && <Icon className="size-4 shrink-0 text-gold" />}
              {/* Only wrap when there IS a description, so the many existing
                  brand cards that pass none keep their exact markup. */}
              {description ? (
                <div className="min-w-0">
                  <h2 className="font-semibold">{title}</h2>
                  <p className="line-clamp-2 text-xs font-normal text-muted-foreground">
                    {description}
                  </p>
                </div>
              ) : (
                <h2 className="font-semibold">{title}</h2>
              )}
              {action && <div className="ml-auto">{action}</div>}
            </>
          )}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * A labelled fact. The label is small, uppercase and muted; the value carries
 * the weight — the reason a deal page can be scanned rather than read.
 */
export function Detail({
  icon: Icon,
  label,
  value,
  full,
  /**
   * The original capitalised every value, which is right for enum-ish strings
   * ("not filed") and wrong for an email address. Defaults to the old behaviour.
   */
  capitalize = true,
}: {
  icon?: IconType;
  label: string;
  value: React.ReactNode;
  full?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className={cn("mt-1 font-medium", capitalize && "capitalize")}>{value}</div>
    </div>
  );
}

/** A titled block inside a card, for grouping without nesting another card. */
export function Section({
  icon: Icon,
  label,
  tone = "brand",
  action,
  children,
}: {
  icon?: IconType;
  label: string;
  tone?: DealTone;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {Icon && (
            <Icon className={cn("size-4", tone === "solar" ? "text-solar" : "text-gold")} />
          )}
          {label}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
