"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  ImageOff,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Caution,
  Hint,
  ItemRail,
  Panel,
  PanelEmpty,
  Pill,
  RailGroup,
  RailLayout,
  RailRow,
  SaveBar,
  TextField,
} from "@/components/portal/settings-kit";
import {
  addPhotoTemplateItemAction,
  updatePhotoTemplateItemAction,
  deletePhotoTemplateItemAction,
  deletePhotoTemplateAction,
  renamePhotoTemplateAction,
  seedPhotoTemplateAction,
  uploadPhotoExampleAction,
  removePhotoExampleAction,
} from "@/server/modules/photos/actions";

type Kind = "site" | "install";
type Item = {
  id: string;
  label: string;
  required: boolean;
  /** The reference shot for this slot, once an admin has uploaded one. */
  exampleUrl: string | null;
};
type Template = { id: string; name: string; kind: string; items: Item[] };

/**
 * The photo checklists a crew works through, one at a time.
 *
 * Both checklists are always in the rail, whether or not a row exists yet: they
 * are vertical-isolated, so a workspace that has never had one has nothing to
 * map over — which is why this page used to render as a bare heading with no
 * way out of it. A missing checklist is a rail row with a starting point, not
 * an absence.
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

  const [selected, setSelected] = React.useState<string>(() => kinds[0]?.kind ?? "site");
  const openKind = kinds.find((k) => k.kind === selected);
  const openExtra = extras.find((t) => t.id === selected);

  return (
    <RailLayout
      rail={
        <ItemRail label="Photo checklists">
          {kinds.map((k) => {
            const t = primary.get(k.kind) ?? null;
            const required = t?.items.filter((i) => i.required).length ?? 0;
            return (
              <RailRow
                key={k.kind}
                title={t?.name ?? k.name}
                subtitle={
                  t == null || t.items.length === 0
                    ? "no photos yet"
                    : `${t.items.length} photos · ${required} required`
                }
                mark={
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
                    <Camera className="size-3.5" />
                  </span>
                }
                selected={selected === k.kind}
                onSelect={() => setSelected(k.kind)}
                needsWork={t == null || t.items.length === 0}
              />
            );
          })}

          {extras.length > 0 && (
            <>
              <RailGroup>Unused duplicates ({extras.length})</RailGroup>
              {extras.map((t) => (
                <RailRow
                  key={t.id}
                  title={t.name}
                  subtitle={`${t.items.length} photos · never reached from a deal`}
                  mark={
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Camera className="size-3.5" />
                    </span>
                  }
                  selected={selected === t.id}
                  onSelect={() => setSelected(t.id)}
                  muted
                />
              ))}
            </>
          )}
        </ItemRail>
      }
    >
      {openKind && (
        <ChecklistPanel
          // Keyed so switching checklists remounts the panel with its own draft.
          key={openKind.kind}
          kind={openKind.kind}
          fallbackName={openKind.name}
          blurb={openKind.blurb}
          template={primary.get(openKind.kind) ?? null}
        />
      )}

      {openExtra && <DuplicatePanel template={openExtra} onDeleted={() => setSelected("site")} />}
    </RailLayout>
  );
}

/** A row in the draft. `id` is null until it has been saved. */
type Slot = { id: string | null; key: string; label: string; required: boolean; exampleUrl: string | null };

const slotsOf = (t: Template | null): Slot[] =>
  (t?.items ?? []).map((i) => ({
    id: i.id,
    key: i.id,
    label: i.label,
    required: i.required,
    exampleUrl: i.exampleUrl,
  }));

/**
 * One checklist: its name, and every shot a crew is asked for.
 *
 * ONE SAVE for the lot. Every row used to write on blur — a label saved itself
 * when focus left the box, a tick saved itself the moment it was clicked — so a
 * half-edited checklist was indistinguishable from a finished one, and there
 * was no way to change your mind. The example photos are the exception: a file
 * upload is not a field, so it commits when it is chosen.
 */
