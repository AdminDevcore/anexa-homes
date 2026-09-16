"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAgentRunAction } from "@/server/modules/agents/actions";

/**
 * The two ways out of the queue. Apply moves the deal now, as the person
 * pressing it, and runs that stage's automations — so it asks first. Close
 * needs a sentence saying why, because that sentence is the only record of
 * the decision.
 *
 * `heldCount` is null while the run's changes have NOT been read, which is not
 * the same fact as a run holding nothing. Callers render this control either
 * way, because a transient read failure must not hide the one button that
 * answers the run: Close works with nothing read — the server re-reads the run
 * itself and requires it to still be waiting — while Apply stays visible and
 * disabled, because nobody should apply changes they have not been shown.
 */
export function ResolveRun({ runId, heldCount, onResolved }: { runId: string; heldCount: number | null; onResolved?: () => void }) {
  const router = useRouter();
  const noteId = React.useId();
  const [confirmApply, setConfirmApply] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Only ever read where the count is already known: Apply is unreachable until
  // it is, so neither the confirmation nor the toast can quote an unread run.
  const count = heldCount ?? 0;

  async function resolve(resolution: "applied" | "closed") {
    setBusy(true);
    try {
      const res = await resolveAgentRunAction({ runId, resolution, note: note.trim() });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (resolution === "closed") toast.success("Closed without applying");
      else if (res.failed > 0) toast.warning(`Applied, but ${res.failed} of the changes could not be. The run says why.`);
      else toast.success(count === 1 ? "Change applied" : "Changes applied");
      setConfirmApply(false);
      setClosing(false);
      setNote("");
      // The row this sits in was drawn from a list read, and the panel above it
      // from a single-run read. Both are now out of date, so both are re-read.
      onResolved?.();
      router.refresh();
    } catch {
      toast.error("Could not resolve the run. Try again.");
    } finally {
      // Always, and in a finally: a throw that left this latched on would leave
      // every button in this panel dead with no way back but a reload.
      setBusy(false);
    }
  }

  return (
    <div data-testid="resolve-run" className="flex flex-wrap gap-2">
      {heldCount !== 0 && (
        <Button size="sm" onClick={() => setConfirmApply(true)} disabled={busy || heldCount === null}>
          <Check className="size-4" /> {heldCount === null ? "Apply changes" : heldCount === 1 ? "Apply change" : `Apply ${heldCount} changes`}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setClosing(true)} disabled={busy}>
        <X className="size-4" /> Close without applying
      </Button>

      <AlertDialog open={confirmApply} onOpenChange={(open) => !busy && setConfirmApply(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{count === 1 ? "Apply this change?" : `Apply ${count} changes?`}</AlertDialogTitle>
            <AlertDialogDescription>
              The deal moves now, recorded as you, and that stage&apos;s automations run. If the deal has moved since the
              agent looked, nothing is applied.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void resolve("applied");
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={closing} onOpenChange={(open) => !busy && setClosing(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close without applying</DialogTitle>
            <DialogDescription>Nothing changes on the deal. Say why, so the next person reading this run knows.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={noteId} className="text-xs">
              Why it is closed
            </Label>
            <Textarea
              id={noteId}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Bank confirmed NTP by phone; the deal was already moved."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void resolve("closed")} disabled={busy || note.trim() === ""}>
              {busy && <Loader2 className="size-4 animate-spin" />} Close run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
