"use client";

import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StormMapTab } from "./storm-map-tab";
import { StormLeads } from "./storm-leads";
import { AddressChecker } from "./address-checker";
import { StormZones } from "./storm-zones";
import { StormImportDialog } from "./storm-import-dialog";
import type { StormMeta } from "./types";

export function StormIntelligenceShell() {
  const { data: meta } = useQuery<StormMeta>({
    queryKey: ["storm-meta"],
    queryFn: async () => {
      const res = await fetch("/api/storm/meta");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Storm Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            NOAA + SPC storm data → scored canvassing opportunities.
          </p>
        </div>
        {meta?.canManage ? <StormImportDialog /> : null}
      </div>

      <Tabs defaultValue="map" className="space-y-4">
        <TabsList>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="leads">Storm leads</TabsTrigger>
          <TabsTrigger value="checker">Address checker</TabsTrigger>
          <TabsTrigger value="zones">Zones</TabsTrigger>
        </TabsList>

        {/* forceMount keeps the Leaflet map mounted across tab switches. */}
        <TabsContent value="map" forceMount className="data-[state=inactive]:hidden">
          {meta ? <StormMapTab meta={meta} /> : <Loading />}
        </TabsContent>
        <TabsContent value="leads">
          <StormLeads />
        </TabsContent>
        <TabsContent value="checker">
          <AddressChecker />
        </TabsContent>
        <TabsContent value="zones">{meta ? <StormZones meta={meta} /> : <Loading />}</TabsContent>
      </Tabs>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid h-[40vh] place-items-center text-sm text-muted-foreground">Loading…</div>
  );
}
