import { cn } from "@/lib/utils";

/**
 * A name reduced to the two letters that let the eye pick a row out of a list
 * without reading it. Decorative — the name it stands for is always printed
 * next to it, so it is hidden from screen readers rather than repeated.
 */
export function Initials({ name, className }: { name: string; className?: string }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[10px] font-semibold text-gold-muted",
        className
      )}
    >
      {letters}
    </span>
  );
}
