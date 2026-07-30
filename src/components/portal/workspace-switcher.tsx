"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";
import { VERTICAL_LABEL, VERTICAL_ACCENT, type ActiveVertical } from "@/lib/vertical";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { setActiveVerticalAction } from "@/server/modules/vertical/actions";

/** Module scope on purpose — react-hooks/static-components is an error here. */
function Dot({ v }: { v: ActiveVertical }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full ring-2 ring-white/15"
      style={{ background: VERTICAL_ACCENT[v] }}
    />
  );
}

/**
 * Top-bar workspace switcher.
 *
 * Roofing and Solar are separate businesses sharing one portal. A rep acting in
 * the wrong one books a deal into the wrong department, so the active workspace
 * is deliberately loud: a tinted pill carrying the vertical's own accent colour,
 * plus an accent strip across the top of the shell (see portal-shell.tsx).
 *
 * Users who can only reach one workspace get a static badge, not a control —
 * there is nothing to choose, and a dead dropdown invites a misclick.
 */
export function WorkspaceSwitcher({
  active,
  available,
}: {
  active: ActiveVertical;
  available: ActiveVertical[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function pick(next: ActiveVertical) {
    if (next === active || busy) return;
    setBusy(true);
    const res = await setActiveVerticalAction(next);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // Land on the dashboard rather than staying put: the current record almost
    // certainly belongs to the workspace we just left.
    router.push("/portal/dashboard");
    router.refresh();
  }

  const tint = {
    background: `color-mix(in srgb, ${VERTICAL_ACCENT[active]} 18%, transparent)`,
    borderColor: `color-mix(in srgb, ${VERTICAL_ACCENT[active]} 45%, transparent)`,
  } as React.CSSProperties;

  if (available.length <= 1) {
    return (
      <span
        data-testid="workspace-badge"
        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium"
        style={tint}
      >
        <Dot v={active} />
        {VERTICAL_LABEL[active]}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={busy}
          aria-label="Switch workspace"
          data-testid="workspace-switcher"
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors hover:brightness-125 disabled:opacity-60"
          style={tint}
        >
          <Dot v={active} />
          {VERTICAL_LABEL[active]}
          <ChevronsUpDown className="size-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch workspace
        </DropdownMenuLabel>
        {available.map((v) => (
          <DropdownMenuItem key={v} onClick={() => pick(v)} className="gap-2">
            <Dot v={v} />
            <span className="flex-1">{VERTICAL_LABEL[v]}</span>
            {v === active && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
