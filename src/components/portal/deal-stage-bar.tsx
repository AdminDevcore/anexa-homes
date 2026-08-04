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
 * Where the deal is, what's next, and the two moves people actually make.
 *
 * This started as a horizontal strip of every stage, which is fine at six and
 * absurd at twenty-two: it clipped mid-word, then wrapped to three rows, then
 * became a gauge — and every version spent a block of the page restating a
 * fact the summary card already shows. A pipeline that long is a *picker*, not
 * a visualisation, so the stages live in the dropdown and the page keeps two
 * lines: the stage you are on, and the one you are heading to.
 *
 * The dropdown is built for jumping, which is the rare case. Ninety percent of
 * stage changes are one step forward, so Advance does that in one click; the
 * other real move is killing the deal, which used to mean scrolling to the
 * bottom of the list and guessing which stage meant dead.
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
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  const current = currentIndex >= 0 ? stages[currentIndex] : null;
  const step = currentIndex + 1;

  // Forward motion never runs into a dead end: a deal sitting one stage short of
  // the end must not "advance" itself into Cancelled just because Cancelled
  // happens to be last in the list.
  const nextStage = stages.slice(currentIndex + 1).find((s) => !s.isLost) ?? null;
  const lostStage = stages.find((s) => s.isLost) ?? null;
  const isCancelled = !!current?.isLost;

  async function move(stageId: string) {
    if (!canEdit || stageId === currentStageId) return;
    setBusy(stageId);
    const res = await moveLeadStage({ leadId, stageId });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Stage updated");
    router.refresh();
  }

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
          <div className="flex items-center gap-2">
            {/* The one-click move. Named after where it lands, because "Advance"
                alone makes you look at the line below to find out. */}
            {nextStage && !isCancelled && (
              <Button
                size="sm"
                onClick={() => move(nextStage.id)}
                disabled={busy !== null}
                data-testid="deal-stage-advance"
                className="max-w-[16rem]"
              >
                {busy === nextStage.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                <span className="truncate">{nextStage.name}</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy !== null}>
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
          </div>
        )}
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        {isCancelled ? (
          "This deal is cancelled. Move it to another stage to reopen it."
        ) : nextStage ? (
          <>
            Next: <span className="font-medium text-foreground">{nextStage.name}</span>
          </>
        ) : (
          "Final stage"
        )}
      </p>

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
