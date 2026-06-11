"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, X, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_APPOINTMENT_DISPOSITIONS, type Disposition } from "@/lib/dispositions";
import { updateAppointmentDispositionsAction } from "@/server/modules/settings/actions";

export function AppointmentDispositionsManager({ items }: { items: Disposition[] }) {
  const router = useRouter();
  const [list, setList] = React.useState<Disposition[]>(items);
  const [busy, setBusy] = React.useState(false);
  const [addLabel, setAddLabel] = React.useState("");
  const [addGroup, setAddGroup] = React.useState("");
  const [editIndex, setEditIndex] = React.useState<number | null>(null);
  const [editLabel, setEditLabel] = React.useState("");
  const [editGroup, setEditGroup] = React.useState("");

  const groupNames = Array.from(new Set(list.map((d) => d.group).filter(Boolean))) as string[];

  // Persist a candidate list, rolling back the optimistic state on failure.
  async function persist(next: Disposition[], successMsg?: string) {
    const prev = list;
    setList(next);
    setBusy(true);
    const res = await updateAppointmentDispositionsAction({ items: next });
    setBusy(false);
    if (!res.ok) {
      setList(prev);
      toast.error(res.error);
      return false;
    }
    if (successMsg) toast.success(successMsg);
    router.refresh();
    return true;
  }

  function labelExists(label: string, exceptIndex = -1) {
    const v = label.trim().toLowerCase();
    return list.some((x, i) => i !== exceptIndex && x.label.toLowerCase() === v);
  }

  async function add() {
    const label = addLabel.trim();
    if (!label) return toast.error("Enter an outcome.");
    if (labelExists(label)) return toast.error("That outcome already exists.");
    const group = addGroup.trim() || null;
    if (await persist([...list, { group, label }], "Outcome added")) {
      setAddLabel("");
      // keep addGroup so adding several to the same group is quick
    }
  }

  async function saveEdit(index: number) {
    const label = editLabel.trim();
    if (!label) return toast.error("Enter an outcome.");
    if (labelExists(label, index)) return toast.error("That outcome already exists.");
    const group = editGroup.trim() || null;
    const next = list.map((x, i) => (i === index ? { group, label } : x));
    if (await persist(next, "Outcome updated")) setEditIndex(null);
  }

  async function remove(index: number) {
    if (list.length <= 1) return toast.error("Keep at least one outcome.");
    if (!confirm(`Delete "${list[index].label}"? Past appointments keep their recorded outcome.`)) return;
    await persist(list.filter((_, i) => i !== index), "Outcome deleted");
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    await persist(next);
  }

  async function resetDefaults() {
    if (!confirm("Reset appointment outcomes to the Anexa defaults?")) return;
    await persist(DEFAULT_APPOINTMENT_DISPOSITIONS.map((d) => ({ ...d })), "Reset to defaults");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {list.length} outcome{list.length === 1 ? "" : "s"} — shown grouped in the “Run appointment” picker.
        </p>
        <Button variant="ghost" size="sm" disabled={busy} onClick={resetDefaults}>
          <RotateCcw className="size-4" /> Reset to defaults
        </Button>
      </div>

      <datalist id="disposition-groups">
        {groupNames.map((g) => <option key={g} value={g} />)}
      </datalist>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {list.map((item, i) => (
          <div key={`${item.label}-${i}`} className="flex items-center justify-between gap-3 px-5 py-3">
            {editIndex === i ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Input
                  list="disposition-groups"
                  value={editGroup}
                  disabled={busy}
                  placeholder="Group (optional)"
                  onChange={(e) => setEditGroup(e.target.value)}
                  className="h-8 w-40"
                />
                <Input
                  autoFocus
                  value={editLabel}
                  disabled={busy}
                  placeholder="Outcome"
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(i);
                    if (e.key === "Escape") setEditIndex(null);
                  }}
                  className="h-8 w-48"
                />
                <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => saveEdit(i)}>
                  <Check className="size-4 text-emerald-600" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => setEditIndex(null)}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                    {i + 1}
                  </span>
                  {item.group && (
                    <span className="shrink-0 rounded-full bg-gold/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-muted">
                      {item.group}
                    </span>
                  )}
                  <span className="truncate font-medium">{item.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy} onClick={() => { setEditIndex(i); setEditLabel(item.label); setEditGroup(item.group ?? ""); }}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy} onClick={() => remove(i)}><Trash2 className="size-4 text-destructive" /></Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          list="disposition-groups"
          value={addGroup}
          disabled={busy}
          placeholder="Group (e.g. Insurance)"
          onChange={(e) => setAddGroup(e.target.value)}
          className="w-44"
        />
        <Input
          value={addLabel}
          disabled={busy}
          placeholder="New outcome, e.g. Hail Damage"
          onChange={(e) => setAddLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="w-56"
        />
        <Button onClick={add} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add outcome
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: type a group like “Insurance”, “Retail”, or “No Sale” to bucket outcomes under headers. Leave it blank for an ungrouped outcome.
      </p>
    </div>
  );
}
