import type { AgentRunStatus } from "@prisma/client";
import { STATUS_CHIP, STATUS_LABEL } from "@/lib/agent-labels";
import { cn } from "@/lib/utils";

export function RunStatusPill({ status }: { status: AgentRunStatus }) {
  return (
    <span
      data-testid="run-status"
      className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_CHIP[status])}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
