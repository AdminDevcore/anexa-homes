"use client";

import * as React from "react";
import { Search, Loader2, CloudHail, Wind, Tornado, ShieldCheck } from "lucide-react";
import type { AddressCheckResult, StormReportHit } from "@/server/modules/storm/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const TYPE_ICON = { hail: CloudHail, wind: Wind, tornado: Tornado } as const;
const RADII = [1, 3, 5, 10];

function confTone(c: string | null): string {
  if (c === "High") return "bg-emerald-100 text-emerald-700";
  if (c === "Medium") return "bg-amber-100 text-amber-700";
  if (c === "Low") return "bg-muted text-muted-foreground";
  return "bg-muted text-muted-foreground";
}

export function AddressChecker() {
  const [q, setQ] = React.useState("");
  const [radius, setRadius] = React.useState(10);
  const [result, setResult] = React.useState<AddressCheckResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [showDebug, setShowDebug] = React.useState(false);

  async function check(r = radius) {
    if (q.trim().length < 4) {
      setErr("Enter a fuller address.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/storm/address-check?q=${encodeURIComponent(q.trim())}&radius=${r}`);
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Lookup failed.");
        setResult(null);
      } else {
        setResult(data);
      }
    } catch {
      setErr("Lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  function pickRadius(r: number) {
    setRadius(r);
    if (result?.matched) check(r);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm text-muted-foreground">
          Check any property for verified storm reports by distance — date of loss, hail/wind, and a confidence level.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && check()}
              placeholder="123 Main St, Plano, TX"
              className="pl-8"
            />
          </div>
          <Button onClick={() => check()} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check
          </Button>
        </div>
        {/* Radius selector */}
        <div className="mt-3 flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Radius:</span>
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pickRadius(r)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                radius === r ? "border-transparent bg-foreground text-background" : "border-border hover:bg-muted"
              }`}
            >
              {r} mi
            </button>
          ))}
        </div>
        {err ? <p className="mt-2 text-sm text-destructive">{err}</p> : null}
      </div>

      {result && !result.matched ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn&apos;t locate that address. Try adding city, state, or ZIP.
        </div>
      ) : null}

      {result && result.matched ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">{result.center?.label}</div>

          {!result.hasReport ? (
            <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm">
              <span className="font-medium">No verified report within {result.radiusMiles} miles.</span>
              <span className="text-muted-foreground"> Widen the radius or this address likely wasn&apos;t hit.</span>
            </div>
          ) : (
            <>
              {/* Headline: date of loss + confidence + score */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm">
                    Date of loss: <span className="font-medium">{fmtDate(result.dateOfLoss)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${confTone(result.confidence)}`}>
                      {result.confidence ?? "—"} confidence
                    </span>
                    {result.primary ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {result.primary.verified ? <ShieldCheck className="size-3.5 text-emerald-600" /> : null}
                        {result.primary.sourceLabel}
                      </span>
                    ) : result.swathHailIn != null ? (
                      <span className="text-xs text-muted-foreground">MRMS radar at this address</span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div className="font-display text-3xl font-semibold tabular-nums text-gold">{result.score}</div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Stat
                  label="Hail"
                  value={
                    result.swathHailIn != null
                      ? `${result.swathHailIn.toFixed(2)}″ (radar)`
                      : result.hailSizeIn != null
                        ? `${result.hailSizeIn.toFixed(2)}″`
                        : "—"
                  }
                />
                <Stat label="Max wind" value={result.maxWindMph != null ? `${result.maxWindMph} mph` : "—"} />
              </div>
            </>
          )}

          {/* Ring counts (always shown) */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {result.rings.map((r) => (
              <div key={r.miles} className="rounded-lg border border-border bg-background p-3 text-center">
                <div className="text-xs text-muted-foreground">within {r.miles} mi</div>
                <div className="font-display text-2xl font-semibold tabular-nums">{r.count}</div>
              </div>
            ))}
          </div>

          {/* Debug panel */}
          <details open={showDebug} onToggle={(e) => setShowDebug((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
              Debug — {result.events.length} report{result.events.length === 1 ? "" : "s"} within {result.radiusMiles} mi
            </summary>
            <div className="mt-2 space-y-2">
              {result.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No point reports in this radius.</p>
              ) : (
                result.events.map((e) => <DebugRow key={e.id} e={e} />)
              )}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function DebugRow({ e }: { e: StormReportHit }) {
  const Icon = TYPE_ICON[e.type];
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border border-border bg-background p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 font-medium capitalize">
          <Icon className="size-3.5 text-gold" /> {e.type}
        </span>
        <span className="text-muted-foreground">{e.sourceLabel}</span>
        {e.verified ? <span className="text-emerald-600">verified</span> : null}
        <span className={`rounded px-1.5 py-0.5 font-semibold ${confTone(e.confidence)}`}>{e.confidence ?? "—"}</span>
        <span>{e.distanceMiles} mi</span>
        <span>{fmtDate(e.eventAt)}</span>
        {e.hailSizeIn != null ? <span>{e.hailSizeIn.toFixed(2)}″ hail</span> : null}
        {e.windSpeedMph != null ? <span>{e.windSpeedMph} mph</span> : null}
        {e.tornadoScale ? <span>{e.tornadoScale}</span> : null}
      </div>
      <div className="mt-1 text-muted-foreground">
        lat/lng: {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
        {e.raw != null ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="ml-2 underline hover:text-foreground">
            {open ? "hide raw" : "raw row"}
          </button>
        ) : (
          <span className="ml-2 opacity-60">(no raw row stored)</span>
        )}
      </div>
      {open && e.raw != null ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">
          {JSON.stringify(e.raw, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
