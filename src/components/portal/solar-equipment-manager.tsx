"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Home, Zap, Star, Archive, RotateCcw, Landmark, Check } from "lucide-react";
import type { SolarEquipmentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  upsertSolarEquipmentAction,
  deleteSolarEquipmentAction,
  setDefaultSolarEquipmentAction,
  setSolarEquipmentActiveAction,
  setEquipmentLendersAction,
} from "@/server/modules/solar/actions";

type Item = {
  id: string;
  kind: SolarEquipmentKind;
  manufacturer: string | null;
  model: string;
  ratingW: number | null;
  costCents: number;
  priceCents: number;
  /** Adders only: tenths of a cent per installed watt. 50 = $0.05/W. */
  priceMillsPerWatt: number | null;
  rank: number;
  crossoverKind: string | null;
  isActive: boolean;
  isDefault: boolean;
  avlYear: number | null;
  lenderIds: string[];
};

export type Lender = { id: string; name: string; isActive: boolean; rank: number; notes: string | null };

const KINDS: { value: SolarEquipmentKind; label: string; ratingLabel: string }[] = [
  { value: "module", label: "Modules", ratingLabel: "W per panel" },
  { value: "inverter", label: "Inverters", ratingLabel: "Rated W" },
  { value: "battery", label: "Batteries", ratingLabel: "Usable Wh" },
  { value: "adder", label: "Adders", ratingLabel: "—" },
];

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function SolarEquipmentManager({ items, lenders, canEdit }: { items: Item[]; lenders: Lender[]; canEdit: boolean }) {
  return (
    <div className="space-y-6">
      {lenders.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          No lenders set up yet. Add them under{" "}
          <Link href="/portal/settings/solar-lenders" className="underline underline-offset-2">
            Settings &rarr; Lenders
          </Link>{" "}
          to tag which approved-vendor lists each item appears on.
        </p>
      )}
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
          {(() => {
            const mine = items.filter((i) => i.kind === k.value);
            const live = mine.filter((i) => i.isActive);
            const retired = mine.filter((i) => !i.isActive);
            return (
              <>
                <div className="divide-y divide-border">
                  {mine.length === 0 && (
                    <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>
                  )}
                  {mine.length > 0 && live.length === 0 && (
                    <p className="py-2 text-sm text-muted-foreground">
                      Nothing sellable — everything here is retired.
                    </p>
                  )}
                  {live.map((i) => (
                    <Row key={i.id} item={i} lenders={lenders} canEdit={canEdit} />
                  ))}
                </div>

                {/* Retired items stay listed, and stay readable. They are what
                    last year's deals point at, so hiding them would make those
                    deals harder to explain, not tidier. */}
                {retired.length > 0 && (
                  <details className="mt-3 rounded-lg border border-dashed border-border">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                      {retired.length} retired — still shown on the deals that already use{" "}
                      {retired.length === 1 ? "it" : "them"}
                    </summary>
                    <div className="divide-y divide-border px-3 pb-2">
                      {retired.map((i) => (
                        <Row key={i.id} item={i} lenders={lenders} canEdit={canEdit} />
                      ))}
                    </div>
                  </details>
                )}
              </>
            );
          })()}
        </section>
      ))}
    </div>
  );
}

