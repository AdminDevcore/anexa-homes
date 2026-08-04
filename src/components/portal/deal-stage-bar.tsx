"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, ChevronDown, ArrowRight, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { moveLeadStage, cancelLeadAction } from "@/server/modules/leads/actions";

export type StageLite = {
  id: string;
  name: string;
  position: number;
  color: string;
  isLost?: boolean;
};

/**
 * A deal's stage, split across two surfaces.
 *
 * `DealStageActions` — Move and Cancel, in the page header beside Edit, because
 * they are page-level actions on the record and that is where a user looks for
 * them.
 *
 * `DealProgressBar` — how far along production is, as a bar rather than a
 * sentence. This started as a horizontal strip of every stage, which is fine at
 * six and absurd at twenty-one: it clipped mid-word, then wrapped to three rows,
 * then became a two-line summary. A continuous fill answers "how far along is
 * this job" at a glance and never clips, however many stages a company
 * configures; the picker that a twenty-one-stage pipeline needs lives in the
 * header dropdown instead of competing with it.
 *
 * Both are vertical-agnostic: they render whatever stages the deal's own
 * pipeline has — roofing's 22, solar's 25, or whatever Settings defines — and
 * `moveLeadStage` validates the target against the company, not a vertical.
 */

/** What the two surfaces need to agree on, derived once from the stage list. */
function useStageModel(stages: StageLite[], currentStageId: string | null) {
  return React.useMemo(() => {
    const currentIndex = stages.findIndex((s) => s.id === currentStageId);
    const current = currentIndex >= 0 ? stages[currentIndex] : null;
    // Progress counts the stages a deal moves THROUGH. Cancelled sits in the
    // pipeline but is a dead end, not a step towards anything.
    const liveCount = stages.filter((s) => !s.isLost).length;
    return {
      currentIndex,
      current,
      liveCount,
      step: currentIndex + 1,
      // Forward motion never runs into a dead end: a deal one stage short of the
      // end must not advance itself into Cancelled just because Cancelled
      // happens to be last in the list.
      nextStage: stages.slice(currentIndex + 1).find((s) => !s.isLost) ?? null,
      lostStage: stages.find((s) => s.isLost) ?? null,
      isCancelled: !!current?.isLost,
    };
  }, [stages, currentStageId]);
}

/** Moving a deal, shared by the header dropdown and the bar's advance button. */
function useStageMove(leadId: string, canEdit: boolean, currentStageId: string | null) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const move = React.useCallback(
    async (stageId: string) => {
      if (!canEdit || stageId === currentStageId) return;
      setBusy(stageId);
      const res = await moveLeadStage({ leadId, stageId });
      setBusy(null);
      if (!res.ok) return toast.error(res.error);
      toast.success("Stage updated");
      router.refresh();
    },
    [leadId, canEdit, currentStageId, router]
  );

  return { busy, setBusy, move };
}

/** Move ▾ and Cancel deal — page header, beside Edit. */
export function DealStageActions({
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
  const { currentIndex, lostStage, isCancelled } = useStageModel(stages, currentStageId);
  const { busy, setBusy, move } = useStageMove(leadId, canEdit, currentStageId);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");

  if (!canEdit || stages.length === 0) return null;

  async function cancelDeal() {
    if (!reason.trim()) return;
    setBusy("cancel");
    const res = await cancelLeadAction({ leadId, reason: reason.trim() });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setCancelOpen(false);
    setReason("");
    toast.success("Deal cancelled");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2" data-testid="deal-stage-actions">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy !== null}>
            {busy && busy !== "cancel" ? <Loader2 className="size-4 animate-spin" /> : null}
            Move
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        {/* Scrolls: twenty-one items will not fit on a laptop screen. */}
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

      {/* Only exists once a pipeline says which stage means dead. */}
      {lostStage && !isCancelled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCancelOpen(true)}
          disabled={busy !== null}
          data-testid="deal-cancel"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Ban className="size-4" /> Cancel deal
        </Button>
      )}

      <Dialog open={cancelOpen} onOpenChange={(o) => !busy && setCancelOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this deal?</DialogTitle>
            <DialogDescription>
              It moves to {lostStage?.name ?? "the cancelled stage"}, stops counting as open
              revenue, and any job on it is cancelled too. You can move it back out, but the
              status stays cancelled until someone changes it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="cancel-reason" className="text-sm font-medium">
              Reason
            </label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this deal dead? Saved as a note on the deal."
              rows={3}
              data-testid="deal-cancel-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy !== null}>
              Keep deal
            </Button>
            <Button
              variant="destructive"
              onClick={cancelDeal}
              disabled={!reason.trim() || busy !== null}
              data-testid="deal-cancel-confirm"
            >
              {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
              Cancel deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** How far along the job is, and the one click that moves it on. */
export function DealProgressBar({
  leadId,
  stages,
  currentStageId,
  canEdit,
  daysInStage,
}: {
  leadId: string;
  stages: StageLite[];
  currentStageId: string | null;
  canEdit: boolean;
  /** Computed server-side: the render-purity rule bans Date.now() in render. */
  daysInStage: number;
}) {
  const { current, currentIndex, liveCount, step, nextStage, isCancelled } = useStageModel(
    stages,
    currentStageId
  );
  const { busy, move } = useStageMove(leadId, canEdit, currentStageId);

  // A cancelled deal has no progress to report — it did not get 100% of the way
  // to anything. The bar empties and turns muted rather than claiming a finish.
  const percent =
    isCancelled || currentIndex < 0 || liveCount === 0
      ? 0
      : Math.round((step / liveCount) * 100);

  const fill = isCancelled ? "var(--muted-foreground)" : (current?.color ?? "var(--muted-foreground)");

  return (
    <div
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid="deal-stage-bar"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: fill }}
          />
          <span className="truncate font-semibold tracking-tight">
            {current ? current.name : "Not started"}
          </span>
        </div>
        {/* No percentage on a cancelled deal: the stage name beside it already
            says so, and "0%" reads like a job that never started. */}
        {!isCancelled && (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
            {percent}%
          </span>
        )}
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Production progress"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%`, background: fill }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {isCancelled ? (
            "Cancelled — move it to another stage to reopen it."
          ) : (
            <>
              {currentIndex >= 0 && (
                <>
                  Step {step} of {liveCount} ·{" "}
                </>
              )}
              {daysInStage}d in stage
              {nextStage ? (
                <>
                  {" "}
                  · Next: <span className="font-medium text-foreground">{nextStage.name}</span>
                </>
              ) : (
                " · Final stage"
              )}
            </>
          )}
        </p>

        {/* The one-click move, at the end of the bar it advances. Named after
            where it lands, because "Advance" alone makes you read the line
            beside it to find out. */}
        {canEdit && nextStage && !isCancelled && (
          <Button
            size="sm"
            onClick={() => move(nextStage.id)}
            disabled={busy !== null}
            data-testid="deal-stage-advance"
            className="ml-auto max-w-[18rem]"
          >
            {busy === nextStage.id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            <span className="truncate">{nextStage.name}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
