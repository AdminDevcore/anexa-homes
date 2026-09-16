"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setAgentEnabledAction } from "@/server/modules/agents/actions";

/**
 * On/off, for an owner or admin. The pages show everyone else the words instead.
 *
 * Optimistic + transition, the house pattern (deal-type-toggle.tsx,
 * claim-status-select.tsx): the switch paints immediately and holds until
 * router.refresh() lands the real value — the refresh runs INSIDE the
 * transition, so React keeps the optimistic value until the new server payload
 * commits. `useOptimistic` is level-triggered, showing whatever the server last
 * said, so there is no `seen` bookkeeping to fall out of step with the prop.
 *
 * The `try` wraps ONLY the action call. Nothing after a successful write may
 * report failure: on a dropped response the database would say on while the row
 * said off — and the agent would fire on schedule regardless.
 */
export function AgentEnabledSwitch({ agentId, name, enabled }: { agentId: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [optimistic, setOptimistic] = React.useOptimistic(enabled);
  const [busy, startSwitch] = React.useTransition();

  function change(next: boolean) {
    if (busy) return;
    startSwitch(async () => {
      setOptimistic(next);
      const res = await setAgentEnabledAction(agentId, next).catch(() => null);
      if (res === null) {
        // Whether the write landed is unknown, so re-read the truth rather than
        // asserting the opposite of what may have happened.
        toast.error("Could not change the agent. Try again.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${name} turned ${next ? "on" : "off"}`);
      router.refresh();
    });
  }

  return (
    <Switch
      data-testid="agent-enabled"
      checked={optimistic}
      onCheckedChange={change}
      disabled={busy}
      aria-label={`Enabled — ${name}`}
    />
  );
}
