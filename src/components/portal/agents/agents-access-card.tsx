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
 */
export function AgentsAccessCard({ userId, name, on }: { userId: string; name: string; on: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = React.useState(on);
  const [seen, setSeen] = React.useState(on);
  const [busy, setBusy] = React.useState(false);
  if (seen !== on) {
    setSeen(on);
    setChecked(on);
  }

  async function change(next: boolean) {
    setBusy(true);
    setChecked(next);
    try {
      const res = await setAgentsAccessAction({ userId, on: next });
      if (!res.ok) {
        setChecked(!next);
        toast.error(res.error);
        return;
      }
      toast.success(next ? `${name} now has Agents access` : `Agents access removed from ${name}`);
      router.refresh();
    } catch {
      setChecked(!next);
      toast.error("Could not change Agents access. Try again.");
    } finally {
      setBusy(false);
    }
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
        <Switch checked={checked} onCheckedChange={change} disabled={busy} aria-label={`Agents access for ${name}`} />
      </div>
    </div>
  );
}
