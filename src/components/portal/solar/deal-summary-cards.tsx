import { cn } from "@/lib/utils";

/**
 * The five facts a solar deal is judged on, directly under the customer name.
 *
 * The point is that a coordinator opening a deal should not have to scroll or
 * open a tab to answer "where is it, who is funding it, how big is it, and who
 * owns it". Everything here already existed on the page — it was just spread
 * across a sidebar, a tab and a card body.
 *
 * A card with no value is NOT rendered. An empty tile reads as "we don't know"
 * with the same visual weight as a real answer, which is worse than absence.
 */

export type SummaryCard = {
  label: string;
  value: string;
  /** Secondary line — credit status, days in stage, panel count. */
  hint?: string;
  /** Accent bar colour. Defaults to the Solar workspace accent. */
  accent?: string;
};

export function SolarSummaryCards({ cards }: { cards: SummaryCard[] }) {
  if (cards.length === 0) return null;

  return (
    <dl
      data-testid="solar-summary-cards"
      // Flex, not a fixed grid: the number of cards varies from two to five
      // depending on what the deal knows, and `grid-cols-5` with four cards
      // leaves a conspicuous hole at the end of the row. `flex-1` off a 220px
      // basis fills the row evenly at any count and wraps on its own.
      className="flex flex-wrap gap-3"
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            "relative flex-1 basis-[220px] overflow-hidden rounded-xl border border-border",
            "bg-card py-3.5 pl-5 pr-4 shadow-sm"
          )}
        >
          {/* The thin accent bar. An inline style is correct here: the stage
              colour is per-deal DATA from the pipeline, not a design token. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1"
            style={{ background: c.accent ?? "var(--solar)" }}
          />
          <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {c.label}
          </dt>
          <dd className="mt-1">
            <span
              title={c.value}
              className="block truncate font-display text-lg font-semibold tracking-tight"
            >
              {c.value}
            </span>
            {c.hint && (
              // No `capitalize` here: it title-cases every word, turning
              // "Step 13 of 25" into "Step 13 Of 25". Callers pass hints
              // already cased the way they should read.
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {c.hint}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