function ChecklistPanel({
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
  const [busy, setBusy] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);

  const seed = React.useCallback(
    () => ({ name: template?.name ?? fallbackName, slots: slotsOf(template) }),
    [template, fallbackName]
  );
  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([template?.id ?? kind, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const required = draft.slots.filter((s) => s.required).length;
  const withExample = draft.slots.filter((s) => s.exampleUrl).length;
  const blank = draft.slots.some((s) => s.label.trim() === "");

  function patch(key: string, next: Partial<Slot>) {
    setDraft((d) => ({
      ...d,
      slots: d.slots.map((s) => (s.key === key ? { ...s, ...next } : s)),
    }));
  }

  // A key that survives adding, removing and adding again — the list index
  // would not, and React would carry one new row's text into another's box.
  const nextKey = React.useRef(0);
  function addSlot() {
    const key = `new-${nextKey.current++}`;
    setDraft((d) => ({
      ...d,
      slots: [...d.slots, { id: null, key, label: "", required: false, exampleUrl: null }],
    }));
  }

  /**
   * Save the DIFF, not the list.
   *
   * There is no "replace the checklist" action, and inventing one would throw
   * away the photos already taken against every slot — the item id is what a
   * job's photos hang off. So a rename, the new rows, the edited rows and the
   * removed rows each go through the action that was written for them, and a
   * row nobody touched is not posted at all.
   */
  async function save() {
    setBusy(true);
    try {
      const before = seed();

      if (template && draft.name.trim() && draft.name.trim() !== template.name) {
        const res = await renamePhotoTemplateAction({ id: template.id, name: draft.name.trim() });
        if (!res.ok) return toast.error(res.error);
      }

      for (const gone of before.slots.filter((s) => !draft.slots.some((d) => d.key === s.key))) {
        if (!gone.id) continue;
        const res = await deletePhotoTemplateItemAction(gone.id);
        if (!res.ok) return toast.error(res.error);
      }

      for (const slot of draft.slots) {
        const label = slot.label.trim();
        if (label === "") continue;
        if (slot.id == null) {
          // No row yet? Send the kind instead of an id and the action creates
          // the checklist for this workspace on the way in.
          const res = await addPhotoTemplateItemAction(
            template
              ? { templateId: template.id, label, required: slot.required }
              : { kind, label, required: slot.required }
          );
          if (!res.ok) return toast.error(res.error);
          continue;
        }
        const was = before.slots.find((s) => s.key === slot.key);
        if (was && was.label === slot.label && was.required === slot.required) continue;
        const res = await updatePhotoTemplateItemAction({
          id: slot.id,
          label,
          required: slot.required,
        });
        if (!res.ok) return toast.error(res.error);
      }

      toast.success(`${draft.name.trim() || fallbackName} saved`);
      router.refresh();
    } catch {
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  async function useStandard() {
    setSeeding(true);
    try {
      const res = await seedPhotoTemplateAction({ kind });
      if (!res.ok) return toast.error(res.error);
      toast.success("Standard photos added");
      router.refresh();
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="checklist-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
          <Camera className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold tracking-tight">
            {draft.name || fallbackName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill tone={draft.slots.length === 0 ? "warn" : "plain"}>
              {draft.slots.length} {draft.slots.length === 1 ? "photo" : "photos"}
            </Pill>
            <Pill>{required} required</Pill>
            <Pill>{withExample} with an example</Pill>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={useStandard} disabled={seeding}>
            {seeding ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {draft.slots.length === 0 ? "Use the standard list" : "Add standard photos"}
          </Button>
          {template && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={`More for ${draft.name}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DeleteTemplateItem id={template.id} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <div className="mt-4 space-y-4">
        <Panel title="Name">
          <TextField
            label="What the crew sees this checklist called"
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            id={`checklist-${kind}-name`}
          />
        </Panel>

        <Panel
          title="The shots"
          description="In the order the crew works through them. A required shot blocks the checklist from being marked complete until it is taken."
          action={
            <Button size="sm" variant="outline" onClick={addSlot}>
              <Plus className="size-4" /> Add photo
            </Button>
          }
        >
          {draft.slots.length === 0 ? (
            <PanelEmpty>
              No photos on this checklist yet. Add them one at a time, or start from the standard
              list and edit it.
            </PanelEmpty>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border">
              {draft.slots.map((slot, i) => (
                <SlotRow
                  key={slot.key}
                  slot={slot}
                  index={i}
                  onChange={(next) => patch(slot.key, next)}
                  onRemove={() =>
                    setDraft((d) => ({ ...d, slots: d.slots.filter((s) => s.key !== slot.key) }))
                  }
                />
              ))}
            </ul>
          )}
          {blank && (
            <Caution>
              A photo with no label is skipped when this saves — give it a name or remove the row.
            </Caution>
          )}
          <Hint>
            An example photo is set on a saved row, and commits as soon as it is chosen — it is a
            file, not a field, and it is never counted as one of the job&rsquo;s own photos.
          </Hint>
        </Panel>
      </div>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what={draft.name || fallbackName}
        onSave={save}
        onDiscard={() => setDraft(seed())}
      />
    </div>
  );
}

/** One shot on the checklist. */
function SlotRow({
  slot,
  index,
  onChange,
  onRemove,
}: {
  slot: Slot;
  index: number;
  onChange: (next: Partial<Slot>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <ExampleThumb slot={slot} />
      <Input
        value={slot.label}
        placeholder="e.g. Main service panel"
        onChange={(e) => onChange({ label: e.target.value })}
        aria-label={`Photo ${index + 1} label`}
        className="h-9 max-w-md"
      />
      <label className="ml-auto flex shrink-0 items-center gap-2 text-sm">
        <Checkbox
          checked={slot.required}
          onCheckedChange={(v) => onChange({ required: !!v })}
          aria-label={`${slot.label || `Photo ${index + 1}`} required`}
        />
        Required
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${slot.label || `photo ${index + 1}`}`}
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

/**
 * Deleting a checklist orphans every photo taken against it, so the menu item
 * says that rather than opening a browser confirm that says nothing.
 */
function DeleteTemplateItem({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  return (
    <DropdownMenuItem
      variant="destructive"
      disabled={busy}
      onSelect={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const res = await deletePhotoTemplateAction(id);
          if (!res.ok) return toast.error(res.error);
          toast.success("Checklist deleted");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 className="size-4" /> Delete the whole checklist — every photo taken against it is
      orphaned
    </DropdownMenuItem>
  );
}

/** A duplicate nothing reaches, kept on screen only so it can be removed. */
function DuplicatePanel({ template, onDeleted }: { template: Template; onDeleted: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="min-w-0">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Camera className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold tracking-tight">
            {template.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A duplicate. A deal only ever uses the FIRST checklist of each type, so nothing on this
            one is ever shown to a crew — it is here so it can be deleted.
          </p>
        </div>
      </header>
      <div className="mt-4">
        <Panel title={`${template.items.length} photos on it`}>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {template.items.map((i) => (
              <li key={i.id}>
                {i.label}
                {i.required && " · required"}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await deletePhotoTemplateAction(template.id);
                if (!res.ok) return toast.error(res.error);
                toast.success("Checklist deleted");
                onDeleted();
                router.refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete this duplicate
          </Button>
        </Panel>
      </div>
    </div>
  );
}

/**
 * The example photo for one slot: set it, look at it, replace it, drop it.
 *
 * An empty slot opens the file picker on the first click — the whole point of
 * the control is to get a photo in, and making that two clicks is how a
 * checklist ends up with no examples on it. A slot that already has one opens
 * the photo instead, because by then "what did I put here?" is the question
 * being asked, and Replace / Remove live inside that view.
 */
function ExampleThumb({ slot }: { slot: Slot }) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "upload" | "remove">(null);

  // A row that has not been saved has no id to hang a file off yet.
  const unsaved = slot.id == null;

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || slot.id == null) return;
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadPhotoExampleAction(slot.id, fd);
      if (!res.ok) return toast.error(res.error);
      toast.success("Example photo set");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (slot.id == null) return;
    setBusy("remove");
    try {
      const res = await removePhotoExampleAction(slot.id);
      if (!res.ok) return toast.error(res.error);
      toast.success("Example photo removed");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <button
        type="button"
        onClick={() => (slot.exampleUrl ? setOpen(true) : fileRef.current?.click())}
        disabled={busy !== null || unsaved}
        title={
          unsaved
            ? "Save the checklist first — an example photo needs a saved row to hang off"
            : slot.exampleUrl
              ? `Example photo for “${slot.label}”`
              : "Add an example photo"
        }
        aria-label={
          slot.exampleUrl
            ? `Example photo for ${slot.label}`
            : `Add an example photo for ${slot.label || "this photo"}`
        }
        className={cn(
          "group relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50",
          // Dashed while it is an empty slot asking to be filled; solid once it
          // holds a photo, so a set example does not keep reading as a to-do.
          !slot.exampleUrl && "border-dashed"
        )}
      >
        {busy === "upload" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : slot.exampleUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.exampleUrl}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <span className="absolute inset-0 grid place-items-center bg-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">
              <ImagePlus className="size-4 text-background" />
            </span>
          </>
        ) : (
          <ImagePlus className="size-4" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{slot.label}</DialogTitle>
            <DialogDescription>
              What the crew sees beside this slot on every job. It is never counted as one of the
              job&rsquo;s own photos.
            </DialogDescription>
          </DialogHeader>
          {slot.exampleUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={slot.exampleUrl}
              alt={`Example: ${slot.label}`}
              className="max-h-[60vh] w-full rounded-lg border border-border object-contain"
            />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
            >
              {busy === "upload" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Replace
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={remove}>
              {busy === "remove" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageOff className="size-4" />
              )}
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
