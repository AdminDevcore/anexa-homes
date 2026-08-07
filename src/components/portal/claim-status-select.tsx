"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { claimStatusOpensClaim, type ClaimStatusOption } from "@/lib/claim-status";
import { setClaimStatusAction } from "@/server/modules/leads/manage";

/**
 * Where the claim actually IS — set from the deal Summary.
 *
 * A live control like the deal-type toggle beside it, not an Edit-mode field:
 * claim status changes on a phone call with the carrier, and burying it behind
 * Edit → Save is two clicks too many for something a coordinator touches daily.
 * Until this existed there was no way to move a claim past "filed" at all.
 *
 * `options` is the company's configured list (Settings → Claim Statuses),
 * already widened to include this deal's current value if it was since removed.
 *
 * OPENING a claim asks for its identifying facts first. Picking a status when no
 * claim exists yet opens a short dialog for carrier, claim number and date of
 * loss, because the carrier hands the rep a claim number on the very call where
 * they file — this is the one moment those facts are in front of them. It can be
 * skipped (some carriers issue the number later), and a skipped claim is flagged
 * incomplete on the worksheet rather than silently passing for filed.
 */
export function ClaimStatusSelect({
  leadId,
  value,
  options,
  canEdit,
  hasClaim,
}: {
  leadId: string;
  value: string;
  options: ClaimStatusOption[];
  canEdit: boolean;
  /** False until a Claim row exists — the one case that prompts for details. */
  hasClaim: boolean;
}) {
  const router = useRouter();
  // Optimistic + transition, same as DealTypeToggle: the pick paints instantly
  // and holds until router.refresh() lands the real value, reverting on failure.
  const [selected, setSelected] = React.useOptimistic(value);
  const [busy, startSwitch] = React.useTransition();
  // The status awaiting details. Non-null only while the open dialog is up.
  const [opening, setOpening] = React.useState<string | null>(null);

  const label = options.find((o) => o.key === selected)?.label ?? selected;

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/45 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold">
        <ShieldCheck className="size-3.5" />
        {label}
      </span>
    );
  }

  function commit(next: string, details?: { carrier: string; claimNumber: string; lossDate: string }) {
    startSwitch(async () => {
      setSelected(next);
      const res = await setClaimStatusAction({ leadId, status: next, ...details });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Claim: ${options.find((o) => o.key === next)?.label ?? next}`);
      router.refresh();
    });
  }

  function pick(next: string) {
    if (next === selected || busy) return;
    // First status that means a claim exists → collect the facts that make it a
    // real claim. Every later change is a plain status move.
    if (!hasClaim && claimStatusOpensClaim(next)) {
      setOpening(next);
      return;
    }
    commit(next);
  }

  return (
    <>
      <Select value={selected} onValueChange={pick} disabled={busy}>
        <SelectTrigger className="w-full" aria-label="Claim Status">
          {busy ? (
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              {label}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.key} value={o.key}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Keyed by the status, so each open mounts a blank form. A dialog that
          remembers the last attempt's carrier is a dialog that fills the wrong
          carrier in on the next deal. */}
      {opening && (
        <OpenClaimDialog
          key={opening}
          statusLabel={options.find((o) => o.key === opening)?.label ?? opening}
          onCancel={() => setOpening(null)}
          onSubmit={(details) => {
            setOpening(null);
            commit(opening, details);
          }}
        />
      )}
    </>
  );
}

/**
 * The facts that turn "a status" into a claim someone can actually work.
 *
 * Deliberately three fields, not the whole worksheet: deductible, RCV and the
 * adjuster arrive later, and a long form at this moment is a form people learn
 * to dismiss. Skipping is a first-class button rather than a hidden X, because a
 * rep who genuinely doesn't have the claim number yet should not be taught to
 * type a placeholder into it.
 */
function OpenClaimDialog({
  statusLabel,
  onCancel,
  onSubmit,
}: {
  statusLabel: string;
  onCancel: () => void;
  onSubmit: (details: { carrier: string; claimNumber: string; lossDate: string }) => void;
}) {
  const [carrier, setCarrier] = React.useState("");
  const [claimNumber, setClaimNumber] = React.useState("");
  const [lossDate, setLossDate] = React.useState("");

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open the claim</DialogTitle>
          <DialogDescription>
            Setting this to <strong>{statusLabel}</strong> opens the claim. Its carrier and claim number are what
            let anyone else pick it up — add them now if you have them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="claim-open-carrier">Carrier</Label>
            <Input
              id="claim-open-carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="State Farm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="claim-open-number">Claim Number</Label>
            <Input
              id="claim-open-number"
              value={claimNumber}
              onChange={(e) => setClaimNumber(e.target.value)}
              placeholder="SF-2026-4471"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="claim-open-loss">Date of Loss</Label>
            <Input
              id="claim-open-loss"
              type="date"
              value={lossDate}
              onChange={(e) => setLossDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onSubmit({ carrier: "", claimNumber: "", lossDate: "" })}>
            Skip for now
          </Button>
          <Button
            onClick={() => onSubmit({ carrier, claimNumber, lossDate })}
            className="bg-gold text-gold-foreground hover:bg-gold/90"
          >
            Open claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
