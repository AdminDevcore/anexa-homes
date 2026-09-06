"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormat } from "@/components/portal/branding-provider";
import { VERTICAL_LABEL, VERTICAL_ACCENT, DEFAULT_VERTICAL, type ActiveVertical } from "@/lib/vertical";
import { setCommissionOverrideAction, deleteCommissionOverrideAction } from "@/server/modules/team/actions";

export type OverrideRow = {
  id: string;
  sourceId: string;
  sourceName: string;
  vertical: ActiveVertical;
  type: OverrideType;
  percent: number;
  flatAmount: number;
  /** Tenths of a cent per watt. Read only when type = ppw. */
  perWattMills: number;
};

/**
 * The three bases an override can be written on.
 *
 * `ppw` is Solar-only and the picker enforces it: a $/W rate needs a system
 * size to multiply and a roofing job has none, so the row would look configured
 * and pay nothing.
 */
export type OverrideType = "percentage" | "flat" | "ppw";
/** Whose deals this person can earn off, and on which sides they actually work. */
export type OverrideCandidate = { id: string; name: string; verticals: ActiveVertical[] };

/** Module scope on purpose — react-hooks/static-components is an error here. */
function VerticalDot({ v }: { v: ActiveVertical }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ background: VERTICAL_ACCENT[v] }}
    />
  );
}

