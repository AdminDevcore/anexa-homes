"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// Matches the map's hail-size scale (storm-map / canvassing-map).
const HAIL = [
  { c: "#3b82f6", l: '<0.5"' },
  { c: "#22c55e", l: '0.5"' },
  { c: "#eab308", l: '1"' },
  { c: "#f97316", l: '1.5"' },
  { c: "#ef4444", l: '2"' },
  { c: "#d946ef", l: '2.5"+' },
];
const SCORE = [
  { c: "#eab308", l: "20+" },
  { c: "#f97316", l: "50+" },
  { c: "#ef4444", l: "90+" },
];

/** Map legend for the storm overlays — hail-size + storm-score color keys, plus
 *  the MRMS experimental-data note. Rendered as an overlay on the Field Map. */
export function FieldMapLegend({ showHail, showHeat }: { showHail: boolean; showHeat: boolean }) {
  const [open, setOpen] = React.useState(true);
  if (!showHail && !showHeat) return null;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-[1000] max-w-[250px] rounded-lg border border-border bg-background/92 p-2.5 text-[11px] shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 font-semibold"
      >
        <span>Legend</span>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>

      {open ? (
        <>
          {showHail ? (
            <div className="mt-1.5">
              <div className="mb-1 text-muted-foreground">Hail size</div>
              <div className="flex items-center gap-1">
                {HAIL.map((h) => (
                  <div key={h.l} className="flex flex-col items-center gap-0.5">
                    <span className="size-3 rounded-sm" style={{ backgroundColor: h.c }} />
                    <span className="text-[9px] text-muted-foreground">{h.l}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showHeat ? (
            <div className="mt-2">
              <div className="mb-1 text-muted-foreground">Storm score</div>
              <div className="flex items-center gap-2.5">
                {SCORE.map((s) => (
                  <span key={s.l} className="inline-flex items-center gap-1">
                    <span className="size-3 rounded-full" style={{ backgroundColor: s.c }} />
                    <span className="text-[10px]">{s.l}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-2 border-t border-border pt-1.5 text-[10px] leading-snug text-muted-foreground">
            Radar hail = NOAA MRMS (experimental). A prospecting aid — not a claim verification.
          </div>
        </>
      ) : null}
    </div>
  );
}
