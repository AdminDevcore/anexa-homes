"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Caution,
  ChoiceCards,
  Hint,
  ItemRail,
  Panel,
  Pill,
  RailGroup,
  RailLayout,
  RailNoMatch,
  RailRow,
  SaveBar,
  SelectField,
  StatRow,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import { EmptyState } from "@/components/portal/ui";
import {
  createCustomFieldAction,
  deleteCustomFieldAction,
  updateCustomFieldAction,
} from "@/server/modules/settings/actions";

type Field = {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
};
type Entity = "lead" | "project";

const ENTITY_LABEL: Record<Entity, string> = {
  lead: "Appointment fields",
  project: "Project fields",
};

const TYPE_LABEL: Record<string, string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  checkbox: "Checkbox",
};

const TYPES = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

/**
 * The extra questions this company asks on every appointment and every job.
 *
 * Two columns of rows with a bin next to each used to be the whole screen:
 * a field could be created and deleted, never edited — so a typo in a label
 * meant deleting the field, which takes every value already captured against it
 * with it. Rail and panel, and the label, options and required flag are now
 * editable in place. The KEY and the TYPE are not, and the panel says why.
 */
export function CustomFieldsManager({ fields }: { fields: Field[] }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(() => fields[0]?.id ?? null);
  const [query, setQuery] = React.useState("");

  const selected = fields.find((f) => f.id === selectedId) ?? fields[0] ?? null;

  const q = query.trim().toLowerCase();
  const shown = fields.filter((f) => q === "" || f.label.toLowerCase().includes(q));

  if (fields.length === 0) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="No custom fields yet"
        description="Add the extra things your team records that the standard form has no box for — a gate code, a roof pitch, an HOA contact. They appear on every appointment or project from then on."
        action={<AddFieldDialog onAdded={setSelectedId} />}
      />
    );
  }

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Custom fields"
          add={<AddFieldDialog onAdded={setSelectedId} full />}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Find a field"
          showSearch={fields.length > 6}
        >
          {(["lead", "project"] as Entity[]).map((entity) => {
            const mine = shown.filter((f) => f.entity === entity);
            if (mine.length === 0) return null;
            return (
              <React.Fragment key={entity}>
                <RailGroup>
                  {ENTITY_LABEL[entity]} ({mine.length})
                </RailGroup>
                {mine.map((f) => (
                  <RailRow
                    key={f.id}
                    title={f.label}
                    subtitle={`${TYPE_LABEL[f.type] ?? f.type}${f.required ? " · required" : ""}`}
                    mark={
                      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
                        <SlidersHorizontal className="size-3.5" />
                      </span>
                    }
                    selected={f.id === selected?.id}
                    onSelect={() => setSelectedId(f.id)}
                    needsWork={f.type === "select" && f.options.length === 0}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {shown.length === 0 && <RailNoMatch query={query} />}
        </ItemRail>
      }
    >
      {selected && (
        <FieldPanel key={selected.id} field={selected} onDeleted={() => setSelectedId(null)} />
      )}
    </RailLayout>
  );
}

/** One field: what it is called, what it accepts, and whether it blocks a save. */
function FieldPanel({ field, onDeleted }: { field: Field; onDeleted: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const seed = React.useCallback(
    () => ({
      label: field.label,
      required: field.required,
      options: field.options.join(", "),
    }),
    [field]
  );

  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([field.id, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const isSelect = field.type === "select";
  const options = draft.options
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const noOptions = isSelect && options.length === 0;

  async function save() {
    setBusy(true);
    try {
      const res = await updateCustomFieldAction(field.id, {
        label: draft.label.trim(),
        required: draft.required,
        options,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success(`${draft.label.trim()} saved`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="custom-field-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
          <SlidersHorizontal className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold tracking-tight">
            {field.label}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill>{ENTITY_LABEL[field.entity as Entity] ?? field.entity}</Pill>
            <Pill>{TYPE_LABEL[field.type] ?? field.type}</Pill>
            {field.required && <Pill tone="gold">Required</Pill>}
            {noOptions && <Pill tone="warn">No options</Pill>}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label={`More for ${field.label}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                setBusy(true);
                try {
                  const res = await deleteCustomFieldAction(field.id);
                  if (!res.ok) return toast.error(res.error);
                  toast.success("Field removed");
                  onDeleted();
                  router.refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 className="size-4" /> Delete — every value already recorded against it goes
              too
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <Panel title="What it asks">
            <TextField
              label="Label"
              value={draft.label}
              onChange={(v) => setDraft((d) => ({ ...d, label: v }))}
              id={`cf-${field.id}-label`}
              why="Renaming is safe — the values already recorded are keyed by an internal name frozen when the field was created, not by what it says on screen. That is also why a rename never orphans a {{custom.*}} token on a document template."
            />
            <ToggleRow
              label="Required"
              description="A required field blocks the form from being saved until it has an answer — including the quick-add form a rep uses on a doorstep."
              checked={draft.required}
              onChange={(v) => setDraft((d) => ({ ...d, required: v }))}
            />
            {draft.required && (
              <Caution>
                Every appointment created from now on has to answer this, including the seeded
                quick-add forms. A required field with no obvious answer is the commonest reason a
                rep says the form &ldquo;will not submit&rdquo;.
              </Caution>
            )}
          </Panel>

          {isSelect && (
            <Panel
              title="The choices"
              description="Comma-separated, in the order a rep sees them."
            >
              <TextField
                label="Options"
                value={draft.options}
                onChange={(v) => setDraft((d) => ({ ...d, options: v }))}
                placeholder="Option A, Option B"
              />
              {noOptions && (
                <Caution>
                  A dropdown with no options renders as an empty menu, so the field can never be
                  answered.
                </Caution>
              )}
            </Panel>
          )}
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Panel title="Fixed at creation" tone="muted">
            <dl>
              <StatRow label="Type" value={TYPE_LABEL[field.type] ?? field.type} />
              <StatRow label="Internal name" value={field.key} />
              <StatRow label="On" value={field.entity === "lead" ? "appointments" : "projects"} />
            </dl>
            <Hint className="mt-2">
              The type and the internal name cannot change. Values already stored as text do not
              become numbers because a dropdown says so, and the internal name is what every
              recorded answer — and every <code>{"{{custom.*}}"}</code> token on a document — hangs
              off. Delete and re-add if the type is wrong, knowing the recorded answers go with it.
            </Hint>
          </Panel>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what={field.label}
        onSave={save}
        onDiscard={() => setDraft(seed())}
        disabled={draft.label.trim() === ""}
        blockedReason={draft.label.trim() === "" ? "A field needs a label." : undefined}
      />
    </div>
  );
}

/** Adding a field: what it asks, what it accepts, and where it appears. */
function AddFieldDialog({ onAdded, full }: { onAdded: (id: string) => void; full?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [entity, setEntity] = React.useState<Entity>("lead");
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState("text");
  const [options, setOptions] = React.useState("");
  const [required, setRequired] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!label.trim()) return toast.error("Give the field a label.");
    setBusy(true);
    try {
      const res = await createCustomFieldAction({
        entity,
        label: label.trim(),
        type: type as "text" | "number" | "date" | "select" | "checkbox" | "textarea",
        options:
          type === "select"
            ? options
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
        required,
      });
      if (!res.ok) return toast.error(res.error);
      onAdded(res.id);
      toast.success(`${label.trim()} added`);
      setLabel("");
      setOptions("");
      setRequired(false);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={full ? "w-full" : undefined}>
          <Plus className="size-4" /> New field
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a custom field</DialogTitle>
          <DialogDescription>
            The type cannot be changed afterwards — values already recorded do not convert — so it
            is worth getting right here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ChoiceCards
            name="new-field-entity"
            legend="Where does it appear?"
            value={entity}
            onChange={(v) => setEntity(v)}
            columns={2}
            options={[
              {
                value: "lead" as Entity,
                label: "Appointments",
                detail: "Asked when a lead is booked and on the deal Summary.",
              },
              {
                value: "project" as Entity,
                label: "Projects",
                detail: "Asked on the job once the deal is sold.",
              },
            ]}
          />
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-field-label">
              Label
            </Label>
            <Input
              id="new-field-label"
              value={label}
              placeholder="e.g. Gate Code"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <SelectField label="Type" value={type} onChange={setType} options={TYPES} />
          {type === "select" && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="new-field-options">
                Options (comma-separated)
              </Label>
              <Input
                id="new-field-options"
                value={options}
                placeholder="Option A, Option B"
                onChange={(e) => setOptions(e.target.value)}
              />
            </div>
          )}
          <ToggleRow
            label="Required"
            description="Blocks the form until it is answered — including the quick-add a rep uses on a doorstep."
            checked={required}
            onChange={setRequired}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={add} disabled={busy || !label.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
