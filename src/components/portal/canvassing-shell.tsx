"use client";

import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CanvassingClient } from "./canvassing-client";
import { CanvassingLeaderboard } from "./canvassing-leaderboard";
import { CanvassingList } from "./canvassing-list";
import { CanvassingDashboard } from "./canvassing-dashboard";
import { StormLeads } from "./storm/storm-leads";
import { AddressChecker } from "./storm/address-checker";
import { StormZones } from "./storm/storm-zones";
import { StormImportDialog } from "./storm/storm-import-dialog";
import type { StormMeta } from "./storm/types";

export function CanvassingShell({ canStorm }: { canStorm: boolean }) {
  // Storm Intelligence is now folded into the Field Map. Its tools live as tabs
  // here; the map tab already fuses the storm overlays (Hail/Warnings/Heat).
  const { data: stormMeta } = useQuery<StormMeta>({
    queryKey: ["storm-meta"],
    queryFn: async () => {
      const res = await fetch("/api/storm/meta");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: canStorm,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Field Map</h1>
          <p className="text-sm text-muted-foreground">Canvassing + storm intelligence in one map.</p>
        </div>
        {canStorm && stormMeta?.canManage ? <StormImportDialog /> : null}
      </div>
      <Tabs defaultValue="map" className="space-y-4">
        <TabsList>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          {canStorm && <TabsTrigger value="storm-leads">Storm leads</TabsTrigger>}
          {canStorm && <TabsTrigger value="storm-checker">Address checker</TabsTrigger>}
          {canStorm && <TabsTrigger value="storm-zones">Storm zones</TabsTrigger>}
        </TabsList>
        {/* forceMount keeps the Leaflet map alive across tab switches; tearing it
            down on switch throws "_leaflet_pos". Radix hides it when inactive. */}
        <TabsContent value="map" forceMount className="data-[state=inactive]:hidden">
          <CanvassingClient />
        </TabsContent>
        <TabsContent value="list">
          <CanvassingList />
        </TabsContent>
        <TabsContent value="dashboard">
          <CanvassingDashboard />
        </TabsContent>
        <TabsContent value="leaderboard">
          <CanvassingLeaderboard />
        </TabsContent>
        {canStorm && (
          <>
            <TabsContent value="storm-leads">
              <StormLeads />
            </TabsContent>
            <TabsContent value="storm-checker">
              <AddressChecker />
            </TabsContent>
            <TabsContent value="storm-zones">
              {stormMeta ? (
                <StormZones meta={stormMeta} />
              ) : (
                <div className="grid h-[40vh] place-items-center text-sm text-muted-foreground">Loading…</div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
