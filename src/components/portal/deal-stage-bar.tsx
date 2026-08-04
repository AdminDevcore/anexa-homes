"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
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
 * A long pipeline will not fit on a phone, so it scrolls horizontally and
 * auto-scrolls the current stage into view. Every stage is clickable — moving a
 * deal is the single most common action on this page and should not need a menu.
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

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  const step = currentIndex + 1;
  const pct = stages.length > 0 && currentIndex >= 0 ? (step / stages.length) * 100 : 0;
  const currentColor = currentIndex >= 0 ? stages[currentIndex].color : undefined;

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
    <div className="rounded-xl border border-border bg-card p-3">
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

      {/* How far along, in one glance. Twenty-two pills convey "there are a lot
          of stages"; they do not convey "we are a seventh of the way through". */}
      <div
        className="mb-2.5 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.max(0, step)}
        aria-valuemin={0}
        aria-valuemax={stages.length}
        aria-label="Pipeline progress"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: currentColor ?? "var(--gold)" }}
        />
      </div>

      {/* WRAPS — it must not scroll horizontally. A 22-stage roofing pipeline in
          an overflow-x container clipped the last pill mid-word and hid the rest
          behind a scrollbar nobody noticed. Wrapping costs two extra rows and
          makes every stage visible and clickable. */}
      <div className="flex flex-wrap gap-1" data-testid="deal-stage-bar">
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
      {canEdit && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Click any stage to move the deal there.
        </p>
      )}
    </div>
  );
}
