import type { Vertical } from "@prisma/client";
import { VERTICAL_ACCENT, VERTICAL_LABEL } from "@/lib/vertical";
import { cn } from "@/lib/utils";

/**
 * The workspace a row came from, in that workspace's accent colour.
 *
 * Used anywhere a list can legitimately mix workspaces — notifications, global
 * search, the combined calendar, the activity log. Those surfaces are filtered
 * by permission rather than by the active workspace, so without a label a user
 * cannot tell a Solar alert from a Roofing one.
 *
 * `null` means the row is company-level (payroll, an announcement, a Company
 * task) and belongs to every workspace, so it is labelled as such rather than
 * being left unmarked — an unlabelled row in a labelled list reads as a bug.
 *
 * Callers gate on `worksAcrossVerticals(user)`: in a single-workspace company
 * every row would carry the same tag, which is pure noise.
 */
export function WorkspaceTag({
  vertical,
  className,
}: {
  vertical: Vertical | null;
  className?: string;
}) {
  const label = vertical ? VERTICAL_LABEL[vertical] : "Company";
  const accent = vertical ? VERTICAL_ACCENT[vertical] : "#64748B";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        className
      )}
      style={{
        borderColor: `${accent}55`,
        backgroundColor: `${accent}14`,
        color: accent,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: accent }} />
      {label}
    </span>
  );
}
