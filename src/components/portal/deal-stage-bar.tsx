"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { moveLeadStage } from "@/server/modules/leads/actions";

export type StageLite = { id: string; name: string; position: number; color: string };

/**
 * Where the deal is, and what's next. Two lines.
 *
 * This started as a horizontal strip of every stage, which is fine at six and
 * absurd at twenty-two: it clipped mid-word, then wrapped to three rows, then
 * became a gauge — and every version spent a block of the page restating a
 * fact the summary card already shows. A pipeline that long is a *picker*, not
 * a visualisation, so the stages live in the dropdown and the page keeps two
 * lines: the stage you are on, and the one you are heading to.
 *
 * Vertical-agnostic: it renders whatever stages the deal's own pipeline has —
 * roofing's 22, solar's 25, or whatever a company configures in Settings — and
 * `moveLeadStage` validates the target against the company, not a vertical.
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
  const current = currentIndex >= 0 ? stages[currentIndex] : null;
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
    <div
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid="deal-stage-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: current?.color ?? "var(--muted-foreground)" }}
          />
          <span className="truncate font-semibold tracking-tight">
            {current ? current.name : "Not started"}
          </span>
          {current && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {step}/{stages.length}
            </span>
          )}
        </div>

        {canEdit && stages.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Change
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            {/* Scrolls: twenty-two items will not fit on a laptop screen. */}
            <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Move to stage
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {stages.map((s, i) => {
                const done = currentIndex >= 0 && i < currentIndex;
                const isCurrent = s.id === currentStageId;
                return (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => move(s.id)}
                    disabled={isCurrent}
                    className={cn("gap-2", isCurrent && "font-semibold")}
                  >
                    <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground">
                      {done ? <Check className="size-3 text-emerald-600" /> : i + 1}
                    </span>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="truncate">{s.name}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        {nextStage ? (
          <>
            Next: <span className="font-medium text-foreground">{nextStage.name}</span>
          </>
        ) : (
          "Final stage"
        )}
      </p>
    </div>
  );
}
