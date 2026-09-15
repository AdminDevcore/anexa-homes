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
    </div>
  );
}
