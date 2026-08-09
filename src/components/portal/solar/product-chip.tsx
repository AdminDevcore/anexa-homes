import { Banknote, FileSignature, Landmark, Zap } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";

type IconType = React.ComponentType<{ className?: string }>;

const PRODUCTS: Record<FinanceProduct, { label: string; icon: IconType }> = {
  cash: { label: "Cash", icon: Banknote },
  loan: { label: "Loan", icon: Landmark },
  lease: { label: "Lease", icon: FileSignature },
  ppa: { label: "PPA", icon: Zap },
};

/**
 * A solar deal's financing product, stated but not settable.
 *
 * This used to be a live four-way picker in the Summary card — a second control
 * writing the same `SolarFinance.product` as the proposal's own Financing step.
 * The product is chosen alongside the escalator, term and monthly it belongs
 * with, inside the proposal; the Summary only has to answer "is this a lease?".
 */
export function SolarProductChip({ value }: { value: FinanceProduct | null }) {
  const opt = value ? PRODUCTS[value] : null;
  if (!opt) return <span className="text-sm font-medium text-muted-foreground">Not set</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-solar/45 bg-solar/10 px-2.5 py-1 text-xs font-semibold text-solar">
      <opt.icon className="size-3.5" />
      {opt.label}
    </span>
  );
}
