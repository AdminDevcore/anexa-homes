import { cn } from "@/lib/utils";

/**
 * One vocabulary for both halves of Pay.
 *
 * A commission and a contractor invoice walk the same road — pending →
 * approved → paid, with void as the way out — so they are coloured the same
 * way, and the colour carries the meaning the word already has: amber is
 * waiting on a person, gold is money the company has committed to, green is
 * money that has left, grey is over.
 *
 * "Submitted" is the contractor side's one extra state: an invoice that exists
 * but is not yet a payable, because nobody has pressed Generate on it.
 */
const TONES: Record<string, string> = {
  submitted: "border-border bg-muted text-muted-foreground",
  pending: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "border-gold/40 bg-gold/10 text-gold-muted",
  paid: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  void: "border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/50",
};

export function PayStatus({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
        TONES[status] ?? TONES.submitted,
        className
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
      {status}
    </span>
  );
}
