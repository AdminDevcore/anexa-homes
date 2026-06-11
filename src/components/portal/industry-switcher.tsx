"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Industry } from "@prisma/client";
import { INDUSTRY_LABEL, INDUSTRY_ACCENT } from "@/lib/industry";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { setActiveIndustryAction } from "@/server/modules/industry/actions";

// Top-right workspace switcher. Each industry is an isolated portal; switching
// reloads the deal flow scoped to that industry. Users only see industries they
// can access (set by the super admin).
export function IndustrySwitcher({ active, industries }: { active: Industry; industries: Industry[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function pick(ind: Industry) {
    if (ind === active || busy) return;
    setBusy(true);
    const res = await setActiveIndustryAction(ind);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    router.push("/portal/dashboard");
    router.refresh();
  }

  const Dot = ({ ind }: { ind: Industry }) => (
    <span className="size-2.5 shrink-0 rounded-full" style={{ background: INDUSTRY_ACCENT[ind] }} />
  );

  // Single-industry users can't switch — show a static badge.
  if (industries.length <= 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium">
        <Dot ind={active} /> {INDUSTRY_LABEL[active]}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={busy}
          aria-label="Switch industry"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          <Dot ind={active} /> {INDUSTRY_LABEL[active]}
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch workspace</DropdownMenuLabel>
        {industries.map((ind) => (
          <DropdownMenuItem key={ind} onClick={() => pick(ind)} className="gap-2">
            <Dot ind={ind} />
            <span className="flex-1">{INDUSTRY_LABEL[ind]}</span>
            {ind === active && <Check className="size-4 text-gold" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
