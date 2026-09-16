"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setAgentsAccessAction } from "@/server/modules/team/actions";

/**
 * Team → member, on a manager, seen by the owner. One switch, and one sentence
 * saying exactly what it grants and what it does not.
 *
 * Optimistic + transition, the house pattern (deal-type-toggle.tsx,
 * claim-status-select.tsx): the switch paints immediately and holds until
 * router.refresh() lands the real value, which is why the refresh runs INSIDE
 * the transition. `useOptimistic` is level-triggered, so the control shows
 * whatever the server last said with no `seen` bookkeeping.
 *
 * The `try` wraps ONLY the action call. On a permissions control, telling the
 * owner the opposite of what happened is the bad kind of wrong: a throw after a
 * successful write would have reverted the switch and said it failed, while the
 * person really did hold Agents access.
 */
export function AgentsAccessCard({ userId, name, on }: { userId: string; name: string; on: boolean }) {
  const router = useRouter();
  const [optimistic, setOptimistic] = React.useOptimistic(on);
  const [busy, startSwitch] = React.useTransition();

  function change(next: boolean) {
    if (busy) return;
    startSwitch(async () => {
      setOptimistic(next);
      const res = await setAgentsAccessAction({ userId, on: next }).catch(() => null);
      if (res === null) {
        // Whether the write landed is unknown, so re-read the truth rather than
        // asserting the opposite of what may have happened.
        toast.error("Could not change Agents access. Try again.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next ? `${name} now has Agents access` : `Agents access removed from ${name}`);
      router.refresh();
    });
  }

  return (
    <div data-testid="agents-access-card" className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <Bot className="size-4 text-muted-foreground" /> Agents access
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Can view agents and runs, run an agent, and resolve runs that need a human. Cannot create or edit agents.
          </p>
        </div>
        <Switch checked={optimistic} onCheckedChange={change} disabled={busy} aria-label={`Agents access for ${name}`} />
      </div>
    </div>
  );
}
