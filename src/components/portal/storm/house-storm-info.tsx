"use client";

import { useQuery } from "@tanstack/react-query";
import type { StormAtPoint } from "@/server/modules/storm/queries";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function scoreTone(score: number): string {
  if (score >= 90) return "bg-red-100 text-red-700";
  if (score >= 50) return "bg-amber-100 text-amber-700";
  return "bg-muted text-muted-foreground";
}

/**
 * Compact storm history for a house, shown inside the canvassing popup. Fixed
 * min-height so the async fetch doesn't resize the Leaflet popup (which breaks
 * its positioning).
 */
export function HouseStormInfo({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading } = useQuery<StormAtPoint>({
    queryKey: ["storm-at", lat.toFixed(5), lng.toFixed(5)],
    queryFn: async () => {
      const res = await fetch(`/api/storm/at?lat=${lat}&lng=${lng}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const empty = data && data.eventCount === 0 && data.swathHailIn == null && data.hailSizeIn == null;

  return (
    <div className="min-h-[54px] rounded-md border border-border bg-muted/40 p-2 text-xs">
      {isLoading || !data ? (
        <span className="text-muted-foreground">Checking hail history…</span>
      ) : empty ? (
        <span className="text-muted-foreground">No storm history nearby.</span>
      ) : (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">⛈ Storm impact</span>
            <span className={`rounded px-1.5 py-0.5 font-semibold tabular-nums ${scoreTone(data.score)}`}>
              score {data.score}
            </span>
          </div>
          {data.hailSizeIn != null ? (
            <div>
              Hail up to <b>{data.hailSizeIn.toFixed(2)}″</b>
              {data.swathHailIn != null ? <span className="text-muted-foreground"> · radar</span> : null}
            </div>
          ) : null}
          {data.maxWindMph != null ? <div>Wind up to {data.maxWindMph} mph</div> : null}
          {data.dateOfLoss ? (
            <div>
              Date of loss: <b>{fmtDate(data.dateOfLoss)}</b>
            </div>
          ) : null}
          <div className="text-muted-foreground">
            {data.eventCount} report{data.eventCount === 1 ? "" : "s"} within 10mi
            {data.zoneName ? ` · zone: ${data.zoneName}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
