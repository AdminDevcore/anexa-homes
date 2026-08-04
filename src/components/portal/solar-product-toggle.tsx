"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Check, FileSignature, Landmark, Loader2, Zap } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";
import { cn } from "@/lib/utils";
import { setSolarFinanceProductAction } from "@/server/modules/solar/actions";

type IconType = React.ComponentType<{ className?: string }>;

const PRODUCTS: { value: FinanceProduct; label: string; icon: IconType }[] = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "loan", label: "Loan", icon: Landmark },
  { value: "lease", label: "Lease", icon: FileSignature },
  { value: "ppa", label: "PPA", icon: Zap },
];

/**
 * A solar deal's type is its FINANCING PRODUCT.
 *
 * The roofing Insurance-vs-Cash toggle has no meaning here: there is no
 * insurer, no claim and no deductible on a solar deal. What actually varies —
 * and what changes the pricing model, the commission basis and the customer's
 * proposal — is whether they buy it, finance it, lease it, or buy the power.
 *
 * Shares the chip vocabulary of the roofing deal-type picker, since both land in
 * the same Summary slot; only the accent differs (sky, not gold).
 */
export function SolarProductToggle({
  leadId,
  value,
  canEdit,
}: {
  leadId: string;
  value: FinanceProduct | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  // Paints the pick immediately and holds it until the refreshed page brings the
  // real value down — router.refresh() runs inside the transition. Reverts by
  // itself if the action fails.
  const [selected, setSelected] = React.useOptimistic(value);
  const [busy, startSwitch] = React.useTransition();

  function pick(product: FinanceProduct) {
    if (product === selected || busy) return;
    startSwitch(async () => {
      setSelected(product);
      const res = await setSolarFinanceProductAction({ leadId, product });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Financing set to ${product.toUpperCase()}`);
      router.refresh();
    });
  }

  if (!canEdit) {
    const opt = PRODUCTS.find((p) => p.value === value);
    if (!opt) return <span className="text-sm font-medium text-muted-foreground">Not set</span>;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-solar/45 bg-solar/10 px-2.5 py-1 text-xs font-semibold text-solar">
        <opt.icon className="size-3.5" />
        {opt.label}
      </span>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {PRODUCTS.map((p) => {
        const on = selected === p.value;
        // Only the chip being switched TO spins; the others just dim.
        const saving = busy && on;
        return (
          <button
            key={p.value}
            type="button"
            aria-pressed={on}
            disabled={busy}
            onClick={() => pick(p.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed",
              on
                ? "border-solar/45 bg-solar/10 text-solar"
                : "border-border text-muted-foreground hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground",
              busy && !on && "opacity-50",
            )}
          >
            {saving ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-solar" />
            ) : (
              <p.icon className={cn("size-3.5 shrink-0", on ? "text-solar" : "text-muted-foreground")} />
            )}
            {p.label}
            {on && !saving && <Check className="ml-auto size-3.5 shrink-0 text-solar" />}
          </button>
        );
      })}
    </div>
  );
}
