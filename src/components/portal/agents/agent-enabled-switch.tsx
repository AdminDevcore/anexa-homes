"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setAgentEnabledAction } from "@/server/modules/agents/actions";

/** On/off, for an owner or admin. The pages show everyone else the words instead. */
export function AgentEnabledSwitch({ agentId, name, enabled }: { agentId: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = React.useState(enabled);
  const [seen, setSeen] = React.useState(enabled);
  const [busy, setBusy] = React.useState(false);
  if (seen !== enabled) {
    setSeen(enabled);
    setChecked(enabled);
  }

  async function change(next: boolean) {
    setBusy(true);
    setChecked(next);
    try {
      const res = await setAgentEnabledAction(agentId, next);
      if (!res.ok) {
        setChecked(!next);
        toast.error(res.error);
        return;
      }
      toast.success(`${name} turned ${next ? "on" : "off"}`);
      router.refresh();
    } catch {
      setChecked(!next);
      toast.error("Could not change the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Switch
      data-testid="agent-enabled"
      checked={checked}
      onCheckedChange={change}
      disabled={busy}
      aria-label={`Enabled — ${name}`}
    />
  );
}
