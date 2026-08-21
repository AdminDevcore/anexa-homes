import Link from "next/link";
import { AlertTriangle, ArrowRight, EyeOff } from "lucide-react";
import type { SetupGap } from "@/server/modules/settings/workspace-health";
import { VERTICAL_LABEL } from "@/lib/vertical";
import type { ActiveVertical } from "@/lib/vertical";

/**
 * What this workspace has never been set up with.
 *
 * Renders nothing when there is nothing to say — this is a panel you should
 * almost never see, not a permanent checklist. It exists because per-vertical
 * config does not carry across workspaces, so a second vertical starts empty
 * and every empty table fails silently rather than loudly.
 */
export function WorkspaceSetupPanel({
  gaps,
  vertical,
}: {
  gaps: SetupGap[];
  vertical: ActiveVertical;
}) {
  if (gaps.length === 0) return null;

  const blocking = gaps.filter((g) => g.severity === "blocking");
  const silent = gaps.filter((g) => g.severity === "silent");

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">
            {VERTICAL_LABEL[vertical]} is missing {gaps.length} piece
            {gaps.length === 1 ? "" : "s"} of setup
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configuration does not carry across workspaces — each one is set up on its own. Nothing
            below raises an error when it is empty; it just quietly does nothing.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {[...blocking, ...silent].map((gap) => (
          <Link
            key={gap.key}
            href={gap.href}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-amber-500/40"
          >
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                gap.severity === "blocking"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {gap.severity === "blocking" ? (
                "Blocking"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="size-2.5" /> Silent
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{gap.label}</span>
              <span className="block text-xs text-muted-foreground">{gap.hint}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
