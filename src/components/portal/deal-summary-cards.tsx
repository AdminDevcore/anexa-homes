import { cn } from "@/lib/utils";

/**
 * The handful of facts a deal is judged on, directly under the customer name.
 *
 * The point is that whoever opens a deal should not have to scroll or open a
 * tab to answer "where is it, who owns it, what is it worth". Everything here
 * already existed on the page — it was just spread across a sidebar, a tab and
 * a card body.
 *
 * Two ways to be empty, and they mean different things:
 *
 *  • Card omitted entirely — this fact does not apply to this deal.
 *  • Card present with `value: null` — this fact applies and is not decided
 *    yet. The tile keeps its slot and shows a muted placeholder, so a header
 *    does not reflow from three cards to four the moment a lender is picked.
 *
 * Solar uses the second kind for its fixed four (stage, size, lender, rep):
 * a row whose columns move around as a deal fills in reads as unfinished
 * software, not as a deal with unfinished fields.
 *
 * Vertical-agnostic by construction: it takes a list of already-formatted
 * facts and an accent, so Solar and Roofing share one row rather than growing
 * two that drift apart.
 */

export type SummaryCard = {
  label: string;
  /** `null` keeps the slot and shows the placeholder — see the note above. */
  value: string | null;
  /** Secondary line — credit status, days in stage, panel count. */
  hint?: string;
  /** Per-card accent override, e.g. a pipeline stage's own colour. */
  accent?: string;
};

export function DealSummaryCards({
  cards,
  accent = "var(--gold)",
}: {
  cards: SummaryCard[];
  /** The workspace accent: `var(--solar)` on solar, brand orange on roofing. */
  accent?: string;
}) {
  if (cards.length === 0) return null;

  return (
    <dl
      data-testid="deal-summary-cards"
      // Flex, not a fixed grid: the number of cards varies from two to five
      // depending on what the deal knows, and `grid-cols-5` with four cards
      // leaves a conspicuous hole at the end of the row. `flex-1` off a 220px
      // basis fills the row evenly at any count and wraps on its own.
      className="flex flex-wrap gap-3"
    >
      {cards.map((c) => {
        const empty = !c.value;
        return (
          <div
            key={c.label}
            data-empty={empty || undefined}
            className={cn(
              "relative flex-1 basis-[220px] overflow-hidden rounded-xl border border-border",
              "bg-card py-3.5 pl-5 pr-4 shadow-sm"
            )}
          >
            {/* The thin accent bar. An inline style is correct here: the stage
                colour is per-deal DATA from the pipeline, not a design token.
                Dimmed on an empty slot: a full-strength accent pointing at a
                dash is the eye being sent somewhere with nothing to read. */}
            <span
              aria-hidden
              className={cn("absolute inset-y-0 left-0 w-1", empty && "opacity-30")}
              style={{ background: c.accent ?? accent }}
            />
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {c.label}
            </dt>
            <dd className="mt-1">
              <span
                title={c.value ?? undefined}
                className={cn(
                  "block truncate font-display text-lg font-semibold tracking-tight",
                  // The em dash is deliberately not invisible. A label over
                  // literal whitespace reads as a rendering bug; a dash reads
                  // as "nobody has decided this yet", which is the truth.
                  empty && "text-muted-foreground/45"
                )}
              >
                {c.value || "\u2014"}
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
        );
      })}
    </dl>
  );
}
