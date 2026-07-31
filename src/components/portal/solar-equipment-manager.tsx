"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Home, Zap } from "lucide-react";
import type { SolarEquipmentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  upsertSolarEquipmentAction,
  deleteSolarEquipmentAction,
} from "@/server/modules/solar/actions";

type Item = {
  id: string;
  kind: SolarEquipmentKind;
  manufacturer: string | null;
  model: string;
  ratingW: number | null;
  costCents: number;
  priceCents: number;
  rank: number;
  crossoverKind: string | null;
  isActive: boolean;
};

const KINDS: { value: SolarEquipmentKind; label: string; ratingLabel: string }[] = [
  { value: "module", label: "Modules", ratingLabel: "W per panel" },
  { value: "inverter", label: "Inverters", ratingLabel: "Rated W" },
  { value: "battery", label: "Batteries", ratingLabel: "Usable Wh" },
  { value: "adder", label: "Adders", ratingLabel: "—" },
];

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function SolarEquipmentManager({ items, canEdit }: { items: Item[]; canEdit: boolean }) {
  return (
    <div className="space-y-6">
      {KINDS.map((k) => (
        <section key={k.value} className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{k.label}</h3>
            {canEdit && <AddForm kind={k.value} ratingLabel={k.ratingLabel} />}
          </div>
          {k.value === "adder" && (
            <p className="text-xs text-muted-foreground">
              Tagging an adder as <strong>Re-roof</strong> or <strong>MPU</strong> ties it to the
              crossover: picking it on a design raises the flag on the deal and offers the linked
              Roofing job, instead of quietly becoming a line item nobody follows up.
            </p>
          )}
          <div className="divide-y divide-border">
            {items.filter((i) => i.kind === k.value).length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>
            )}
            {items
              .filter((i) => i.kind === k.value)
              .map((i) => (
                <Row key={i.id} item={i} canEdit={canEdit} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    setBusy(true);
    const res = await deleteSolarEquipmentAction(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Removed");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
      <span className="min-w-[14rem] flex-1 font-medium">
        {item.manufacturer ? `${item.manufacturer} ` : ""}
        {item.model}
      </span>
      {item.ratingW ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {item.ratingW}W
        </span>
      ) : null}
      {item.crossoverKind === "reroof" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          <Home className="size-3" /> crossover
        </span>
      )}
      {item.crossoverKind === "mpu" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          <Zap className="size-3" /> crossover
        </span>
      )}
      {item.kind === "adder" && (
        <span className="text-[11px] text-muted-foreground">rank {item.rank}</span>
      )}
      <span className="tabular-nums text-muted-foreground">cost {money(item.costCents)}</span>
      <span className="tabular-nums font-medium">{money(item.priceCents)}</span>
      {canEdit && (
        <Button variant="ghost" size="icon" onClick={remove} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      )}
    </div>
  );
}

function AddForm({ kind, ratingLabel }: { kind: SolarEquipmentKind; ratingLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({
    manufacturer: "",
    model: "",
    ratingW: "",
    cost: "",
    price: "",
    rank: "0",
    crossoverKind: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.model.trim()) return toast.error("Model is required.");
    setBusy(true);
    const res = await upsertSolarEquipmentAction(null, {
      kind,
      manufacturer: f.manufacturer || null,
      model: f.model,
      ratingW: f.ratingW ? Number(f.ratingW) : null,
      costCents: f.cost ? Math.round(Number(f.cost) * 100) : 0,
      priceCents: f.price ? Math.round(Number(f.price) * 100) : 0,
      rank: Number(f.rank) || 0,
      crossoverKind: (f.crossoverKind || null) as "reroof" | "mpu" | null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Added");
    setF({ manufacturer: "", model: "", ratingW: "", cost: "", price: "", rank: "0", crossoverKind: "" });
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Manufacturer</Label>
          <Input value={f.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model *</Label>
          <Input value={f.model} onChange={(e) => set("model", e.target.value)} />
        </div>
        {kind !== "adder" && (
          <div className="space-y-1">
            <Label className="text-xs">{ratingLabel}</Label>
            <Input type="number" value={f.ratingW} onChange={(e) => set("ratingW", e.target.value)} />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Cost $</Label>
          <Input type="number" value={f.cost} onChange={(e) => set("cost", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Price $</Label>
          <Input type="number" value={f.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        {kind === "adder" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Rank</Label>
              <Input type="number" value={f.rank} onChange={(e) => set("rank", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Crossover</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={f.crossoverKind}
                onChange={(e) => set("crossoverKind", e.target.value)}
              >
                <option value="">— none —</option>
                <option value="reroof">Re-roof</option>
                <option value="mpu">MPU / derate</option>
              </select>
            </div>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
