"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCustomFieldAction, deleteCustomFieldAction } from "@/server/modules/settings/actions";

type Field = { id: string; entity: string; label: string; type: string; required: boolean };
type Entity = "lead" | "project";

export function CustomFieldsManager({ fields }: { fields: Field[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <EntityColumn entity="lead" title="Lead Fields" fields={fields.filter((f) => f.entity === "lead")} />
      <EntityColumn entity="project" title="Project Fields" fields={fields.filter((f) => f.entity === "project")} />
    </div>
  );
}

function EntityColumn({ entity, title, fields }: { entity: Entity; title: string; fields: Field[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function remove(id: string) {
    setBusy(true);
    const res = await deleteCustomFieldAction(id);
    setBusy(false);
    if (res.ok) {
      toast.success("Field removed");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h3 className="font-semibold">{title}</h3>
        <FieldDialog entity={entity} />
      </div>
      <ul className="divide-y divide-border">
        {fields.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No custom fields.</li>}
        {fields.map((f) => (
          <li key={f.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <span className="font-medium">{f.label}</span>
              <span className="ml-2 text-xs text-muted-foreground capitalize">{f.type}{f.required ? " · required" : ""}</span>
            </div>
            <Button variant="ghost" size="icon" disabled={busy} onClick={() => remove(f.id)}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FieldDialog({ entity }: { entity: Entity }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState("text");
  const [required, setRequired] = React.useState(false);
  const [options, setOptions] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function save() {
    if (!label.trim()) {
      toast.error("Label required.");
      return;
    }
    setPending(true);
    const res = await createCustomFieldAction({
      entity,
      label,
      type: type as "text" | "number" | "date" | "select" | "checkbox" | "textarea",
      options: type === "select" ? options.split(",").map((o) => o.trim()).filter(Boolean) : [],
      required,
    });
    setPending(false);
    if (res.ok) {
      toast.success("Field added");
      setOpen(false);
      setLabel("");
      setOptions("");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="size-4" /> Add</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {entity} field</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Gate Code" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="textarea">Long text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="select">Dropdown</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === "select" && (
            <div className="space-y-1.5">
              <Label>Options (comma-separated)</Label>
              <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Option A, Option B" />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={required} onCheckedChange={setRequired} /> Required
          </label>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Add field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