function Row({ item, lenders, canEdit }: { item: Item; lenders: Lender[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [editingLenders, setEditingLenders] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>(item.lenderIds);

  async function remove() {
    setBusy(true);
    const res = await deleteSolarEquipmentAction(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success("Deleted");
    router.refresh();
  }

  async function setActive(next: boolean) {
    setBusy(true);
    const res = await setSolarEquipmentActiveAction(item.id, next);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.message ?? (next ? "Restored" : "Retired"));
    router.refresh();
  }

  const named = lenders.filter((l) => item.lenderIds.includes(l.id));

  async function saveLenders() {
    setBusy(true);
    const res = await setEquipmentLendersAction(item.id, picked);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setEditingLenders(false);
    toast.success(res.count === 0 ? "No lender approvals — this will be hidden whenever a lender is selected" : `Approved for ${res.count} lender${res.count === 1 ? "" : "s"}`);
    router.refresh();
  }

  return (
    <>
    <div className={`flex flex-wrap items-center gap-2 py-2.5 text-sm ${item.isActive ? "" : "opacity-60"}`}>
      <span className="min-w-[14rem] flex-1 font-medium">
        {item.manufacturer ? `${item.manufacturer} ` : ""}
        {item.model}
      </span>
      {item.avlYear != null && (
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">
          AVL {item.avlYear}
        </span>
      )}
      {!item.isActive && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          retired
        </span>
      )}
      {named.map((l) => (
        <span key={l.id} className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
          {l.name}
        </span>
      ))}
      {lenders.length > 0 && named.length === 0 && (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
          title="Not on any lender's approved list, so it is hidden whenever a lender is selected on a deal"
        >
          no lender
        </span>
      )}
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
      {item.isDefault && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
          <Star className="size-3" /> default
        </span>
      )}
      <span className="tabular-nums text-muted-foreground">cost {money(item.costCents)}</span>
      {/* A per-watt adder shows its RATE, never a dollar figure — the amount
          depends on the system it lands on, and printing one here would be
          quoting an array this catalogue row has never seen. */}
      <span className="tabular-nums font-medium">
        {item.priceMillsPerWatt
          ? `$${(item.priceMillsPerWatt / 1000).toFixed(3).replace(/0$/, "")}/W`
          : money(item.priceCents)}
      </span>
      {/* One default per kind — promoting this one demotes the incumbent, so
          the builder always has exactly one obvious starting choice. */}
      {canEdit && item.kind !== "adder" && item.isActive && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title={item.isDefault ? "Stop being the default" : "Make this the default"}
          onClick={async () => {
            setBusy(true);
            const res = await setDefaultSolarEquipmentAction(item.id, !item.isDefault);
            setBusy(false);
            if (!res.ok) return toast.error(res.error);
            toast.success(item.isDefault ? "No longer the default" : "Set as default");
            router.refresh();
          }}
        >
          <Star className={item.isDefault ? "size-4 fill-current" : "size-4"} />
        </Button>
      )}
      {canEdit && lenders.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title="Which lenders approve this"
          onClick={() => { setPicked(item.lenderIds); setEditingLenders((v) => !v); }}
        >
          <Landmark className="size-4" />
        </Button>
      )}
      {/* Retiring is the safe move and sits before delete on purpose: it stops
          new designs picking the item while leaving every existing deal intact. */}
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title={item.isActive ? "Retire — hide from new designs, keep it on existing deals" : "Make sellable again"}
          onClick={() => setActive(!item.isActive)}
        >
          {item.isActive ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}
        </Button>
      )}
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={remove}
          disabled={busy}
          title="Delete permanently — refused if any design uses it"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      )}
    </div>

    {editingLenders && (
      <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-medium">Approved by</p>
        <div className="flex flex-wrap gap-2">
          {lenders.map((l) => {
            const on = picked.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== l.id) : [...p, l.id]))}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  on ? "border-violet-300 bg-violet-100 text-violet-900" : "border-border hover:bg-muted"
                }`}
              >
                {on && <Check className="size-3" />}
                {l.name}
                {!l.isActive && " · retired"}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          A rep who selects one of these on a deal will see this item. Tick every list it appears on —
          most equipment is approved by more than one.
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={saveLenders} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Save approvals
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingLenders(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    )}
    </>
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
    widthMm: "",
    heightMm: "",
    cost: "",
    price: "",
    rank: "0",
    perWatt: "",
    avlYear: "",
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
      widthMm: f.widthMm ? Number(f.widthMm) : null,
      heightMm: f.heightMm ? Number(f.heightMm) : null,
      costCents: f.cost ? Math.round(Number(f.cost) * 100) : 0,
      priceCents: f.price ? Math.round(Number(f.price) * 100) : 0,
      // Dollars per watt on screen, mills per watt on the wire. $0.05 → 50.
      priceMillsPerWatt:
        kind === "adder" && f.perWatt.trim() !== ""
          ? Math.round(Number(f.perWatt) * 1000)
          : null,
      rank: Number(f.rank) || 0,
      avlYear: f.avlYear.trim() === "" ? null : Number(f.avlYear),
      crossoverKind: (f.crossoverKind || null) as "reroof" | "mpu" | null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Added");
    setF({ manufacturer: "", model: "", ratingW: "", widthMm: "", heightMm: "", cost: "", price: "", rank: "0", perWatt: "", avlYear: "", crossoverKind: "" });
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

  /**
   * A field id, scoped to this section's kind.
   *
   * All four kinds render this form on the same page, so a bare `id="model"`
   * would appear four times — and a duplicate id is a label that points at
   * somebody else's box. It also makes every field addressable by its name,
   * which is what a screen reader announces and what a test asks for.
   */
  const fid = (name: string) => `eq-${kind}-${name}`;

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={fid("manufacturer")}>Manufacturer</Label>
          <Input id={fid("manufacturer")} value={f.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={fid("model")}>Model *</Label>
          <Input id={fid("model")} value={f.model} onChange={(e) => set("model", e.target.value)} />
        </div>
        {kind !== "adder" && (
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={fid("rating")}>{ratingLabel}</Label>
            <Input id={fid("rating")} type="number" value={f.ratingW} onChange={(e) => set("ratingW", e.target.value)} />
          </div>
        )}
        {/* The laminate's real size. The roof designer lays panels out at true
            scale against satellite imagery, so this is what decides how many
            fit between a ridge and a setback — leave it blank and every roof is
            planned with a generic 1134 x 1762 module instead of the one on the
            approved-vendor list. Off a spec sheet in millimetres. */}
        {kind === "module" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={fid("width")}>Width (mm)</Label>
              <Input
                id={fid("width")}
                type="number"
                placeholder="1134"
                value={f.widthMm}
                onChange={(e) => set("widthMm", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={fid("length")}>Length (mm)</Label>
              <Input
                id={fid("length")}
                type="number"
                placeholder="1762"
                value={f.heightMm}
                onChange={(e) => set("heightMm", e.target.value)}
              />
            </div>
          </>
        )}
        {/* Which approved-vendor list this belongs to. Optional: plenty of
            items are not year-scoped, and a blank is honest about that. */}
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={fid("avl")}>AVL year</Label>
          <Input
            id={fid("avl")}
            type="number"
            inputMode="numeric"
            placeholder="e.g. 2026"
            value={f.avlYear}
            onChange={(e) => set("avlYear", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={fid("cost")}>Cost $</Label>
          <Input id={fid("cost")} type="number" value={f.cost} onChange={(e) => set("cost", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={fid("price")}>Price $</Label>
          <Input id={fid("price")} type="number" value={f.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        {kind === "adder" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={fid("perwatt")}>Or $ per watt</Label>
              <Input
                id={fid("perwatt")}
                type="number"
                step="0.001"
                placeholder="e.g. 0.05"
                value={f.perWatt}
                onChange={(e) => set("perWatt", e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                For a charge that scales with the array — steep roof, small system. Fill this
                <em> instead of</em> Price, not as well as.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={fid("rank")}>Rank</Label>
              <Input id={fid("rank")} type="number" value={f.rank} onChange={(e) => set("rank", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor={fid("crossover")}>Crossover</Label>
              <select
                id={fid("crossover")}
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
