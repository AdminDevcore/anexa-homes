"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FinanceProduct } from "@prisma/client";
import { cn } from "@/lib/utils";
import { setSolarFinanceProductAction } from "@/server/modules/solar/actions";

const PRODUCTS: { value: FinanceProduct; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "loan", label: "Loan" },
  { value: "lease", label: "Lease" },
  { value: "ppa", label: "PPA" },
];

/**
 * A solar deal's type is its FINANCING PRODUCT.
 *
 * The roofing Insurance-vs-Cash toggle has no meaning here: there is no
 * insurer, no claim and no deductible on a solar deal. What actually varies —
 * and what changes the pricing model, the commission basis and the customer's
 * proposal — is whether they buy it, finance it, lease it, or buy the power.
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
  const [busy, setBusy] = React.useState(false);

  async function pick(product: FinanceProduct) {
    if (product === value || busy) return;
    setBusy(true);
    const res = await setSolarFinanceProductAction({ leadId, product });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Financing set to ${product.toUpperCase()}`);
    router.refresh();
  }

  if (!canEdit) {
    return (
      <span className="text-sm font-medium">
        {value ? (PRODUCTS.find((p) => p.value === value)?.label ?? value) : "Not set"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {PRODUCTS.map((p) => (
        <button
          key={p.value}
          disabled={busy}
          onClick={() => pick(p.value)}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
            value === p.value
              ? "border-transparent bg-foreground text-background"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
