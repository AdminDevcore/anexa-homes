"use client";

import { CanvassingDashboard } from "./canvassing-dashboard";
import { CanvassingLeaderboard } from "./canvassing-leaderboard";

/** Leaderboard first — it's the section reps actually open. */
export function CanvassingInsights() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Leaderboard</h2>
        <CanvassingLeaderboard />
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Activity</h2>
        <CanvassingDashboard />
      </section>
    </div>
  );
}
