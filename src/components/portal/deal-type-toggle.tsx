"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Check, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { setDealTypeAction } from "@/server/modules/leads/manage";

type DealType = "cash" | "insurance";

/**
 * The two ways a roof gets paid for. Colour carries the meaning here — gold for
 * the carrier claim, emerald for money — so the deal's funding path is legible
 * from across the card without reading the label.
 */
const OPTIONS = [
  {
    value: "insurance" as const,
    label: "Insurance",
    hint: "Carrier claim",
    readLabel: "Insurance claim",
    icon: ShieldCheck,
    active: "border-gold/45 bg-gold/10 text-gold",
    accent: "text-gold",
  },
  {
    value: "cash" as const,
    label: "Cash",
    hint: "Retail / financed",
    readLabel: "Cash / financed",
    icon: Banknote,
    active:
      "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
];

/** Insurance/Cash picker shown in the deal Summary. Read-only users see a
 *  static badge; editors can flip the deal type (drives claim/scope/proposal). */
export function DealTypeToggle({ leadId, value, canEdit }: { leadId: string; value: DealType; canEdit: boolean }) {
  const router = useRouter();
  // The pick paints immediately and holds until the refreshed page brings the
  // real value down — router.refresh() runs INSIDE the transition, so React
  // keeps the optimistic value until the new server payload commits. On a failed
  // action it reverts on its own.
  const [selected, setSelected] = React.useOptimistic(value);
  const [busy, startSwitch] = React.useTransition();

  function pick(next: DealType) {
    if (next === selected || busy) return;
    startSwitch(async () => {
      setSelected(next);
      const res = await setDealTypeAction({ leadId, dealType: next });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next === "cash" ? "Switched to cash deal" : "Switched to insurance claim");
      router.refresh();
    });
  }

  if (!canEdit) {
    const opt = OPTIONS.find((o) => o.value === value)!;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
          opt.active,
        )}
      >
        <opt.icon className="size-3.5" />
        {opt.readLabel}
      </span>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {OPTIONS.map((o) => {
        const on = selected === o.value;
        // Only the chip being switched TO spins; the one being left just dims.
        const saving = busy && on;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={busy}
            onClick={() => pick(o.value)}
            className={cn(
              "relative flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed",
              on
                ? o.active
                : "border-border bg-transparent text-muted-foreground hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground",
              busy && !on && "opacity-50",
            )}
          >
            <span className="flex w-full items-center gap-1.5">
              {saving ? (
                <Loader2 className={cn("size-3.5 shrink-0 animate-spin", o.accent)} />
              ) : (
                <o.icon className={cn("size-3.5 shrink-0", on ? o.accent : "text-muted-foreground")} />
              )}
              <span className="text-xs font-semibold">{o.label}</span>
              {on && !saving && <Check className={cn("ml-auto size-3.5 shrink-0", o.accent)} />}
            </span>
            <span
              className={cn(
                "text-[10px] leading-tight",
                on ? "opacity-80" : "text-muted-foreground/70",
              )}
            >
              {o.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
