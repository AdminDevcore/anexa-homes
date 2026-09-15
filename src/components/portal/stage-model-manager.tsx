"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { BlockerParty, StageType } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { STAGE_OWNERS, BLOCKER_LABEL, BLOCKER_TONE } from "@/lib/solar-pipeline";
import { updatePipelineStageAction } from "@/server/modules/settings/actions";

type Stage = {
  id: string;
  name: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
  stageType: StageType;
  ownerRole: string | null;
  targetDays: number;
  escalationDays: number;
  followUpDays: number;
  isActionRequired: boolean;
  defaultBlocker: BlockerParty | null;
  notificationRecipient: string;
  sendInApp: boolean;
  sendEmail: boolean;
  markOverdue: boolean;
  milestone: "contract_signed" | null;
};

const OWNER_KEYS = Object.keys(STAGE_OWNERS) as (keyof typeof STAGE_OWNERS)[];
const BLOCKERS: BlockerParty[] = ["us", "ahj", "utility", "customer", "lender"];

/**
 * Editor for the stage model: owned vs blocked, who owns it, who we wait on.
 *
 * The timing fields are mutually exclusive by design — switching a stage to
 * "waiting on someone else" swaps the day-limit input for a chase cadence,
 * because a stage must never carry both. That is enforced server-side too
 * (stageSlaData); this just makes the impossible state unreachable in the UI.
 */
export function StageModelManager({ stages, canEdit }: { stages: Stage[]; canEdit: boolean }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-semibold">Pipeline stage model</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Internally-owned stages carry a hard deadline that escalates to the owning role. Stages
          waiting on a third party carry a follow-up cadence instead and never report as overdue —
          a utility&rsquo;s queue is not your team being late.
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Contract Signed</span> marks the stage a deal
          only reaches once the customer has signed the proposal AND a completed contract is in the
          deal&rsquo;s Contract folder. Moves into or past it are refused until both are on file, and
          the deal advances on its own when the second one arrives — whatever the stage is called.
        </p>
      </div>
      {!stages.some((s) => s.milestone === "contract_signed") && (
        <p className="rounded-md border chip-warning px-3 py-2 text-xs">
          No stage is marked Contract Signed, so nothing stops a deal being moved past the sale
          without a signed proposal and a completed contract. Tick the stage that stands for it.
        </p>
      )}
      <div className="divide-y divide-border">
        {stages.map((s) => (
          <StageRow key={s.id} stage={s} canEdit={canEdit} />
        ))}
      </div>
    </section>
  );
}

function StageRow({ stage, canEdit }: { stage: Stage; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function patch(patchData: Partial<Stage>) {
    setBusy(true);
    const next = { ...stage, ...patchData };
    const res = await updatePipelineStageAction(stage.id, {
      name: next.name,
      color: next.color,
      isWon: next.isWon,
      isLost: next.isLost,
      stageType: next.stageType,
      ownerRole: next.ownerRole,
      targetDays: next.targetDays,
      escalationDays: next.escalationDays,
      followUpDays: next.followUpDays,
      isActionRequired: next.isActionRequired,
      defaultBlocker: next.defaultBlocker,
      notificationRecipient: next.notificationRecipient as never,
      sendInApp: next.sendInApp,
      sendEmail: next.sendEmail,
      markOverdue: next.markOverdue,
      milestone: next.milestone,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  const blocked = stage.stageType === "externally_blocked";

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: stage.color }} />
      <span className="min-w-[13rem] flex-1 text-sm font-medium">{stage.name}</span>

      {!stage.isLost && (
        <label
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs",
            stage.milestone === "contract_signed" ? "chip-warning" : "border-input text-muted-foreground"
          )}
        >
          <input
            type="checkbox"
            className="size-3.5"
            checked={stage.milestone === "contract_signed"}
            disabled={!canEdit || busy}
            onChange={(e) => patch({ milestone: e.target.checked ? "contract_signed" : null })}
          />
          Contract Signed
        </label>
      )}

      {stage.isActionRequired && (
        <span className="rounded-full border chip-danger px-2 py-0.5 text-[11px] font-medium">
          action required
        </span>
      )}

      <select
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stage.stageType}
        disabled={!canEdit || busy}
        onChange={(e) => patch({ stageType: e.target.value as StageType })}
      >
        <option value="internally_owned">We own it</option>
        <option value="externally_blocked">Waiting on someone</option>
      </select>

      <select
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
        value={stage.ownerRole ?? ""}
        disabled={!canEdit || busy}
        onChange={(e) => patch({ ownerRole: e.target.value || null })}
      >
        <option value="">— no owner —</option>
        {OWNER_KEYS.map((k) => (
          <option key={k} value={k}>{STAGE_OWNERS[k].label}</option>
        ))}
      </select>

      {/* Exactly one timing control, never both. */}
      {blocked ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          chase every
          <Input
            type="number"
            className="h-8 w-16"
            defaultValue={stage.followUpDays || ""}
            disabled={!canEdit || busy}
            onBlur={(e) => {
              const n = Math.max(0, parseInt(e.target.value || "0", 10) || 0);
              if (n !== stage.followUpDays) patch({ followUpDays: n });
            }}
          />
          days
        </label>
      ) : (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          SLA
          <Input
            type="number"
            className="h-8 w-16"
            defaultValue={stage.targetDays || ""}
            disabled={!canEdit || busy}
            onBlur={(e) => {
              const n = Math.max(0, parseInt(e.target.value || "0", 10) || 0);
              if (n !== stage.targetDays) patch({ targetDays: n });
            }}
          />
          days
        </label>
      )}

      <select
        className={cn(
          "h-8 rounded-md border border-input bg-transparent px-2 text-xs",
          stage.defaultBlocker && BLOCKER_TONE[stage.defaultBlocker]
        )}
        value={stage.defaultBlocker ?? ""}
        disabled={!canEdit || busy}
        onChange={(e) => patch({ defaultBlocker: (e.target.value || null) as BlockerParty | null })}
      >
        <option value="">— no blocker —</option>
        {BLOCKERS.map((b) => (
          <option key={b} value={b}>{BLOCKER_LABEL[b]}</option>
        ))}
      </select>

      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
