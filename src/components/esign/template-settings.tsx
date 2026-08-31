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
import { Checkbox } from "@/components/ui/checkbox";
import { updateTemplateAction } from "@/server/modules/esign/actions";

/** A folder this document can file into, already narrowed to one vertical. */
export type DestinationOption = { key: string; label: string };

/**
 * The closeout-packet control, or null on a vertical that does not send one.
 *
 * Null rather than `false` on purpose: roofing has no packet at all, and a
 * tick box nothing reads is worse than no tick box.
 */
export type FinalPacketState = {
  checked: boolean;
  /** 0-based place in the packet, or -1 when this document is not in it. */
  position: number;
  total: number;
};

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
  finalPacket,
  destinations,
  fallbackLabel,
}: {
  templateId: string;
  initialName: string;
  initialFolderKey: string | null;
  finalPacket: FinalPacketState | null;
  destinations: DestinationOption[];
  /** Where a document goes when no folder is chosen — Contract, in both verticals. */
  fallbackLabel: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [folderKey, setFolderKey] = React.useState(initialFolderKey ?? NO_FOLDER);
  const [inPacket, setInPacket] = React.useState(finalPacket?.checked ?? false);
  const [pending, setPending] = React.useState(false);

  const dirty =
    name !== initialName ||
    (initialFolderKey ?? NO_FOLDER) !== folderKey ||
    (finalPacket ? inPacket !== finalPacket.checked : false);

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
      // Left off entirely on a vertical with no packet, so the server keeps
      // whatever the column already held.
      ...(finalPacket ? { finalPacket: inPacket } : {}),
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

      {finalPacket && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3">
          <Checkbox
            checked={inPacket}
            onCheckedChange={(v) => setInPacket(v === true)}
            className="mt-0.5"
            aria-label="Part of the final documents packet"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">Part of the final documents packet</span>
            <span className="block text-xs text-muted-foreground">
              {packetHint(inPacket, finalPacket)}
            </span>
          </span>
        </label>
      )}

      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={pending || !dirty} onClick={save}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * What ticking this box means, in the packet's own terms.
 *
 * The position only reads back once it is saved — the count comes from the
 * server, so a box just ticked describes where it will land rather than
 * claiming a place it does not hold yet.
 */
function packetHint(checked: boolean, state: FinalPacketState): string {
  if (!checked) {
    return "Tick this to send it with \u201CSend final docs to customer\u201D on the deal, once the install is finished.";
  }
  if (state.checked && state.position >= 0) {
    const total = state.total;
    return `Goes out with \u201CSend final docs to customer\u201D \u2014 ${ordinal(state.position + 1)} of ${total} in the packet.`;
  }
  return "Save to add it to the packet. Documents print in the order they were created.";
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
