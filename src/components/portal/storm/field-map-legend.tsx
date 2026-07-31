"use client";

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

/**
 * Colour key for the Hail and Storm-score overlays.
 *
 * This used to float over the map as a collapsed pill, which put a third
 * element in the bottom strip alongside the status bar and the view switcher.
 * It now renders inside the Layers panel, directly under the toggles it
 * explains — you read a key at the moment you switch the layer on, not while
 * you're walking a street.
 */
export function FieldMapLegend({ showHail, showHeat }: { showHail: boolean; showHeat: boolean }) {
  if (!showHail && !showHeat) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px]">
      {showHail ? (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">Hail size</div>
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
        <div>
          <div className="mb-1 font-medium text-muted-foreground">Storm score</div>
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

      {showHail ? (
        <p className="border-t border-border pt-1.5 text-[10px] leading-snug text-muted-foreground">
          Radar hail = NOAA MRMS (experimental). A prospecting aid — not a claim verification.
        </p>
      ) : null}
    </div>
  );
}
