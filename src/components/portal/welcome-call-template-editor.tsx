"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateWelcomeCallTemplateContentAction, setWelcomeCallTemplateModeAction } from "@/server/modules/welcome-call/actions";
import { CALL_MODES, CALL_MODE_LABELS, type CallMode } from "@/server/modules/welcome-call/types";

type Item = { id: string; title: string; body: string };
type CatalogEntry = { token: string; label: string; group: string };
type Field = HTMLTextAreaElement | HTMLInputElement;

// Lightweight client-side id for new items (server normalizes/validates).
function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function WelcomeCallTemplateEditor({
  templateId,
  initial,
  catalog,
  mode,
}: {
  templateId: string;
  initial: { intro: string; closing: string; items: Item[] };
  catalog: CatalogEntry[];
  mode: CallMode;
}) {
  const router = useRouter();
  const [callMode, setCallMode] = React.useState<CallMode>(mode);
  const [modeBusy, setModeBusy] = React.useState(false);

  async function changeMode(next: CallMode) {
    if (next === callMode) return;
    setCallMode(next); // optimistic
    setModeBusy(true);
    const res = await setWelcomeCallTemplateModeAction(templateId, next);
    setModeBusy(false);
    if (!res.ok) { setCallMode(callMode); toast.error(res.error); return; }
    toast.success(`Switched to ${CALL_MODE_LABELS[next]}`);
    router.refresh();
  }

  const [intro, setIntro] = React.useState(initial.intro);
  const [closing, setClosing] = React.useState(initial.closing);
  const [items, setItems] = React.useState<Item[]>(initial.items);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // The currently-focused field + its key, tracked via focus events (never during render).
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const activeEl = React.useRef<Field | null>(null);
  const pendingCaret = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (pendingCaret.current != null && activeEl.current) {
      const pos = pendingCaret.current;
      activeEl.current.focus();
      activeEl.current.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  });

  const updateItem = (id: string, patch: Partial<Item>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const addItem = () => { setItems((xs) => [...xs, { id: newId(), title: "", body: "" }]); setDirty(true); };
  const removeItem = (id: string) => { setItems((xs) => xs.filter((x) => x.id !== id)); setDirty(true); };
  const moveItem = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= items.length) return;
    setItems((xs) => { const n = [...xs]; [n[idx], n[t]] = [n[t], n[idx]]; return n; });
    setDirty(true);
  };

  function valueOf(key: string): string {
    if (key === "intro") return intro;
    if (key === "closing") return closing;
    const [k, id] = key.split(":");
    const it = items.find((x) => x.id === id);
    return it ? (k === "t" ? it.title : it.body) : "";
  }
  function setValueOf(key: string, v: string) {
    if (key === "intro") return setIntro(v);
    if (key === "closing") return setClosing(v);
    const [k, id] = key.split(":");
    updateItem(id, k === "t" ? { title: v } : { body: v });
  }

  function focus(key: string, e: React.FocusEvent<Field>) {
    activeEl.current = e.currentTarget;
    setFocusKey(key);
  }

  function insertToken(token: string) {
    if (!focusKey) {
      navigator.clipboard?.writeText(token).catch(() => {});
      toast.info(`Copied ${token} — click into a field, then a merge field to insert it.`);
      return;
    }
    const el = activeEl.current;
    const cur = valueOf(focusKey);
    const pos = el && el.selectionStart != null ? el.selectionStart : cur.length;
    setValueOf(focusKey, cur.slice(0, pos) + token + cur.slice(pos));
    setDirty(true);
    pendingCaret.current = pos + token.length;
  }

  async function save() {
    setSaving(true);
    const res = await updateWelcomeCallTemplateContentAction(templateId, { intro, closing, items });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Saved");
    setDirty(false);
    router.refresh();
  }

  const groups = Array.from(new Set(catalog.map((c) => c.group)));
  const fieldCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-gold/50 focus:outline-none";

  return (
    <div className="space-y-6">
    {/* Delivery mode */}
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Delivery</span>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {CALL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              disabled={modeBusy}
              onClick={() => changeMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${callMode === m ? "bg-gold text-gold-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {CALL_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {modeBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {callMode === "avatar" && (
        <p className="mt-2 text-xs text-muted-foreground">
          AI avatar call: an avatar reads each item aloud as a question; the customer answers on camera and the
          session is recorded. Needs a HeyGen key in the environment — without it, items are read by the browser
          voice so you can still test the flow.
        </p>
      )}
    </div>

    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      {/* Editor */}
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-sm font-medium">Intro message</label>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Shown at the top of the page. Optional.</p>
          <textarea
            value={intro}
            onFocus={(e) => focus("intro", e)}
            onChange={(e) => { setIntro(e.target.value); setDirty(true); }}
            rows={3}
            placeholder="e.g. Welcome to the {{company.name}} family, {{customer.firstName}}! Let's confirm your project details."
            className={fieldCls}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Confirmation items</h3>
            <Button size="sm" variant="outline" onClick={addItem}><Plus className="size-4" /> Add item</Button>
          </div>
          {items.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No items yet. Each item is something the customer reads and checks off.
            </div>
          )}
          {items.map((it, i) => (
            <div key={it.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">{i + 1}</span>
                <Input value={it.title} onFocus={(e) => focus(`t:${it.id}`, e)} onChange={(e) => updateItem(it.id, { title: e.target.value })} placeholder="Item title, e.g. Your address" className="h-8 flex-1" />
                <Button variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => moveItem(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-8" disabled={i === items.length - 1} onClick={() => moveItem(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => removeItem(it.id)}><Trash2 className="size-4 text-destructive" /></Button>
              </div>
              <textarea
                value={it.body}
                onFocus={(e) => focus(`b:${it.id}`, e)}
                onChange={(e) => updateItem(it.id, { body: e.target.value })}
                rows={2}
                placeholder="e.g. We have your property as {{property.full}}. Is this where the work will be done?"
                className={fieldCls}
              />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-sm font-medium">Closing message</label>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Shown after the customer confirms. Optional.</p>
          <textarea
            value={closing}
            onFocus={(e) => focus("closing", e)}
            onChange={(e) => { setClosing(e.target.value); setDirty(true); }}
            rows={2}
            placeholder="e.g. Thank you, {{customer.firstName}}! Your project manager will be in touch shortly."
            className={fieldCls}
          />
        </div>

        <div className="sticky bottom-4 flex items-center gap-3">
          <Button onClick={save} disabled={!dirty || saving} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
      </div>

      {/* Merge-field picker */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="text-sm font-semibold">Merge fields</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">Click a field to drop it where your cursor is. It fills in live from the deal when sent.</p>
          <div className="mt-3 space-y-3">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
                <div className="flex flex-wrap gap-1.5">
                  {catalog.filter((c) => c.group === g).map((c) => (
                    <button
                      key={c.token}
                      type="button"
                      onClick={() => insertToken(c.token)}
                      title={c.label}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
    </div>
  );
}
