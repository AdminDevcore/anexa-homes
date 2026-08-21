"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, Trash2, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHOTO_GROUPS, type PhotoGroup } from "@/lib/photo-groups";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";
import { ProjectPhotos } from "./project-photos";
import type { PhotoChecklist } from "@/server/modules/photos/queries";

export type GroupPhoto = { id: string; name: string; group: PhotoGroup };

/**
 * Survey maps to the "site" photo template; Install Photos to the "install"
 * one. Solar's folder keys differ but mean the same two things, and the
 * template kinds are shared across verticals — what differs is which
 * (vertical-isolated) PhotoTemplate row the checklist query returns.
 */
export const GROUP_KIND: Record<PhotoGroup, "site" | "install"> = {
  survey: "site",
  install: "install",
  survey_photos: "site",
  install_photos: "install",
};

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
    return (
      <div className={inline ? "" : "max-h-[72vh] overflow-y-auto pr-1"}>
        <ProjectPhotos projectId={projectId!} checklists={[checklist!]} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
    </div>
  );
}
