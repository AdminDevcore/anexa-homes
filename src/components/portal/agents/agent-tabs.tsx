import Link from "next/link";
import { AGENT_TABS } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Agents | Runs. Both tabs belong to everyone who can open either, so unlike
 * PayTabs there is no per-tab check. `waiting` is the unresolved needs-a-human
 * count, drawn on Runs so it is seen from the Agents list as well.
 */
export function AgentTabs({ active, waiting }: { active: "/portal/agents" | "/portal/agents/runs"; waiting: number }) {
  return (
    <nav aria-label="Agents sections" className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
      {AGENT_TABS.map((t) => {
        const isActive = t.href === active;
        const count = t.href === "/portal/agents/runs" ? waiting : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              isActive
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            <t.icon className="size-4 shrink-0" />
            {t.label}
            {count > 0 && (
              <span className="rounded-full border chip-warning px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {count}
                <span className="sr-only"> need a human</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
