"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateTemplateAction } from "@/server/modules/esign/actions";

/** A folder this document can file into, already narrowed to one vertical. */
export type DestinationOption = { key: string; label: string };

/** The value the Select uses for "no destination chosen" — Radix rejects "". */
const NO_FOLDER = "__none__";

/**
 * What this template is called and where its signed document goes.
 *
 * The name was unreachable before this: templates were created as "Untitled
 * contract" and nothing ever wrote the column, so a company with four documents
 * had four rows with the same name — and packages, which take their title from
 * here, inherited it. Naming and filing belong together, so they share a card.
 */
export function TemplateSettings({
  templateId,
  initialName,
  initialFolderKey,
  destinations,
  fallbackLabel,
}: {
  templateId: string;
  initialName: string;
  initialFolderKey: string | null;
  destinations: DestinationOption[];
  /** Where a document goes when no folder is chosen — Contract, in both verticals. */
  fallbackLabel: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [folderKey, setFolderKey] = React.useState(initialFolderKey ?? NO_FOLDER);
  const [pending, setPending] = React.useState(false);

  const dirty = name !== initialName || (initialFolderKey ?? NO_FOLDER) !== folderKey;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the template a name.");
      return;
    }
    setPending(true);
    const res = await updateTemplateAction({
      id: templateId,
      name: trimmed,
      folderKey: folderKey === NO_FOLDER ? "" : folderKey,
    });
    setPending(false);
    if (res.ok) {
      toast.success("Saved");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">Name</Label>
          <Input
            id="template-name"
            value={name}
            maxLength={120}
            placeholder="Certificate of Acceptance"
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            What this document is called everywhere — the template list, and the title on
            every copy sent for signature.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="template-folder">Files into</Label>
          <Select value={folderKey} onValueChange={setFolderKey}>
            <SelectTrigger id="template-folder" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FOLDER}>{fallbackLabel} (default)</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The folder on the deal this document lands in once it is sent. Documents
            already sent keep the folder they were sent with.
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={pending || !dirty} onClick={save}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}
