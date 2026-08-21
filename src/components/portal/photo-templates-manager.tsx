"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, GripVertical, Sparkles, Check, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addPhotoTemplateItemAction,
  updatePhotoTemplateItemAction,
  deletePhotoTemplateItemAction,
  deletePhotoTemplateAction,
  renamePhotoTemplateAction,
  seedPhotoTemplateAction,
} from "@/server/modules/photos/actions";

type Kind = "site" | "install";
type Item = { id: string; label: string; required: boolean };
type Template = { id: string; name: string; kind: string; items: Item[] };

/**
 * Both checklists are always on screen, whether or not a row exists yet.
 *
 * The rows are vertical-isolated, so a workspace that has never had a checklist
 * (Solar, until now) has nothing to map over — which is why this page used to
 * render as a bare heading with no way to get out of it. A missing checklist is
 * now a card with a starting point, not an absence.
 */
export function PhotoTemplatesManager({
  templates,
  kinds,
}: {
  templates: Template[];
  /** kind → the heading and blurb for the workspace we are standing in. */
  kinds: { kind: Kind; name: string; blurb: string }[];
}) {
  // Only the first template of a kind is reachable from a deal's photo folder,
  // so that is the one this page edits. Any extras (hand-created before this
  // page could make them) are listed after, purely so they can be deleted.
  const primary = new Map<string, Template>();
  const extras: Template[] = [];
  for (const t of templates) {
    if (!primary.has(t.kind)) primary.set(t.kind, t);
    else extras.push(t);
  }

  return (
    <div className="space-y-6">
      {kinds.map((k) => (
        <TemplateCard
          key={k.kind}
          kind={k.kind}
          fallbackName={k.name}
          blurb={k.blurb}
          template={primary.get(k.kind) ?? null}
        />
      ))}

      {extras.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Unused duplicates — a deal only ever uses the first checklist of each type
          </p>
          {extras.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3"
            >
              <span className="text-sm">
                {t.name} <span className="text-muted-foreground">· {t.items.length} photos</span>
              </span>
              <DeleteTemplateButton id={t.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  kind,
  fallbackName,
  blurb,
  template,
}: {
  kind: Kind;
  fallbackName: string;
  blurb: string;
  template: Template | null;
}) {
  const router = useRouter();
  const [newLabel, setNewLabel] = React.useState("");
  const [newRequired, setNewRequired] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const items = template?.items ?? [];

  async function add() {
    if (!newLabel.trim()) return;
    setBusy(true);
    // No row yet? Send the kind instead of an id and the action creates the
    // checklist for this workspace on the way in.
    const res = await addPhotoTemplateItemAction(
      template
        ? { templateId: template.id, label: newLabel.trim(), required: newRequired }
        : { kind, label: newLabel.trim(), required: newRequired }
    );
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setNewLabel("");
    setNewRequired(false);
    router.refresh();
  }

  async function seed() {
    setSeeding(true);
    const res = await seedPhotoTemplateAction({ kind });
    setSeeding(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Standard photos added");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          {renaming && template ? (
            <RenameField
              id={template.id}
              name={template.name}
              onDone={() => {
                setRenaming(false);
                router.refresh();
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{template?.name ?? fallbackName}</h2>
              {template && (
                <button
                  onClick={() => setRenaming(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Rename checklist"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{items.length} photos</span>
          {template && <DeleteTemplateButton id={template.id} />}
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} onChanged={() => router.refresh()} />
        ))}
        {items.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
            <p className="text-sm text-muted-foreground">
              No photos on this checklist yet. Add them below, or start from the standard list and edit it.
            </p>
            <Button size="sm" variant="outline" onClick={seed} disabled={seeding} className="gap-1.5">
              {seeding ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Use the standard list
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New photo label (e.g. Main service panel)"
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
        {items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={seed} disabled={seeding} className="ml-auto gap-1.5">
            {seeding ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Add standard photos
          </Button>
        )}
      </div>
    </div>
  );
}

function RenameField({
  id,
  name,
  onDone,
  onCancel,
}: {
  id: string;
  name: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(name);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!value.trim() || value.trim() === name) return onCancel();
    setBusy(true);
    const res = await renamePhotoTemplateAction({ id, name: value.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onDone();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        className="h-8 max-w-xs"
      />
      <button onClick={save} disabled={busy} className="text-muted-foreground hover:text-foreground" aria-label="Save name">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      </button>
      <button onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="Cancel rename">
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * Two-step rather than a browser confirm(): deleting a checklist orphans every
 * photo taken against it, so the consequence is spelled out in the button.
 */
function DeleteTemplateButton({ id }: { id: string }) {
  const router = useRouter();
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    setBusy(true);
    const res = await deletePhotoTemplateAction(id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setArmed(false);
    toast.success("Checklist deleted");
    router.refresh();
  }

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Delete checklist"
      >
        <Trash2 className="size-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Delete the whole checklist?</span>
      <Button size="sm" variant="destructive" className="h-7" onClick={remove} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setArmed(false)}>
        Cancel
      </Button>
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
