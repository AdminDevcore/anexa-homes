"use client";

import * as React from "react";
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
  upsertSolarLenderAction,
  setSolarLenderActiveAction,
  deleteSolarLenderAction,
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
      <LenderSection lenders={lenders} canEdit={canEdit} />
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
      <span className="tabular-nums font-medium">{money(item.priceCents)}</span>
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

/**
 * The lenders whose approved-vendor lists constrain the catalogue.
 *
 * Managed here rather than typed on a deal, because the whole mechanism depends
 * on one lender being one row: "Credit Human" and "credit human" as two rows
 * would split one AVL in half and hide approved equipment from a rep who picked
 * the wrong one.
 */
function LenderSection({ lenders, canEdit }: { lenders: Lender[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await upsertSolarLenderAction(null, { name: name.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setName("");
    toast.success("Lender added");
    router.refresh();
  }

  const live = lenders.filter((l) => l.isActive);
  const retired = lenders.filter((l) => !l.isActive);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold">Lenders</h3>
      <p className="text-xs text-muted-foreground">
        Each lender keeps its own approved-vendor list. Tag equipment with the lenders that approve it,
        and a rep who picks that lender on a deal sees only what it will actually finance.
      </p>

      {lenders.length === 0 && <p className="py-1 text-sm text-muted-foreground">Nothing yet.</p>}

      <div className="flex flex-wrap gap-2">
        {live.map((l) => (
          <LenderChip key={l.id} lender={l} canEdit={canEdit} />
        ))}
      </div>

      {retired.length > 0 && (
        <details className="rounded-lg border border-dashed border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            {retired.length} retired
          </summary>
          <div className="flex flex-wrap gap-2 px-3 pb-3">
            {retired.map((l) => (
              <LenderChip key={l.id} lender={l} canEdit={canEdit} />
            ))}
          </div>
        </details>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Add a lender</Label>
            <Input
              className="sm:w-64"
              value={name}
              placeholder="e.g. Credit Human"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
            />
          </div>
          <Button size="sm" onClick={add} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </Button>
        </div>
      )}
    </section>
  );
}

function LenderChip({ lender, canEdit }: { lender: Lender; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(res.message ?? "Updated");
    router.refresh();
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm ${
        lender.isActive ? "border-border" : "border-dashed border-border opacity-60"
      }`}
    >
      <Landmark className="size-3.5 text-muted-foreground" />
      {lender.name}
      {canEdit && (
        <>
          <button
            className="ml-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={busy}
            title={lender.isActive ? "Retire — keeps existing deals intact" : "Make available again"}
            onClick={() => act(() => setSolarLenderActiveAction(lender.id, !lender.isActive))}
          >
            {lender.isActive ? <Archive className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          </button>
          <button
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={busy}
            title="Delete — refused if any design is being built for it"
            onClick={() => act(() => deleteSolarLenderAction(lender.id))}
          >
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
    </span>
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
      costCents: f.cost ? Math.round(Number(f.cost) * 100) : 0,
      priceCents: f.price ? Math.round(Number(f.price) * 100) : 0,
      rank: Number(f.rank) || 0,
      avlYear: f.avlYear.trim() === "" ? null : Number(f.avlYear),
      crossoverKind: (f.crossoverKind || null) as "reroof" | "mpu" | null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Added");
    setF({ manufacturer: "", model: "", ratingW: "", cost: "", price: "", rank: "0", avlYear: "", crossoverKind: "" });
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
        {/* Which approved-vendor list this belongs to. Optional: plenty of
            items are not year-scoped, and a blank is honest about that. */}
        <div className="space-y-1">
          <Label className="text-xs">AVL year</Label>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 2026"
            value={f.avlYear}
            onChange={(e) => set("avlYear", e.target.value)}
          />
        </div>
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
