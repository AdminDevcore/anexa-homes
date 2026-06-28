"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StormAtPoint, StormReportLite } from "@/server/modules/storm/queries";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function scoreTone(score: number): string {
  if (score >= 90) return "bg-red-100 text-red-700";
  if (score >= 50) return "bg-amber-100 text-amber-700";
  return "bg-muted text-muted-foreground";
}

/** One-line summary of a single storm report: what + distance + when. */
function reportLine(r: StormReportLite): string {
  const what =
    r.hailSizeIn != null
      ? `${r.hailSizeIn.toFixed(2)}″ hail`
      : r.windSpeedMph != null
        ? `${r.windSpeedMph} mph wind`
        : r.type;
  return `${what} · ${r.distanceMiles} mi · ${fmtDate(r.eventAt)}`;
}

/**
 * Compact storm history for a house, shown inside the canvassing popup. Fixed
 * min-height so the async fetch doesn't resize the Leaflet popup (which breaks
 * its positioning).
 */
export function HouseStormInfo({ lat, lng }: { lat: number; lng: number }) {
  const [open, setOpen] = React.useState(false);
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
          {data.swathHailIn != null ? (
            <div>
              Hail <b>{data.swathHailIn.toFixed(2)}″</b>{" "}
              <span className="text-muted-foreground">· radar at this address</span>
            </div>
          ) : data.maxHailIn != null ? (
            <div>
              Hail up to <b>{data.maxHailIn.toFixed(2)}″</b>{" "}
              <span className="text-muted-foreground">
                · nearby{data.nearest ? ` (${data.nearest.distanceMiles} mi away)` : ""}
              </span>
            </div>
          ) : null}
          {data.maxWindMph != null ? <div>Wind up to {data.maxWindMph} mph</div> : null}
          {data.dateOfLoss ? (
            <div>
              Date of loss: <b>{fmtDate(data.dateOfLoss)}</b>
            </div>
          ) : null}

          {/* Nearest report — the precise "when / where" for the closest event. */}
          {data.nearest ? (
            <div className="text-muted-foreground">
              Nearest:{" "}
              {data.nearest.hailSizeIn != null
                ? `${data.nearest.hailSizeIn.toFixed(2)}″ hail`
                : data.nearest.windSpeedMph != null
                  ? `${data.nearest.windSpeedMph} mph wind`
                  : data.nearest.type}{" "}
              · {data.nearest.distanceMiles} mi · {fmtDate(data.nearest.eventAt)}
              {data.reports[0]?.place ? ` · ${data.reports[0].place}` : ""}
            </div>
          ) : null}

          {/* Expandable list of the individual reports (when / where / source). */}
          {data.reports.length > 0 ? (
            <div>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              >
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {data.eventCount} report{data.eventCount === 1 ? "" : "s"} within 10mi
                {data.zoneName ? ` · zone: ${data.zoneName}` : ""}
              </button>
              {open ? (
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto border-l border-border pl-2">
                  {data.reports.map((r, i) => (
                    <li key={i} className="leading-tight">
                      <span className="font-medium">{reportLine(r)}</span>
                      <span className="text-muted-foreground">
                        {r.place ? ` · ${r.place}` : ""} · {r.source}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground">
              {data.eventCount} report{data.eventCount === 1 ? "" : "s"} within 10mi
              {data.zoneName ? ` · zone: ${data.zoneName}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
