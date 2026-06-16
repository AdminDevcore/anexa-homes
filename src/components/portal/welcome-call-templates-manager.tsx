"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Check, X, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  createWelcomeCallTemplateAction,
  renameWelcomeCallTemplateAction,
  moveWelcomeCallTemplateAction,
  setWelcomeCallTemplateActiveAction,
  deleteWelcomeCallTemplateAction,
} from "@/server/modules/welcome-call/actions";

type Template = { id: string; name: string; active: boolean; position: number; itemCount: number; sessionCount: number };

export function WelcomeCallTemplatesManager({ items }: { items: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [addName, setAddName] = React.useState("");
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");

  async function run(p: Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return null; }
    if (success) toast.success(success);
    router.refresh();
    return res;
  }

  async function add() {
    const name = addName.trim();
    if (!name) return toast.error("Enter a template name.");
    const res = await run(createWelcomeCallTemplateAction(name), "Template created");
    const id = (res as { id?: string } | null)?.id;
    if (res) { setAddName(""); if (id) router.push(`/portal/settings/welcome-call-templates/${id}`); }
  }
  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name) return toast.error("Enter a name.");
    if (await run(renameWelcomeCallTemplateAction(id, name), "Renamed")) setEditId(null);
  }
  async function remove(t: Template) {
    if (!confirm(`Delete "${t.name}"? Already-sent welcome calls keep their saved copy.`)) return;
    await run(deleteWelcomeCallTemplateAction(t.id), "Template deleted");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each template is a reusable welcome-call script. Reps send it to a customer from a lead; the customer reviews
        their details and confirms. Click a template to edit its intro, items, and closing message.
      </p>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No templates yet — create your first below.</div>
        )}
        {items.map((t, i) => (
          <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
            {editId === t.id ? (
              <div className="flex flex-1 items-center gap-2">
                <Input
                  autoFocus
                  value={editName}
                  disabled={busy}
                  placeholder="Template name"
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t.id); if (e.key === "Escape") setEditId(null); }}
                  className="h-8 w-64"
                />
                <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => saveEdit(t.id)}><Check className="size-4 text-emerald-600" /></Button>
                <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => setEditId(null)}><X className="size-4" /></Button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => router.push(`/portal/settings/welcome-call-templates/${t.id}`)}
                  className="flex min-w-0 items-center gap-3 text-left"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">{i + 1}</span>
                  <span className={`truncate font-medium ${t.active ? "" : "text-muted-foreground line-through"}`}>{t.name}</span>
                  {!t.active && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Inactive</span>}
                  <span className="shrink-0 text-xs text-muted-foreground">{t.itemCount} item{t.itemCount === 1 ? "" : "s"} · {t.sessionCount} sent</span>
                </button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" disabled={busy || i === 0} onClick={() => run(moveWelcomeCallTemplateAction(t.id, "up"))}><ArrowUp className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy || i === items.length - 1} onClick={() => run(moveWelcomeCallTemplateAction(t.id, "down"))}><ArrowDown className="size-4" /></Button>
                  <Button variant="ghost" size="icon" title="Edit script" onClick={() => router.push(`/portal/settings/welcome-call-templates/${t.id}`)}><SquarePen className="size-4" /></Button>
                  <Button variant="ghost" size="icon" disabled={busy} title="Rename" onClick={() => { setEditId(t.id); setEditName(t.name); }}><Pencil className="size-4" /></Button>
                  <span className="mx-1 inline-flex items-center" title={t.active ? "Active" : "Inactive — hidden from the send picker"}>
                    <Switch checked={t.active} disabled={busy} onCheckedChange={(v) => run(setWelcomeCallTemplateActiveAction(t.id, v), v ? "Activated" : "Deactivated")} />
                  </span>
                  <Button variant="ghost" size="icon" disabled={busy} title="Delete" onClick={() => remove(t)}><Trash2 className="size-4 text-destructive" /></Button>
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
          placeholder="New template, e.g. Standard Welcome Call"
          onChange={(e) => setAddName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="w-72"
        />
        <Button onClick={add} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} New template
        </Button>
      </div>
    </div>
  );
}
