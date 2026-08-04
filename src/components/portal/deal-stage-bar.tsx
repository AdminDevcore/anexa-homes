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
  const currentRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [currentStageId]);

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

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
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project lifecycle
        </span>
        <span className="text-xs text-muted-foreground">
          {currentIndex >= 0 ? `${currentIndex + 1} of ${stages.length}` : "Not started"}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1" data-testid="deal-stage-bar">
        {stages.map((s, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const current = s.id === currentStageId;
          return (
            <button
              key={s.id}
              ref={current ? currentRef : undefined}
              disabled={!canEdit || busy !== null}
              onClick={() => move(s.id)}
              title={s.name}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-default",
                current
                  ? "border-transparent text-white"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border text-muted-foreground hover:bg-muted"
              )}
              style={current ? { background: s.color } : undefined}
            >
              {busy === s.id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : done ? (
                <Check className="size-3" />
              ) : (
                <span className="text-[10px] tabular-nums opacity-60">{i + 1}</span>
              )}
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
