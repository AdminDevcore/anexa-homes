"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, Trash2, FileDown, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PHOTO_GROUPS, type PhotoGroup } from "@/lib/photo-groups";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";
import { ProjectPhotos } from "./project-photos";
import { PhotoAttachments, PhotoDownloadButton } from "./photo-attachments";
import type { PhotoChecklist } from "@/server/modules/photos/queries";

export type GroupPhoto = { id: string; name: string; group: PhotoGroup };

/**
 * The capture UI for one photo group — slot-by-slot checklist when the deal is
 * in production, bulk upload before that, plus Compile PDF.
 *
 * This used to live inside a modal opened by a pair of Survey / Install buttons
 * in the Documents & Files header. Those buttons are gone — the Survey Photos
 * and Install Photos folders are the entry point now, and this renders inline
 * when you open one. The capture behaviour is unchanged; only its host moved.
 */
export function PhotoGroupBody({
  group,
  leadId,
  projectId,
  photos,
  checklist,
  canUpload,
  canDelete,
  /** Inline in a folder there is no modal to fit inside, so drop the caps. */
  inline = false,
}: {
  group: PhotoGroup;
  leadId: string;
  projectId?: string | null;
  photos: GroupPhoto[];
  checklist: PhotoChecklist | null;
  canUpload: boolean;
  canDelete: boolean;
  inline?: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const def = PHOTO_GROUPS[group];
  // When the deal is in production we have a real templated checklist for this
  // group — show it (slots + per-slot add). Otherwise fall back to bulk upload.
  const useChecklist = !!projectId && !!checklist;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let failed = 0;
    // Upload all selected photos together, tagging each with this group.
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("leadId", leadId);
      if (projectId) fd.set("projectId", projectId);
      fd.set("category", group);
      const res = await uploadFileAction(fd);
      if (!res.ok) failed += 1;
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (failed) toast.error(`${failed} photo(s) failed to upload.`);
    else toast.success(`${files.length} ${def.label.toLowerCase()} added`);
    router.refresh();
  }

  async function remove(id: string) {
    const res = await deleteFileAction(id);
    if (!res.ok) return toast.error(res.error ?? "Delete failed");
    router.refresh();
  }

  if (useChecklist) {
    // Real templated checklist (slots + per-slot Add) for this group.
    //
    // The folder holds every photo in the group; the checklist only knows the
    // ones shot against a slot. Anything left over was bulk-uploaded before
    // this deal reached production — hand it down so the attachment list can
    // still offer it, otherwise those photos are unreachable from here.
    const slotted = new Set(checklist!.items.flatMap((i) => i.photos.map((p) => p.id)));
    return (
      <div className={inline ? "" : "max-h-[72vh] overflow-y-auto pr-1"}>
        <ProjectPhotos
          projectId={projectId!}
          checklists={[checklist!]}
          extraFiles={photos.filter((p) => !slotted.has(p.id))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
            <ExampleStrip checklist={checklist} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {projectId
                  ? `${photos.length} photo${photos.length === 1 ? "" : "s"} in this set.`
                  : "Start production to use the full photo checklist. For now, add photos to this set."}
              </p>
              <div className="flex gap-2">
                {canUpload && (
                  <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                    Add photos
                  </Button>
                )}
                <a
                  href={`/portal/leads/${leadId}/photo-report?group=${group}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted ${
                    photos.length === 0 ? "pointer-events-none opacity-40" : ""
                  }`}
                >
                  <FileDown className="size-4" /> Compile PDF
                </a>
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />

            {photos.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No {def.label.toLowerCase()} yet. Tap “Add photos” to upload them all at once.
              </p>
            ) : (
              <div
                className={`grid grid-cols-3 gap-2 sm:grid-cols-4 ${
                  inline ? "" : "max-h-[55vh] overflow-y-auto"
                }`}
              >
                {photos.map((p) => (
                  <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                    <a href={`/portal/files/${p.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/portal/files/${p.id}`} alt={p.name} className="size-full object-cover" loading="lazy" decoding="async" />
                    </a>
                    <PhotoDownloadButton
                      id={p.id}
                      name={p.name}
                      className="absolute left-1 top-1 rounded-md bg-black/60 p-1 text-white"
                    />
                    {canDelete && (
                      <button
                        onClick={() => remove(p.id)}
                        className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Delete photo"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Same photos, listed as files you can take one at a time. */}
            <PhotoAttachments groups={[{ label: def.label, files: photos }]} />
    </div>
  );
}

/**
 * The office's reference shots, before this deal has a job to hang them off.
 *
 * The slot-by-slot checklist only exists once production starts, but a site
 * survey happens well before that — so until then this folder was a bare
 * "add photos" button and the examples were nowhere. They are read-only here:
 * there is no slot to file a photo into yet, so this shows what to capture and
 * the uploader below takes them all at once, exactly as it did.
 */
function ExampleStrip({ checklist }: { checklist: PhotoChecklist | null }) {
  const [open, setOpen] = React.useState<{ label: string; url: string } | null>(null);
  const examples = (checklist?.items ?? []).filter((i) => i.exampleUrl);
  if (examples.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ImageIcon className="size-3.5" /> What to capture — tap an example to see it full size
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {examples.map((i) => (
          <button
            key={i.itemId}
            type="button"
            onClick={() => setOpen({ label: i.label, url: i.exampleUrl! })}
            className="w-24 shrink-0 text-left"
            title={i.label}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={i.exampleUrl!}
              alt={`Example: ${i.label}`}
              className="size-24 rounded-lg border border-border object-cover transition-opacity hover:opacity-80"
              loading="lazy"
              decoding="async"
            />
            <span className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{i.label}</span>
          </button>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Example — {open?.label}</DialogTitle>
            <DialogDescription>
              Take yours the same way. This is a reference from the office; it is not part of this
              job&rsquo;s photos.
            </DialogDescription>
          </DialogHeader>
          {open && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={open.url}
              alt={`Example: ${open.label}`}
              className="max-h-[60vh] w-full rounded-lg border border-border object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
