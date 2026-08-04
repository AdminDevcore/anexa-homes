"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LayersPanel } from "./layers-panel";
import type { FieldMapFilters } from "@/lib/field-map-filters";

export type LayersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FieldMapFilters;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  storm: boolean;
};

/** Rep-only. Managers get the same panel inside the rail instead. */
export function LayersSheet({ open, onOpenChange, filters, set, storm }: LayersSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-3 rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <SheetHeader className="p-0 pr-8 text-left">
          <SheetTitle className="text-base font-semibold">Layers</SheetTitle>
        </SheetHeader>
        <LayersPanel filters={filters} set={set} canManage={false} storm={storm} />
      </SheetContent>
    </Sheet>
  );
}
