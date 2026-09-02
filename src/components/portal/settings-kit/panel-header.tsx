import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The head of a settings panel: what this screen is, what state it is in, and
 * the one or two things you can do to the whole of it.
 *
 * The pills are the part worth keeping honest. They say what is true right now
 * — "12 sources", "no programmes", "3 awaiting approval" — so the answer to
 * "is this set up?" is on the screen rather than something you work out by
 * reading the form underneath.
 */
export function PanelHeader({
  icon: Icon,
  title,
  description,
  pills,
  actions,
  mark,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  pills?: React.ReactNode;
  actions?: React.ReactNode;
  /** Used in place of the icon when the thing has a face of its own (a logo). */
  mark?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start gap-3 border-b border-border pb-4",
        className
      )}
    >
      {mark ??
        (Icon && (
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
            <Icon className="size-5" />
          </span>
        ))}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
        {pills && <div className="mt-2 flex flex-wrap items-center gap-1.5">{pills}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
