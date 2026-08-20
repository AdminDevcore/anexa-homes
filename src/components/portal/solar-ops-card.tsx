"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PhoneCall, TriangleAlert, ArrowUpRight, Home, Zap } from "lucide-react";
import type { BlockerParty, StageType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { BLOCKER_LABEL, BLOCKER_TONE, stageOwnerLabel } from "@/lib/solar-pipeline";
import { chaseTiming, chaseStatusLabel, CHASE_STATUS_META, stageTiming, stageStatusLabel, STAGE_STATUS_META } from "@/lib/stage-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { setDealBlockerAction, logFollowUpAction } from "@/server/modules/pipeline/blocker-actions";
import { setCrossoverFlagsAction, createCrossoverDealAction } from "@/server/modules/vertical/crossover";
import type { LinkedDealSummary } from "@/server/modules/vertical/crossover-queries";

const BLOCKERS: BlockerParty[] = ["us", "ahj", "utility", "customer", "lender"];

export type SolarOpsProps = {
  leadId: string;
  stage: {
    name: string;
    stageType: StageType;
    ownerRole: string | null;
    targetDays: number;
    followUpDays: number;
    isActionRequired: boolean;
  } | null;
  stageChangedAt: string | null;
  createdAt: string;
  blockedBy: BlockerParty | null;
  blockerNote: string | null;
  lastTouchAt: string | null;
  needsReroof: boolean;
  needsMpu: boolean;
  linkedDeal: LinkedDealSummary | null;
  canEdit: boolean;
  /**
   * Render without the card shell and without the "Operations" heading, for
   * when something outside already provides both — the deal page's slide
   * switcher, whose tab IS the heading. The stage line and the action-required
   * badge stay either way: they are the card's content, not its chrome.
   */
  bare?: boolean;
};

/**
 * Operations card for a Solar deal: who we are waiting on, when we last chased
 * them, and whether this roof needs work before panels can go on it.
 *
 * The two halves answer the two questions that actually kill solar deals —
 * "is anyone still pushing on this?" and "did we miss the re-roof?".
 */
export function SolarOpsCard(props: SolarOpsProps) {
  const { stage } = props;
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(props.blockerNote ?? "");
  const blocked = stage?.stageType === "externally_blocked";
  const timing = blocked
    ? chaseTiming(props.lastTouchAt, props.stageChangedAt, props.createdAt, stage.followUpDays)
    : null;
  const owned = stage && !blocked
    ? stageTiming(props.stageChangedAt, props.createdAt, stage.targetDays)
    : null;

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    toast.success(okMsg);
    router.refresh();
  }

  const ownerLabel = stageOwnerLabel(stage?.ownerRole);

  const bare = props.bare ?? false;

  return (
    <div className={cn("space-y-4", !bare && "rounded-xl border border-border bg-card p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {!bare && <h3 className="font-semibold">Operations</h3>}
          <p className={cn("text-xs text-muted-foreground", !bare && "mt-0.5")}>
            {stage ? stage.name : "No stage"}
            {ownerLabel && <> · owned by <span className="font-medium">{ownerLabel}</span></>}
          </p>
        </div>
        {stage?.isActionRequired && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
            <TriangleAlert className="size-3.5" /> Action required
          </span>
        )}
      </div>

      {/* ── Timing ─────────────────────────────────────────────────────── */}
      {stage && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          {blocked && timing ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    timing.status !== "none" && CHASE_STATUS_META[timing.status].classes
                  )}
                >
                  {chaseStatusLabel(timing) || "No cadence set"}
                </span>
                {props.blockedBy && (
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", BLOCKER_TONE[props.blockedBy])}>
                    Waiting on {BLOCKER_LABEL[props.blockedBy]}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                We don&rsquo;t control this stage, so there is no completion deadline — only how
                long since we last pushed. Chase every {stage.followUpDays} days.
              </p>
            </>
          ) : owned ? (
            <>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  owned.status !== "none" && STAGE_STATUS_META[owned.status].classes
                )}
              >
                {stageStatusLabel(owned) || "No SLA set"}
              </span>
              <p className="mt-2 text-xs text-muted-foreground">
                {stage.targetDays > 0
                  ? `Ours to complete — target ${stage.targetDays} days, then it escalates${ownerLabel ? ` to ${ownerLabel}` : ""}.`
                  : "Ours to complete. No SLA configured for this stage."}
              </p>
            </>
          ) : null}
        </div>
      )}

      {/* ── Blocker + follow-up ────────────────────────────────────────── */}
      {props.canEdit && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Waiting on
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BLOCKERS.map((b) => (
              <button
                key={b}
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      setDealBlockerAction({
                        leadId: props.leadId,
                        blockedBy: props.blockedBy === b ? null : b,
                      }),
                    "Blocker updated"
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                  props.blockedBy === b
                    ? cn(BLOCKER_TONE[b], "border-transparent")
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {BLOCKER_LABEL[b]}
              </button>
            ))}
          </div>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What exactly are we waiting for? e.g. plan review round 2, meter spot scheduled"
            rows={2}
            className="text-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => logFollowUpAction({ leadId: props.leadId, note: note || undefined }), "Follow-up logged")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
              Log follow-up
            </Button>
            <span className="text-xs text-muted-foreground">
              {props.lastTouchAt
                ? `Last chased ${new Date(props.lastTouchAt).toLocaleDateString()}`
                : "Never chased"}
            </span>
          </div>
        </div>
      )}

      {/* ── Crossover ──────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Site findings
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={props.needsReroof}
              disabled={busy || !props.canEdit}
              onCheckedChange={(v) =>
                run(() => setCrossoverFlagsAction({ leadId: props.leadId, needsReroof: Boolean(v) }), "Updated")
              }
            />
            <Home className="size-4 text-muted-foreground" />
            Roof needs replacing before install
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={props.needsMpu}
              disabled={busy || !props.canEdit}
              onCheckedChange={(v) =>
                run(() => setCrossoverFlagsAction({ leadId: props.leadId, needsMpu: Boolean(v) }), "Updated")
              }
            />
            <Zap className="size-4 text-muted-foreground" />
            Main panel upgrade / derate required
          </label>
        </div>

        {props.linkedDeal ? (
          <Link
            href={`/portal/leads/${props.linkedDeal.id}`}
            className="mt-1 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm hover:bg-muted"
          >
            <span>
              Linked <span className="font-medium capitalize">{props.linkedDeal.vertical}</span> deal
              {props.linkedDeal.stageName && (
                <span className="text-muted-foreground"> · {props.linkedDeal.stageName}</span>
              )}
            </span>
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </Link>
        ) : (
          (props.needsReroof || props.needsMpu) &&
          props.canEdit && (
            <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">
                This roof needs work before panels go on it. The customer is already sold and
                financed — this is the highest-margin cross-sell we get.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="mt-2"
                onClick={() => run(() => createCrossoverDealAction(props.leadId), "Roofing deal created")}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Home className="size-4" />}
                Create linked Roofing deal
              </Button>
            </div>
          )
        )}
      </div>

      {/* Interconnection & equipment moved to the System info slide. A meter
          number is not a chase: this card answers "is anyone still pushing on
          this deal", and burying what got installed under a follow-up log is
          how those fields went unfilled. See solar-system-info.tsx. */}
    </div>
  );
}
