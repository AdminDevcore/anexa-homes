"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  unlockSignedContractAction,
  relockSignedContractAction,
} from "@/server/modules/solar/unlock-actions";
import { refreezeCommissionMeasureAction } from "@/server/modules/solar/commission-measure-actions";

/**
 * WHY THIS DEAL'S MONEY IS READ-ONLY, said out loud.
 *
 * The server refuses a protected write on a signed contract whatever the screen
 * does — see `signed-lock.ts`. This is the other half of that: a control that
 * looks editable and then fails on save is worse than no control, so the price,
 * the design, the adders and the lender go read-only and this says why.
 *
 * FOR A SUPER ADMIN it is also the door through. Reopening asks for a reason
 * BEFORE anything is edited, because the reason covers the whole sitting rather
 * than being re-asked per field — and because a reason collected afterwards is
 * a justification, not a decision.
 */

/** The reasons that come up, offered as a starting point rather than a menu. */
const SUGGESTED = [
  "Customer requested equipment change",
  "Lender correction",
  "Contract correction",
  "Pricing correction",
] as const;

export type ContractLockState = {
  /** When the household signed. Null means nothing is locked. */
  signedAt: string | null;
  /** May this viewer reopen it — super admin only. */
  canOverride: boolean;
  /** The live unlock, if one is open. */
  unlock: { reason: string; expiresAt: string } | null;
  /**
   * What this deal's commission is measured on, and which document it was read
   * from. Null when nothing was ever frozen — a deal with no compensation terms
   * has no measure to move.
   */
  measure?: {
    frozenAt: string | null;
    basis: string | null;
    proposalVersion: number | null;
    matchesDocument: boolean | null;
  } | null;
};

export function SignedContractLock({ leadId, lock }: { leadId: string; lock: ContractLockState }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [reason, setReason] = React.useState("");

  if (!lock.signedAt) return null;

  const signed = new Date(lock.signedAt).toLocaleDateString();

  async function unlock() {
    setBusy(true);
    try {
      const res = await unlockSignedContractAction({ leadId, reason });
      if (!res.ok) return toast.error(res.error);
      toast.success("Contract reopened — your changes are recorded against this reason.");
      setOpening(false);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function relock() {
    setBusy(true);
    try {
      const res = await relockSignedContractAction(leadId);
      if (!res.ok) return toast.error(res.error);
      toast.success("Contract closed again.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── Reopened, and still open ──────────────────────────────────────────────
  if (lock.unlock) {
    const until = new Date(lock.unlock.expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
          <LockOpen className="size-4 shrink-0" />
          This signed contract is open for editing until {until}
        </p>
        <p className="mt-1 text-muted-foreground">
          Every change is recorded on this deal&rsquo;s history against your reason:{" "}
          <span className="font-medium text-foreground">{lock.unlock.reason}</span>
        </p>
        {lock.canOverride && (
          <Button size="sm" variant="outline" className="mt-2" onClick={relock} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Close it again
          </Button>
        )}
        <CommissionMeasure leadId={leadId} lock={lock} />
      </div>
    );
  }

  // ── Locked ────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
      <p className="flex items-center gap-2 font-medium">
        <Lock className="size-4 shrink-0" />
        Signed on {signed} — the price, system and financing are locked
      </p>
      <p className="mt-1 text-muted-foreground">
        This is what the household agreed to. To quote something different, issue a new proposal.
      </p>

      {lock.canOverride && !opening && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpening(true)}>
          Reopen the contract
        </Button>
      )}

      {lock.canOverride && opening && (
        <div className="mt-3 space-y-2">
          <label className="block space-y-1">
            <span className="font-medium">Why is this contract being reopened?</span>
            <textarea
              aria-label="Reason for reopening the contract"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Lender corrected the dealer fee to 22%"
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {r}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Recorded with your name, the time, and the old and new value of anything you change.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={unlock} disabled={busy || reason.trim().length < 8}>
              {busy && <Loader2 className="size-4 animate-spin" />} Reopen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpening(false);
                setReason("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <CommissionMeasure leadId={leadId} lock={lock} />
    </div>
  );
}

/**
 * WHAT THIS DEAL PAYS ON, and the one manual way to move it.
 *
 * The measure — the watts, the base price and the battery count — is frozen off
 * the proposal the household signed, so a correction made after signing does not
 * move anybody's commission until the customer signs the corrected version.
 * When a correction is agreed but not re-signed, a super admin re-freezes it
 * here and says why. Never automatic on an unlock: reopening a contract is
 * permission to fix something, not a decision about pay.
 */
function CommissionMeasure({ leadId, lock }: { leadId: string; lock: ContractLockState }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const measure = lock.measure;
  if (!lock.canOverride || !measure) return null;

  const from =
    measure.basis === "signed_document" && measure.proposalVersion != null
      ? `signed proposal v${measure.proposalVersion}`
      : measure.frozenAt
        ? "the deal itself — that document carries no priced figures"
        : "the deal as it stands";

  async function refreeze() {
    setBusy(true);
    try {
      const res = await refreezeCommissionMeasureAction({ leadId, reason });
      if (!res.ok) return toast.error(res.error);
      toast.success("Commission measure re-frozen from the signed proposal.");
      setAsking(false);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <p className="text-[11px] text-muted-foreground">
        Commission is measured on {from}.
        {measure.matchesDocument === false && (
          <span className="font-medium text-amber-700 dark:text-amber-300">
            {" "}
            The deal no longer matches that document.
          </span>
        )}
      </p>

      {!asking && (
        <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-[11px]" onClick={() => setAsking(true)}>
          Re-freeze from the signed proposal
        </Button>
      )}

      {asking && (
        <div className="mt-2 space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium">Why is the measure being re-frozen?</span>
            <textarea
              aria-label="Reason for re-freezing the commission measure"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer agreed the corrected system size by email on 12 May"
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            Recorded on this deal&rsquo;s history with your name and the figures it wrote.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={refreeze} disabled={busy || reason.trim().length < 8}>
              {busy && <Loader2 className="size-4 animate-spin" />} Re-freeze
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsking(false);
                setReason("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
