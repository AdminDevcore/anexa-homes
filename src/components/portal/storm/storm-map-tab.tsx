"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudHail, Wind, Tornado, Plus, Loader2, Layers } from "lucide-react";
import type { StormType } from "@prisma/client";
import type { StormEventDTO } from "@/server/modules/storm/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createStormZoneAction } from "@/server/modules/storm/actions";
import { TYPE_COLOR, type ZonePreview, type StormWarning } from "./storm-map";
import type { StormMeta } from "./types";

const StormMap = dynamic(() => import("./storm-map").then((m) => m.StormMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-[58vh] min-h-[360px] w-full place-items-center rounded-xl border border-border text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

const TYPES: { key: StormType; label: string; icon: typeof CloudHail }[] = [
  { key: "hail", label: "Hail", icon: CloudHail },
  { key: "wind", label: "Wind", icon: Wind },
  { key: "tornado", label: "Tornado", icon: Tornado },
];

export function StormMapTab({ meta }: { meta: StormMeta }) {
  const qc = useQueryClient();
  const [types, setTypes] = React.useState<Set<StormType>>(new Set(["hail", "wind", "tornado"]));
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [hailMin, setHailMin] = React.useState("");
  const [windMin, setWindMin] = React.useState("");
  const [county, setCounty] = React.useState("");
  const [city, setCity] = React.useState("");
  const [zip, setZip] = React.useState("");

  const [mapCenter, setMapCenter] = React.useState(meta.center);
  const [showSwaths, setShowSwaths] = React.useState(true);
  const [showWarnings, setShowWarnings] = React.useState(false);

  // Create-zone dialog state.
  const [zoneOpen, setZoneOpen] = React.useState(false);
  const [zoneName, setZoneName] = React.useState("");
  const [zoneRadius, setZoneRadius] = React.useState("1");
  const [zoneRep, setZoneRep] = React.useState("none");
  const [genPins, setGenPins] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const params = new URLSearchParams();
  params.set("types", [...types].join(","));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (hailMin) params.set("hailMin", hailMin);
  if (windMin) params.set("windMin", windMin);
  if (county) params.set("county", county);
  if (city) params.set("city", city);
  if (zip) params.set("zip", zip);
  const qstr = params.toString();

  const { data, isFetching } = useQuery<{ events: StormEventDTO[] }>({
    queryKey: ["storm-events", qstr],
    queryFn: async () => {
      const res = await fetch(`/api/storm/events?${qstr}`);
      if (!res.ok) return { events: [] };
      return res.json();
    },
    staleTime: 60_000,
  });
  const events = data?.events ?? [];

  const wparams = new URLSearchParams();
  if (from) wparams.set("from", from);
  if (to) wparams.set("to", to);
  const { data: wdata } = useQuery<{ warnings: StormWarning[] }>({
    queryKey: ["storm-warnings", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/storm/warnings?${wparams.toString()}`);
      if (!res.ok) return { warnings: [] };
      return res.json();
    },
    enabled: showWarnings,
    staleTime: 5 * 60_000,
  });
  const warnings = showWarnings ? wdata?.warnings ?? [] : [];

  function toggleType(t: StormType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  const zonePreview: ZonePreview | null = zoneOpen
    ? { lat: mapCenter.lat, lng: mapCenter.lng, radiusMiles: Number(zoneRadius) || 1 }
    : null;

  async function submitZone() {
    if (!zoneName.trim()) {
      toast.error("Name the zone.");
      return;
    }
    setSaving(true);
    const res = await createStormZoneAction({
      name: zoneName.trim(),
      centerLat: mapCenter.lat,
      centerLng: mapCenter.lng,
      radiusMiles: Number(zoneRadius) || 1,
      assignedRepId: zoneRep === "none" ? null : zoneRep,
      generatePins: genPins,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Zone created — ${res.eventCount} storm reports inside.`);
    setZoneOpen(false);
    setZoneName("");
    setGenPins(false);
    qc.invalidateQueries({ queryKey: ["storm-zones"] });
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex gap-1.5">
          {TYPES.map(({ key, label, icon: Icon }) => {
            const on = types.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleType(key)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  on ? "border-transparent text-white" : "border-border text-muted-foreground hover:text-foreground"
                }`}
                style={on ? { backgroundColor: TYPE_COLOR[key] } : undefined}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36" />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-36" />
        </Field>
        <Field label="Min hail (in)">
          <Input type="number" step="0.25" value={hailMin} onChange={(e) => setHailMin(e.target.value)} className="h-9 w-24" placeholder="1.0" />
        </Field>
        <Field label="Min wind (mph)">
          <Input type="number" value={windMin} onChange={(e) => setWindMin(e.target.value)} className="h-9 w-24" placeholder="60" />
        </Field>
        <Field label="County">
          <Input value={county} onChange={(e) => setCounty(e.target.value)} className="h-9 w-32" />
        </Field>
        <Field label="City">
          <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-9 w-32" />
        </Field>
        <Field label="ZIP">
          <Input value={zip} onChange={(e) => setZip(e.target.value)} className="h-9 w-24" />
        </Field>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSwaths((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
              showSwaths ? "border-transparent bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle hail swaths"
          >
            <Layers className="size-4" /> Swaths
          </button>
          <button
            type="button"
            onClick={() => setShowWarnings((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
              showWarnings ? "border-transparent bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle NWS storm-warning footprints"
          >
            <Layers className="size-4" /> Warnings
          </button>
          <span className="text-sm text-muted-foreground">
            {isFetching ? "Loading…" : `${events.length} reports`}
          </span>
          {meta.canManage ? (
            <Button size="sm" onClick={() => setZoneOpen(true)} className="gap-1.5">
              <Plus className="size-4" /> Create zone
            </Button>
          ) : null}
        </div>
      </div>

      <StormMap
        events={events}
        center={meta.center}
        radiusMiles={meta.radiusMiles}
        zonePreview={zonePreview}
        showSwaths={showSwaths}
        warnings={warnings}
        onMapCenter={(lat, lng) => setMapCenter({ lat, lng })}
      />

      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create canvassing zone</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Centered on the current map view ({mapCenter.lat.toFixed(3)}, {mapCenter.lng.toFixed(3)}). Pan
            the map to reposition. This also creates a canvassing territory for the assigned rep.
          </p>
          <div className="space-y-3">
            <Field label="Zone name">
              <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="e.g. Plano hail — June" />
            </Field>
            <Field label="Radius (miles)">
              <Input type="number" step="0.25" min="0.25" value={zoneRadius} onChange={(e) => setZoneRadius(e.target.value)} className="w-32" />
            </Field>
            <Field label="Assign to rep">
              <Select value={zoneRep} onValueChange={setZoneRep}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {meta.reps.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={genPins} onCheckedChange={(v) => setGenPins(v === true)} />
              Auto-generate house pins (slower)
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setZoneOpen(false)}>Cancel</Button>
            <Button onClick={submitZone} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Create zone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
