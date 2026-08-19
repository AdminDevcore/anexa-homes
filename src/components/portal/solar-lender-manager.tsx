"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Archive, RotateCcw, Landmark, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  upsertSolarLenderAction,
  setSolarLenderActiveAction,
  deleteSolarLenderAction,
} from "@/server/modules/solar/actions";

export type LenderRow = {
  id: string;
  name: string;
  isActive: boolean;
  rank: number;
  notes: string | null;
  /** How many catalogue items this lender approves. */
  approvedCount: number;
  /** How many designs are being built for it. */
  dealCount: number;
};

/**
 * The lenders whose approved-vendor lists constrain what can be sold.
 *
 * One lender is one row, deliberately: "Credit Human" and "credit human" as two
 * rows would split one AVL in half and hide approved equipment from whichever
 * one a rep picked.
 */
export function SolarLenderManager({
  lenders,
  sellableEquipment,
  canEdit,
}: {
  lenders: LenderRow[];
  sellableEquipment: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await upsertSolarLenderAction(null, {
      name: name.trim(),
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setName(""); setNotes("");
    toast.success("Lender added");
    router.refresh();
  }

  const live = lenders.filter((l) => l.isActive);
  const retired = lenders.filter((l) => !l.isActive);

  return (
    <div className="space-y-6">
      {canEdit && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Add a lender</h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                placeholder="e.g. Credit Human"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                value={notes}
                placeholder="Anything worth remembering about this partner"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button onClick={add} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">
          Financing partners{live.length > 0 ? ` (${live.length})` : ""}
        </h3>
        {live.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            No lenders yet. Add the banks and finance partners you sell through, then tag your
            equipment with the ones that approve it on{" "}
            <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
              Solar Equipment
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((l) => (
              <LenderCard key={l.id} lender={l} sellableEquipment={sellableEquipment} canEdit={canEdit} />
            ))}
          </div>
        )}
      </section>

      {retired.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Retired ({retired.length})
          </h3>
          <p className="text-xs text-muted-foreground">
            Not offered on new deals. Kept because deals already built for them still point here.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {retired.map((l) => (
              <LenderCard key={l.id} lender={l} sellableEquipment={sellableEquipment} canEdit={canEdit} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LenderCard({
  lender,
  sellableEquipment,
  canEdit,
}: {
  lender: LenderRow;
  sellableEquipment: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState({ name: lender.name, notes: lender.notes ?? "" });

  type ActionResult = { ok: boolean; error?: string; message?: string };
  const act = async (fn: () => Promise<ActionResult>, fallback: string): Promise<ActionResult> => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error, { duration: 9000 });
      return res;
    }
    toast.success(res.message ?? fallback);
    router.refresh();
    return res;
  };

  async function save() {
    if (!draft.name.trim()) return toast.error("A lender needs a name.");
    const res = await act(
      () => upsertSolarLenderAction(lender.id, { name: draft.name.trim(), notes: draft.notes.trim() || null }),
      "Saved"
    );
    if (res.ok) setEditing(false);
  }

  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        lender.isActive ? "border-border" : "border-dashed border-border opacity-70"
      }`}
    >
      {editing ? (
        <div className="space-y-2">
          <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <Input
            value={draft.notes}
            placeholder="Notes (optional)"
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft({ name: lender.name, notes: lender.notes ?? "" }); setEditing(false); }}>
              <X className="size-4" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Landmark className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{lender.name}</span>
            </div>
            {!lender.isActive && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                retired
              </span>
            )}
          </div>

          {lender.notes && <p className="mt-1.5 text-xs text-muted-foreground">{lender.notes}</p>}

          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Approved equipment</dt>
              <dd className="tabular-nums font-medium">
                {lender.approvedCount}
                {sellableEquipment > 0 && (
                  <span className="text-muted-foreground"> / {sellableEquipment}</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Deals designed for it</dt>
              <dd className="tabular-nums font-medium">{lender.dealCount}</dd>
            </div>
          </dl>

          {/* A lender approving nothing produces empty equipment lists on every
              deal that selects it. Better to say so here than to let a rep meet
              it mid-build. */}
          {lender.isActive && lender.approvedCount === 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
              No equipment approved yet — a deal on this lender will show empty lists.{" "}
              <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
                Tag equipment
              </Link>
              .
            </p>
          )}

          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)} title="Rename or edit notes">
                <Pencil className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                title={lender.isActive ? "Retire — deals already built for it keep working" : "Make available again"}
                onClick={() => act(() => setSolarLenderActiveAction(lender.id, !lender.isActive), "Updated")}
              >
                {lender.isActive ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                title="Delete — refused if any deal is being built for it"
                onClick={() => act(() => deleteSolarLenderAction(lender.id), "Deleted")}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
