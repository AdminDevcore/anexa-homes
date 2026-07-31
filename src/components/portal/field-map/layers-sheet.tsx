"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LayersPanel } from "./layers-panel";
import type { FieldMapFilters } from "@/lib/field-map-filters";

export type LayersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FieldMapFilters;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  /** Managers see the two planning layers (ZIP codes, weather warnings) too. */
  canManage: boolean;
};

/** The one place layers are switched, for every role. */
export function LayersSheet({ open, onOpenChange, filters, set, canManage }: LayersSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Built for a phone; on a wide screen an edge-to-edge sheet reads as a
        // page takeover, so cap it and centre it.
        className="gap-3 rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
      >
        <SheetHeader className="p-0 pr-8 text-left">
          <SheetTitle className="text-base font-semibold">Layers</SheetTitle>
        </SheetHeader>
        <LayersPanel filters={filters} set={set} canManage={canManage} />
      </SheetContent>
    </Sheet>
  );
}
