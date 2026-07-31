"use client";

// Binds the pure filter module to the URL. Filters live in query params so a
// refresh keeps the rep's view and a manager can share a link to exactly what
// they're looking at.
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  activeFilterCount,
  type FieldMapFilters,
} from "@/lib/field-map-filters";

export type MapFilters = {
  filters: FieldMapFilters;
  activeCount: number;
  set: <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => void;
  toggleDisposition: (value: string) => void;
  reset: () => void;
};

export function useMapFilters(): MapFilters {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Recomputed only when the query string actually changes. `dispositions` is a
  // Set, so a fresh object every render would churn every downstream memo and
  // re-render every Leaflet marker.
  const qs = searchParams.toString();
  const filters = React.useMemo(() => parseFilters(new URLSearchParams(qs)), [qs]);

  const push = React.useCallback(
    (next: FieldMapFilters) => {
      // `houses=off` is an E2E escape hatch that lives outside filter state; carry
      // it through so a filter change doesn't switch the live OSM fetch back on.
      const sp = new URLSearchParams(serializeFilters(next));
      const houses = new URLSearchParams(qs).get("houses");
      if (houses) sp.set("houses", houses);
      const query = sp.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, qs, router]
  );

  const set = React.useCallback(
    <K extends keyof FieldMapFilters>(key: K, value: FieldMapFilters[K]) => {
      push({ ...filters, [key]: value });
    },
    [filters, push]
  );

  const toggleDisposition = React.useCallback(
    (value: string) => {
      const next = new Set(filters.dispositions);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      push({ ...filters, dispositions: next });
    },
    [filters, push]
  );

  const reset = React.useCallback(() => push(DEFAULT_FILTERS), [push]);

  return { filters, activeCount: activeFilterCount(filters), set, toggleDisposition, reset };
}