function OverrideLi({
  o,
  money,
  canEdit,
  onRemove,
}: {
  o: OverrideRow;
  money: (cents: number) => string;
  canEdit: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="flex items-center justify-between py-2 text-sm">
      <span>
        <span className="font-medium">
          {o.type === "percentage"
            ? `${o.percent}%`
            : o.type === "ppw"
              ? `$${(o.perWattMills / 1000).toFixed(2)}/W`
              : money(o.flatAmount)}
        </span>
        <span className="text-muted-foreground"> off {o.sourceName}&rsquo;s deals</span>
      </span>
      {canEdit && (
        <button onClick={() => onRemove(o.id)} aria-label="Remove override" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

/**
 * Workspaces worth showing a heading for: every one the company runs, plus any
 * a legacy row already sits in (so a rate can never be hidden by a later change
 * to who works where — an invisible override is one that gets paid unnoticed).
 */
function verticalsPresent(rows: OverrideRow[], available: ActiveVertical[]): ActiveVertical[] {
  const seen = new Set<ActiveVertical>([...available, ...rows.map((r) => r.vertical)]);
  return [...seen];
}

/**
 * Lists & edits the overrides THIS member earns off other people's deals.
 *
 * Overrides are per vertical: a manager can earn 3% off a rep's roofing deals
 * and a flat $400 off that same rep's solar deals, because Roofing and Solar are
 * separate businesses with separate margins. Each is its own row, so the sheet
 * is grouped by workspace and the picker forces a side to be chosen.
 *
 * When the company only runs one vertical there is nothing to choose, so the
 * grouping and the picker collapse away and this reads exactly as it did before.
 */
export function CommissionOverrides({
  beneficiaryId,
  beneficiaryName,
  overrides,
  candidates,
  verticals,
  canEdit,
}: {
  beneficiaryId: string;
  beneficiaryName: string;
  overrides: OverrideRow[];
  candidates: OverrideCandidate[];
  verticals: ActiveVertical[];
  canEdit: boolean;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [sourceId, setSourceId] = React.useState("");
  const [vertical, setVertical] = React.useState<ActiveVertical>(verticals[0] ?? DEFAULT_VERTICAL);
  const [type, setType] = React.useState<OverrideType>("percentage");
  const [amount, setAmount] = React.useState("");

  // Show the workspace dimension only when there is more than one workspace in
  // play — either to choose from, or already present on a legacy row.
  const multiVertical = verticals.length > 1 || new Set(overrides.map((o) => o.vertical)).size > 1;

  // One override per (person, vertical): a name stays pickable until every side
  // it works has a rate. Someone with no live workspace can't be overridden.
  const available = candidates.filter(
    (c) =>
      c.id !== beneficiaryId &&
      c.verticals.some((v) => !overrides.some((o) => o.sourceId === c.id && o.vertical === v))
  );
  // The sides the currently-picked person actually works, minus the ones that
  // already have a rate — so you can never write a row that can't pay.
  const selected = candidates.find((c) => c.id === sourceId);
  // $/W is Solar's basis. Switching the workspace to Roofing with it selected
  // would submit a row the server rejects, so the picker drops back to a
  // percentage rather than letting an impossible combination be saved.
  const isSolar = vertical === "solar";
  if (!isSolar && type === "ppw") setType("percentage");
  const openVerticals = (selected?.verticals ?? verticals).filter(
    (v) => !overrides.some((o) => o.sourceId === sourceId && o.vertical === v)
  );

  function pickSource(id: string) {
    setSourceId(id);
    // Snap the workspace to one this person can actually be overridden on,
    // rather than leaving a stale selection that the server would reject.
    const open = (candidates.find((c) => c.id === id)?.verticals ?? verticals).filter(
      (v) => !overrides.some((o) => o.sourceId === id && o.vertical === v)
    );
    if (open.length && !open.includes(vertical)) setVertical(open[0]);
  }

  async function add() {
    if (!sourceId) return toast.error("Pick whose deals this is off of.");
    if (!openVerticals.includes(vertical)) return toast.error("Pick a workspace for this override.");
    const n = Number(amount);
    if (!(n > 0)) return toast.error("Enter an amount above 0.");
    setBusy(true);
    const res = await setCommissionOverrideAction({
      beneficiaryId,
      sourceId,
      vertical,
      type,
      percent: type === "percentage" ? n : 0,
      flatAmount: type === "flat" ? Math.round(n * 100) : 0,
      // Mills, so $0.075/W survives the round trip. Cents would floor it to $0.07.
      perWattMills: type === "ppw" ? Math.round(n * 1000) : 0,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Override saved");
    setAdding(false);
    setSourceId("");
    setVertical(verticals[0] ?? DEFAULT_VERTICAL);
    setAmount("");
    setType("percentage");
    router.refresh();
  }

  async function remove(id: string) {
    const res = await deleteCommissionOverrideAction(id);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <Layers className="size-4 text-gold" /> Overrides earned
        </h3>
        {canEdit && available.length > 0 && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {beneficiaryName} earns these off other people&rsquo;s deals (a percentage, a flat amount per deal,
        or a $/W rate on Solar)
        {multiVertical ? ", set separately for each workspace" : ""}.
      </p>

      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">No overrides configured.</p>
      ) : multiVertical ? (
        // Grouped by workspace: a rep on both sides earns off each at its own
        // rate, and reading them interleaved would invite paying the wrong one.
        <div className="space-y-3">
          {verticalsPresent(overrides, verticals).map((v) => {
            const rows = overrides.filter((o) => o.vertical === v);
            return (
              <div key={v} className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <VerticalDot v={v} />
                  {VERTICAL_LABEL[v]}
                </div>
                {rows.length === 0 ? (
                  <p className="pl-3.5 text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((o) => (
                      <OverrideLi key={o.id} o={o} money={fmt.money} canEdit={canEdit} onRemove={remove} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {overrides.map((o) => (
            <OverrideLi key={o.id} o={o} money={fmt.money} canEdit={canEdit} onRemove={remove} />
          ))}
        </ul>
      )}

      {canEdit && adding && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Off whose deals</Label>
            <Select value={sourceId} onValueChange={pickSource}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select person" /></SelectTrigger>
              <SelectContent>
                {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {multiVertical && (
            <div className="space-y-1.5">
              <Label className="text-xs">On which workspace</Label>
              <Select value={vertical} onValueChange={(v) => setVertical(v as ActiveVertical)} disabled={!sourceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={sourceId ? "Select workspace" : "Pick a person first"} />
                </SelectTrigger>
                <SelectContent>
                  {openVerticals.map((v) => (
                    <SelectItem key={v} value={v}>
                      <span className="flex items-center gap-2"><VerticalDot v={v} />{VERTICAL_LABEL[v]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pays only on that side&rsquo;s deals. To earn off both, add one override per workspace —
                the rate can differ.
              </p>
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as OverrideType)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* The percentage means different things on the two sides and
                      says so — solar pays a share of what the REP earned, which
                      is why raising a rep's redline raises his manager too. */}
                  <SelectItem value="percentage">
                    {isSolar ? "% of rep's commission" : "% of contract"}
                  </SelectItem>
                  <SelectItem value="flat">Flat $ / deal</SelectItem>
                  {isSolar && <SelectItem value="ppw">$ / watt</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">
                {type === "percentage" ? "Percent" : type === "ppw" ? "Rate ($/W)" : "Amount (USD)"}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                step={type === "ppw" ? "0.01" : undefined}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={type === "percentage" ? "e.g. 3" : type === "ppw" ? "e.g. 0.10" : "e.g. 500"}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={add} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
              {busy && <Loader2 className="size-4 animate-spin" />} Save override
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
