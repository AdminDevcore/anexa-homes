"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FieldMap } from "./field-map/field-map";
import type { StormTab } from "./field-map/manager-rail";
import { CanvassingInsights } from "./canvassing-insights";
import { CanvassingList } from "./canvassing-list";
import { StormLeads } from "./storm/storm-leads";
import { AddressChecker } from "./storm/address-checker";
import { StormZones } from "./storm/storm-zones";
import { StormImportDialog } from "./storm/storm-import-dialog";
import type { StormMeta } from "./storm/types";

/**
 * @param canStorm StormIntelligence permission AND a vertical that has storms.
 *   Roofing prospects off hail; solar does not, so its Field Map is territories
 *   and knocks with no storm surface anywhere on it.
 */
export function CanvassingShell({ canStorm, googleTiles }: { canStorm: boolean; googleTiles: boolean }) {
  // Storm Intelligence is folded into the Field Map. Its tools are reachable
  // from the manager rail rather than as top-level tabs.
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

  const [tab, setTab] = React.useState("map");
  const onMap = tab === "map";

  return (
    // On the map tab the page is the map: no heading, no tab strip, no padding.
    <div className={onMap ? "" : "space-y-4"}>
      {!onMap && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">Field Map</h1>
            <p className="text-sm text-muted-foreground">
              {canStorm ? "Canvassing + storm intelligence in one map." : "Canvassing and territories in one map."}
            </p>
          </div>
          {canStorm && stormMeta?.canManage ? <StormImportDialog /> : null}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className={onMap ? "" : "space-y-4"}>
        {!onMap && (
          <TabsList>
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            {/* Storm tools are opened from the manager rail, not the tab strip. */}
            {canStorm && <TabsTrigger value="storm-leads">Storm leads</TabsTrigger>}
            {canStorm && <TabsTrigger value="storm-checker">Address checker</TabsTrigger>}
            {canStorm && <TabsTrigger value="storm-zones">Storm zones</TabsTrigger>}
          </TabsList>
        )}

        {/* forceMount keeps the Leaflet map alive across tab switches; tearing it
            down on switch throws "_leaflet_pos". Radix hides it when inactive. */}
        <TabsContent value="map" forceMount className="data-[state=inactive]:hidden">
          <FieldMap
            tab={tab}
            onChangeTab={setTab}
            onOpenStormTab={(t: StormTab) => setTab(t)}
            storm={canStorm}
            googleTiles={googleTiles}
          />
        </TabsContent>
        <TabsContent value="list">
          <CanvassingList />
        </TabsContent>
        <TabsContent value="insights">
          <CanvassingInsights />
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
