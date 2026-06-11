"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addPhotoTemplateItemAction,
  updatePhotoTemplateItemAction,
  deletePhotoTemplateItemAction,
} from "@/server/modules/photos/actions";

type Item = { id: string; label: string; required: boolean };
type Template = { id: string; name: string; kind: string; items: Item[] };

export function PhotoTemplatesManager({ templates }: { templates: Template[] }) {
  return (
    <div className="space-y-6">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const router = useRouter();
  const [newLabel, setNewLabel] = React.useState("");
  const [newRequired, setNewRequired] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!newLabel.trim()) return;
    setBusy(true);
    const res = await addPhotoTemplateItemAction({ templateId: template.id, label: newLabel.trim(), required: newRequired });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setNewLabel("");
    setNewRequired(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="font-semibold">{template.name}</h2>
        <span className="text-xs text-muted-foreground">{template.items.length} photos</span>
      </div>

      <div className="divide-y divide-border/60">
        {template.items.map((it) => (
          <ItemRow key={it.id} item={it} onChanged={() => router.refresh()} />
        ))}
        {template.items.length === 0 && (
          <p className="px-5 py-4 text-sm text-muted-foreground">No photos in this template yet.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New photo label (e.g. Ridge cap close-up)"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={newRequired} onCheckedChange={(v) => setNewRequired(!!v)} />
          Required
        </label>
        <Button size="sm" onClick={add} disabled={busy || !newLabel.trim()} className="gap-1.5">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add photo
        </Button>
      </div>
    </div>
  );
}

function ItemRow({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [label, setLabel] = React.useState(item.label);
  const [required, setRequired] = React.useState(item.required);

  async function saveLabel() {
    if (label.trim() === item.label || !label.trim()) {
      setLabel(item.label);
      return;
    }
    const res = await updatePhotoTemplateItemAction({ id: item.id, label: label.trim() });
    if (!res.ok) {
      toast.error(res.error);
      setLabel(item.label);
      return;
    }
    onChanged();
  }

  async function toggleRequired(v: boolean) {
    setRequired(v);
    const res = await updatePhotoTemplateItemAction({ id: item.id, required: v });
    if (!res.ok) {
      toast.error(res.error);
      setRequired(item.required);
    }
  }

  async function remove() {
    const res = await deletePhotoTemplateItemAction(item.id);
    if (!res.ok) return toast.error(res.error);
    onChanged();
  }

  return (
    <div className="flex items-center gap-3 px-5 py-2.5">
      <GripVertical className="size-4 shrink-0 text-muted-foreground/50" />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={saveLabel}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-9 max-w-md border-transparent bg-transparent px-2 hover:border-border focus:border-border"
      />
      <label className="ml-auto flex items-center gap-2 text-sm">
        <Checkbox checked={required} onCheckedChange={(v) => toggleRequired(!!v)} />
        Required
      </label>
      <button onClick={remove} className="text-muted-foreground hover:text-destructive" aria-label="Delete photo slot">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
