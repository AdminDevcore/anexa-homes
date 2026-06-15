"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, X, Pencil, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  createLeadSourceAction,
  renameLeadSourceAction,
  moveLeadSourceAction,
  setLeadSourceActiveAction,
  deleteLeadSourceAction,
} from "@/server/modules/settings/actions";

type Source = { id: string; name: string; active: boolean; position: number; _count: { leads: number } };

export function LeadSourcesManager({ items }: { items: Source[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [addName, setAddName] = React.useState("");
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");

  async function run(p: Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return false; }
    if (success) toast.success(success);
    router.refresh();
    return true;
  }

  async function add() {
    const name = addName.trim();
    if (!name) return toast.error("Enter a source name.");
    if (await run(createLeadSourceAction(name), "Source added")) setAddName("");
  }
  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return toast.error("Enter a source name.");
    if (await run(renameLeadSourceAction(id, name), "Source renamed")) setEditId(null);
  }
  async function remove(s: Source) {
    if (s._count.leads > 0) return toast.error("Used by existing leads — deactivate it instead.");
    if (!confirm(`Delete "${s.name}"?`)) return;
    await run(deleteLeadSourceAction(s.id), "Source deleted");
  }

  const activeCount = items.filter((s) => s.active).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {activeCount} active source{activeCount === 1 ? "" : "s"} — the options reps pick in the “Source” dropdown when
        booking a lead. Deactivating one hides it from the picker but keeps it on past leads and in reports; you can only
        delete a source that no lead has used.
      </p>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No sources yet — add your first below.</div>
        )}
        {items.map((s, i) => (
          <div key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
            {editId === s.id ? (
              <div className="flex flex-1 items-center gap-2">
                <Input
                  autoFocus
                  value={editName}
                  disabled={busy}
                  placeholder="Source name"
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(s.id); if (e.key === "Escape") setEditId(null); }}
                  className="h-8 w-56"
                />
                <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => saveEdit(s.id)}><Check className="size-4 text-emerald-600" /></Button>
                <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => setEditId(null)}><X className="size-4" /></Button>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">{i + 1}</span>
                  <span className={`truncate font-medium ${s.active ? "" : "text-muted-foreground line-through"}`}>{s.name}</span>
                  {!s.active && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Inactive</span>}
                  <span className="shrink-0 text-xs text-muted-foreground">{s._count.leads} lead{s._count.leads === 1 ? "" : "s"}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" disabled={busy || i === 0} onClick={() => run(moveLeadSourceAction(s.id, "up"))}><ArrowUp className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy || i === items.length - 1} onClick={() => run(moveLeadSourceAction(s.id, "down"))}><ArrowDown className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy} onClick={() => { setEditId(s.id); setEditName(s.name); }}><Pencil className="size-4" /></Button>
                  <span className="mx-1 inline-flex items-center" title={s.active ? "Active — shown in picker" : "Inactive — hidden from picker"}>
                    <Switch checked={s.active} disabled={busy} onCheckedChange={(v) => run(setLeadSourceActiveAction(s.id, v), v ? "Source activated" : "Source deactivated")} />
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || s._count.leads > 0}
                    title={s._count.leads > 0 ? "Used by leads — deactivate instead" : "Delete"}
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={addName}
          disabled={busy}
          placeholder="New source, e.g. Facebook Ads"
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="w-64"
        />
        <Button onClick={add} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add source
        </Button>
      </div>
    </div>
  );
}
