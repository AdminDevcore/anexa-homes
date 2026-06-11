"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CanvassingClient } from "./canvassing-client";
import { CanvassingLeaderboard } from "./canvassing-leaderboard";
import { CanvassingList } from "./canvassing-list";
import { CanvassingDashboard } from "./canvassing-dashboard";
import { CanvassingCalendar } from "./canvassing-calendar";

export function CanvassingShell() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Canvassing</h1>
      </div>
      <Tabs defaultValue="map" className="space-y-4">
        <TabsList>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
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
        <TabsContent value="calendar">
          <CanvassingCalendar />
        </TabsContent>
        <TabsContent value="leaderboard">
          <CanvassingLeaderboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
