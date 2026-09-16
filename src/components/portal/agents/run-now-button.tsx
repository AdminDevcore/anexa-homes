"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
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
import { PRODUCT_LABEL, productOf } from "@/lib/agent-labels";
import { runAgentNowAction } from "@/server/modules/agents/actions";

/**
 * Run now. A disabled agent asks first: once real portal agents exist,
 * "disabled" usually means somebody turned it off on purpose. The server asks
 * the same question (`needsConfirm`), so a page that was open when the agent
 * was switched off still gets the prompt.
 */
export function RunNowButton({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function run(confirmDisabled: boolean) {
    setBusy(true);
    try {
      const res = await runAgentNowAction(agentId, { confirmDisabled });
      if (!res.ok) {
        if ("needsConfirm" in res && res.needsConfirm) {
          setAsking(true);
          return;
        }
        toast.error(res.error);
        router.refresh(); // a missing handler has still written its failed runs
        return;
      }
      setAsking(false);
      // A "both workspaces" agent with one run already in flight starts one, not
      // two. That is not a failure — the intent is satisfied — but saying
      // "Started in 2 workspaces" when one of them did not start would be a
      // lie, and this button is the only place a person would ever see it.
      toast.success(
        res.skipped
          ? `Started in ${PRODUCT_LABEL[productOf(res.skipped)]} only — the other workspace already had a run in progress.`
          : res.runIds.length === 1
            ? "Started. The run appears below."
            : `Started in ${res.runIds.length} workspaces. The runs appear below.`
      );
      router.refresh();
    } catch {
      toast.error("Could not start the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" data-testid="agent-run-now" disabled={busy} onClick={() => (enabled ? void run(false) : setAsking(true))}>
        {busy && !asking ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run now
      </Button>
      <AlertDialog open={asking} onOpenChange={(open) => !busy && setAsking(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run a disabled agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent is turned off, possibly on purpose. Running it now does not turn it back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void run(true);
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
