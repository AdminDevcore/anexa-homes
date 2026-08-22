"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Check, Loader2, Trash2, AlertCircle, FileDown, ImageIcon, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";

type Slot = {
  itemId: string;
  label: string;
  required: boolean;
  /**
   * The reference shot an admin set for this slot in Settings → Photo
   * Templates. Null on a slot nobody has set one for, which is every slot until
   * somebody does. It is not one of `photos` and never becomes one: examples
   * are not files on this job, so they stay out of the count, the folder and
   * the PDF report.
   */
  exampleUrl: string | null;
  photos: { id: string; name: string }[];
};
type Checklist = {
  templateId: string;
  name: string;
  kind: "site" | "install";
  items: Slot[];
  filledItems: number;
  totalItems: number;
  requiredTotal: number;
  requiredDone: number;
};

export function ProjectPhotos({ projectId, checklists }: { projectId: string; checklists: Checklist[] }) {
  if (checklists.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No photo templates configured. An admin can set them up under Settings → Photo Templates.
      </p>
    );
  }
  const defaultTab = checklists[0].kind;
  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList>
        {checklists.map((c) => (
          <TabsTrigger key={c.templateId} value={c.kind}>
            {c.name}
            <span className="ml-2 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
              {c.filledItems}/{c.totalItems}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
      {checklists.map((c) => (
        <TabsContent key={c.templateId} value={c.kind} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {c.requiredTotal > 0 ? (
              <p className="text-xs text-muted-foreground">
                Required photos: {c.requiredDone}/{c.requiredTotal} complete
              </p>
            ) : (
              <span />
            )}
            <a
              href={`/portal/projects/${projectId}/photo-report?group=${c.kind}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                c.filledItems === 0 && "pointer-events-none opacity-40"
              )}
            >
              <FileDown className="size-4" /> Compile PDF report
            </a>
          </div>
          {c.items.map((slot) => (
            <PhotoSlotRow key={slot.itemId} projectId={projectId} slot={slot} />
          ))}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function PhotoSlotRow({ projectId, slot }: { projectId: string; slot: Slot }) {
  const router = useRouter();
  // Two inputs, not one. The single input this row used to have carried
  // `capture="environment"`, which on a phone means the camera and ONLY the
  // camera — a crew member who already shot the panel in their camera roll had
  // no way to hand it over. Separating them keeps the camera one tap away
  // (which is what happens on site) without closing the other door.
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [showExample, setShowExample] = React.useState(false);
  const has = slot.photos.length > 0;
  const missingRequired = slot.required && !has;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setShowExample(false);
    setBusy(true);
    let failed = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("projectId", projectId);
      fd.set("photoTemplateItemId", slot.itemId);
      fd.set("category", slot.label);
      const res = await uploadFileAction(fd);
      if (!res.ok) failed += 1;
    }
    setBusy(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
    if (failed) toast.error(`${failed} photo(s) failed to upload.`);
    else toast.success("Photo added");
    router.refresh();
  }

  async function remove(id: string) {
    const res = await deleteFileAction(id);
    if (!res.ok) {
      toast.error(res.error ?? "Delete failed");
      return;
    }
    router.refresh();
  }

  return (
    <div
      data-testid="photo-slot"
      className={cn(
        "rounded-xl border p-3",
        missingRequired ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-xs",
            has ? "bg-green-500 text-white" : "border border-border text-muted-foreground"
          )}
        >
          {has ? <Check className="size-4" /> : missingRequired ? <AlertCircle className="size-4 text-destructive" /> : ""}
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{slot.label}</span>
          {slot.required && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Required
            </span>
          )}
          {has && <span className="ml-2 text-xs text-muted-foreground">{slot.photos.length} photo(s)</span>}
        </div>

        {/* The reference shot, when the office set one. Thumbnail AND the word
            "Example" on purpose: the thumbnail is what makes it obvious at a
            glance, the word is what makes it obvious it can be tapped. */}
        {slot.exampleUrl && (
          <button
            type="button"
            onClick={() => setShowExample(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border py-1 pl-1 pr-2.5 text-xs font-medium transition-colors hover:bg-muted"
            title={`See an example of “${slot.label}”`}
            // The visible word is "Example" on every row; the accessible name
            // has to say which slot's example it is.
            aria-label={`See an example of ${slot.label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.exampleUrl}
              alt=""
              className="size-6 rounded object-cover"
              loading="lazy"
              decoding="async"
            />
            Example
          </button>
        )}

        <button
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          title="Take the photo now"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          Add
        </button>
        {/* Named with aria-label rather than an sr-only span: a hidden text
            node repeating the slot's name makes the name itself ambiguous to
            anything matching on text, tests included. */}
        <button
          onClick={() => uploadRef.current?.click()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          title="Choose a photo you already have"
          aria-label={`Upload a photo you already have for ${slot.label}`}
        >
          <Upload className="size-4" />
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {has && (
        <div className="mt-3 flex flex-wrap gap-2">
          {slot.photos.map((p) => (
            <div key={p.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/portal/files/${p.id}`}
                alt={slot.label}
                className="size-20 rounded-lg border border-border object-cover"
              />
              <button
                onClick={() => remove(p.id)}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove photo"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {slot.exampleUrl && (
        <Dialog open={showExample} onOpenChange={setShowExample}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="size-4 text-muted-foreground" />
                Example — {slot.label}
              </DialogTitle>
              <DialogDescription>
                Take yours the same way. This is a reference from the office; it is not part of this
                job&rsquo;s photos.
              </DialogDescription>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.exampleUrl}
              alt={`Example: ${slot.label}`}
              className="max-h-[60vh] w-full rounded-lg border border-border object-contain"
            />
            {/* Straight from looking at it to taking it — closing the dialog to
                find the button again is where good intentions go to die. */}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => uploadRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Upload className="size-4" /> Upload
              </button>
              <button
                onClick={() => cameraRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                Take this photo
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
