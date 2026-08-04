"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { moveLeadStage } from "@/server/modules/leads/actions";

export type StageLite = { id: string; name: string; position: number; color: string };

/**
 * The whole pipeline at a glance, first stage through won.
 *
 * Vertical-agnostic: it renders whatever stages the deal's own pipeline has —
 * roofing's 16, solar's 25, or whatever a company configures in Settings — and
 * `moveLeadStage` validates the target against the company, not a vertical. It
 * started life as SolarStageBar; nothing about it was ever solar-specific
 * except where it happened to live.
 *
 * A 22-stage pipeline cannot show 22 labels without becoming a wall, so the
 * default state is a SEGMENTED GAUGE: one bar per stage on a single line,
 * completed filled, current taller and in its own colour. That answers "how far
 * along is this?" instantly, which twenty-two chips never did. The full labelled
 * list is one click away for when you need to jump somewhere specific.
 *
 * Every segment and every chip is clickable — moving a deal is the most common
 * action on this page and should not need a menu.
 */
export function DealStageBar({
  leadId,
  stages,
  currentStageId,
  canEdit,
}: {
  leadId: string;
  stages: StageLite[];
  currentStageId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  const step = currentIndex + 1;
  const nextStage = currentIndex >= 0 ? stages[currentIndex + 1] : stages[0];

  async function move(stageId: string) {
    if (!canEdit || stageId === currentStageId) return;
    setBusy(stageId);
    const res = await moveLeadStage({ leadId, stageId });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Stage updated");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3" data-testid="deal-stage-bar">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project lifecycle
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {currentIndex >= 0 ? (
            <>
              <span className="font-semibold text-foreground">{stages[currentIndex].name}</span>
              {" · "}step {step} of {stages.length}
            </>
          ) : (
            "Not started"
          )}
        </span>
      </div>

      {/* One segment per stage, one line, no wrapping and nothing clipped.
          Twenty-two labelled chips told you there are a lot of stages; they did
          not tell you where in them you are. A gauge does that at a glance, and
          the names are one click away rather than three rows of noise. */}
      <div
        className="flex items-center gap-0.5"
        role="progressbar"
        aria-valuenow={Math.max(0, step)}
        aria-valuemin={0}
        aria-valuemax={stages.length}
        aria-label={`Pipeline progress: step ${step} of ${stages.length}`}
      >
        {stages.map((s, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const current = s.id === currentStageId;
          return (
            <button
              key={s.id}
              disabled={!canEdit || busy !== null}
              onClick={() => move(s.id)}
              title={`${i + 1}. ${s.name}`}
              aria-label={`Move to ${s.name}`}
              className={cn(
                "h-2 min-w-0 flex-1 rounded-[3px] transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                canEdit && !current && "hover:opacity-70",
                current ? "h-3.5 shadow-sm" : done ? "bg-emerald-400" : "bg-muted",
                busy === s.id && "animate-pulse"
              )}
              style={current ? { background: s.color } : undefined}
            />
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[11px] text-muted-foreground">
          {currentIndex > 0 && (
            <span className="text-emerald-600">{currentIndex} complete</span>
          )}
          {currentIndex > 0 && nextStage && " · "}
          {nextStage && (
            <>
              Next: <span className="font-medium text-foreground">{nextStage.name}</span>
            </>
          )}
          {!nextStage && currentIndex >= 0 && (
            <span className="text-emerald-600">Final stage</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Hide stages" : `All ${stages.length} stages`}
          <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded && (
      <div className="mt-2.5 flex flex-wrap gap-1 border-t border-border pt-2.5">
        {stages.map((s, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const current = s.id === currentStageId;
          return (
            <button
              key={s.id}
              disabled={!canEdit || busy !== null}
              onClick={() => move(s.id)}
              title={s.name}
              aria-current={current ? "step" : undefined}
              className={cn(
                "group flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-default",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                current
                  ? "border-transparent text-white shadow-sm"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border text-muted-foreground hover:bg-muted"
              )}
              style={current ? { background: s.color } : undefined}
            >
              {busy === s.id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : done ? (
                <Check className="size-3 shrink-0" />
              ) : (
                <span className="text-[10px] tabular-nums opacity-60">{i + 1}</span>
              )}
              {/* The name stays in its OWN span: `whitespace-nowrap` keeps a
                  two-word stage on one line now that the row wraps, and it
                  gives the name an element of its own so a test can target the
                  label rather than "15Permit Approved" — the button's text
                  content includes the step number. */}
              <span className="whitespace-nowrap">{s.name}</span>
            </button>
          );
        })}
      </div>
      )}
      {canEdit && expanded && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Click any stage to move the deal there.
        </p>
      )}
    </div>
  );
}
