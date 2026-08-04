"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClaimStatusOption } from "@/lib/claim-status";
import { setClaimStatusAction } from "@/server/modules/leads/manage";

/**
 * Where the claim actually IS — set from the deal Summary.
 *
 * A live control like the deal-type toggle beside it, not an Edit-mode field:
 * claim status changes on a phone call with the carrier, and burying it behind
 * Edit → Save is two clicks too many for something a coordinator touches daily.
 * Until this existed there was no way to move a claim past "filed" at all.
 *
 * `options` is the company's configured list (Settings → Claim Statuses),
 * already widened to include this deal's current value if it was since removed.
 */
export function ClaimStatusSelect({
  leadId,
  value,
  options,
  canEdit,
}: {
  leadId: string;
  value: string;
  options: ClaimStatusOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  // Optimistic + transition, same as DealTypeToggle: the pick paints instantly
  // and holds until router.refresh() lands the real value, reverting on failure.
  const [selected, setSelected] = React.useOptimistic(value);
  const [busy, startSwitch] = React.useTransition();

  const label = options.find((o) => o.key === selected)?.label ?? selected;

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/45 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold">
        <ShieldCheck className="size-3.5" />
        {label}
      </span>
    );
  }

  function pick(next: string) {
    if (next === selected || busy) return;
    startSwitch(async () => {
      setSelected(next);
      const res = await setClaimStatusAction({ leadId, status: next });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Claim: ${options.find((o) => o.key === next)?.label ?? next}`);
      router.refresh();
    });
  }

  return (
    <Select value={selected} onValueChange={pick} disabled={busy}>
      <SelectTrigger className="w-full" aria-label="Claim Status">
        {busy ? (
          <span className="flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            {label}
          </span>
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
