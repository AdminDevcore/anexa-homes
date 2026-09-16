import Link from "next/link";
import type { ChangeOutcome, ChangeRecord } from "@/server/modules/agents/types";
import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<ChangeOutcome, string> = {
  applied: "Applied",
  noop: "Already there",
  held: "Held for a person",
  discarded: "Not applied",
  invalid: "Invalid",
};

const OUTCOME_CHIP: Record<ChangeOutcome, string> = {
  applied: "chip-good",
  noop: "chip-neutral",
  held: "chip-warning",
  discarded: "chip-danger",
  invalid: "chip-danger",
};

/** "Move Maria Lopez · 12 Elm St from NTP Submitted to NTP Approved". */
export function changeSentence(c: ChangeRecord): string {
  const deal = c.dealLabel ?? "a deal that could not be found";
  const to = c.toStage?.name ?? c.toStageKey;
  return c.fromStage ? `Move ${deal} from ${c.fromStage.name} to ${to}` : `Move ${deal} to ${to}`;
}

export function ChangeList({ changes }: { changes: ChangeRecord[] }) {
  if (changes.length === 0) return null;
  return (
    <ul data-testid="agent-run-changes" className="space-y-2">
      {changes.map((c, i) => (
        <li key={`${c.leadId}-${i}`} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", OUTCOME_CHIP[c.outcome])}>
              {OUTCOME_LABEL[c.outcome]}
            </span>
            <span>{changeSentence(c)}</span>
            {c.dealLabel && (
              <Link href={`/portal/leads/${c.leadId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                Open deal
              </Link>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{`Reason: ${c.reason}`}</p>
          {c.note && <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>}
        </li>
      ))}
    </ul>
  );
}
