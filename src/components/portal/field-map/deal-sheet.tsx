"use client";

import { useRouter } from "next/navigation";
import { Move, Check } from "lucide-react";
import type { DealDTO } from "@/server/modules/canvassing/queries";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HouseStormInfo } from "@/components/portal/storm/house-storm-info";
import { usd } from "./dialogs";

export type DealSheetProps = {
  deal: DealDTO | null;
  onClose: () => void;
  onMove: (d: DealDTO) => void;
  /** Hail history for the address — meaningless outside a storm vertical. */
  storm: boolean;
};

export function DealSheet({ deal, onClose, onMove, storm }: DealSheetProps) {
  const router = useRouter();
  if (!deal) return null;
  const d = deal;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-3 overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <SheetHeader className="gap-1 p-0 pr-8 text-left">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle className="text-base font-semibold leading-tight">{d.name}</SheetTitle>
            {d.stageName && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                style={{ background: d.stageColor ?? "#6366f1" }}
              >
                {d.stageName}
              </span>
            )}
          </div>
          {d.address && <p className="text-xs text-muted-foreground">{d.address}</p>}
        </SheetHeader>

        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            {d.repName ? `Rep: ${d.repName}` : "Unassigned"}
            {d.value ? ` · ${usd(d.value)}` : ""}
          </div>
          {d.appointmentAt && (
            <div className="font-medium text-gold">
              Appointment: {new Date(d.appointmentAt).toLocaleString()}
            </div>
          )}
          {d.phone && <div>{d.phone}</div>}
        </div>
        {d.note && <p className="line-clamp-3 text-sm text-muted-foreground">{d.note}</p>}

        {storm && <HouseStormInfo lat={d.lat} lng={d.lng} />}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <button
            onClick={() => router.push(`/portal/leads/${d.id}`)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:underline"
          >
            <Check className="size-4" /> Open deal
          </button>
          <button
            onClick={() => onMove(d)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Move className="size-4" /> Move pin
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
