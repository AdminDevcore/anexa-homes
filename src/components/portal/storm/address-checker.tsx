"use client";

import * as React from "react";
import { Search, Loader2, CloudHail, Wind, Tornado } from "lucide-react";
import type { AddressCheckResult } from "@/server/modules/storm/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const TYPE_ICON = { hail: CloudHail, wind: Wind, tornado: Tornado } as const;

export function AddressChecker() {
  const [q, setQ] = React.useState("");
  const [result, setResult] = React.useState<AddressCheckResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function check() {
    if (q.trim().length < 4) {
      setErr("Enter a fuller address.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/storm/address-check?q=${encodeURIComponent(q.trim())}`);
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

  const NearestIcon = result?.nearest ? TYPE_ICON[result.nearest.type] : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm text-muted-foreground">
          Check any property address for nearby storm activity, a possible date of loss, and a lead score.
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
          <Button onClick={check} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check
          </Button>
        </div>
        {err ? <p className="mt-2 text-sm text-destructive">{err}</p> : null}
      </div>

      {result && result.matched ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">{result.center?.label}</div>
              <div className="mt-1 text-sm">
                Possible date of loss: <span className="font-medium">{fmtDate(result.dateOfLoss)}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Score</div>
              <div className="font-display text-3xl font-semibold tabular-nums text-gold">{result.score}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {result.rings.map((r) => (
              <div key={r.miles} className="rounded-lg border border-border bg-background p-3 text-center">
                <div className="text-xs text-muted-foreground">within {r.miles} mi</div>
                <div className="font-display text-2xl font-semibold tabular-nums">{r.count}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Max hail" value={result.maxHailIn != null ? `${result.maxHailIn.toFixed(2)}″` : "—"} />
            <Stat label="Max wind" value={result.maxWindMph != null ? `${result.maxWindMph} mph` : "—"} />
          </div>

          {result.nearest ? (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium capitalize">
                {NearestIcon ? <NearestIcon className="size-4 text-gold" /> : null}
                Nearest storm — {result.nearest.type}
              </div>
              <div className="text-sm text-muted-foreground">
                {fmtDate(result.nearest.eventAt)} · {result.nearest.distanceMiles} mi away
                {result.nearest.hailSizeIn != null ? ` · ${result.nearest.hailSizeIn.toFixed(2)}″ hail` : ""}
                {result.nearest.windSpeedMph != null ? ` · ${result.nearest.windSpeedMph} mph` : ""}
                {result.nearest.tornadoScale ? ` · ${result.nearest.tornadoScale}` : ""}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No storm reports within 10 miles.</p>
          )}
        </div>
      ) : result && !result.matched ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn&apos;t locate that address. Try adding city, state, or ZIP.
        </div>
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
