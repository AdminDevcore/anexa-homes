"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, Trash2, FileDown, ClipboardList, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PHOTO_GROUPS, PHOTO_GROUP_KEYS, type PhotoGroup } from "@/lib/photo-groups";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";
import { ProjectPhotos } from "./project-photos";
import type { PhotoChecklist } from "@/server/modules/photos/queries";

export type GroupPhoto = { id: string; name: string; group: PhotoGroup };

// Survey maps to the "site" photo template; Install Photos to the "install" one.
const GROUP_KIND: Record<PhotoGroup, "site" | "install"> = { survey: "site", install: "install" };

const GROUP_ICON: Record<PhotoGroup, typeof Camera> = { survey: ClipboardList, install: Hammer };

/**
 * Two buttons — Survey & Install Photos — on the deal. Each opens a checklist
 * dialog where the user can drop all the photos for that group at once, then
 * compile that group into its own PDF (Survey and Roof/Install stay separate).
 */
export function DealPhotos({
  leadId,
  projectId,
  photos,
  checklists = [],
  canUpload,
  canDelete,
}: {
  leadId: string;
  projectId?: string | null;
  photos: GroupPhoto[];
  checklists?: PhotoChecklist[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = React.useState<PhotoGroup | null>(null);
  const counts = React.useMemo(() => {
    const c: Record<PhotoGroup, number> = { survey: 0, install: 0 };
    for (const p of photos) c[p.group] += 1;
    return c;
  }, [photos]);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {PHOTO_GROUP_KEYS.map((g) => {
          const Icon = GROUP_ICON[g];
          return (
            <Button key={g} size="sm" variant="outline" onClick={() => setOpen(g)}>
              <Icon className="size-4" /> {PHOTO_GROUPS[g].label}
              {counts[g] > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{counts[g]}</span>
              )}
            </Button>
          );
        })}
      </div>

      {PHOTO_GROUP_KEYS.map((g) => (
        <GroupDialog
          key={g}
          group={g}
          open={open === g}
          onClose={() => setOpen(null)}
          leadId={leadId}
          projectId={projectId}
          photos={photos.filter((p) => p.group === g)}
          checklist={checklists.find((c) => c.kind === GROUP_KIND[g]) ?? null}
          canUpload={canUpload}
          canDelete={canDelete}
        />
      ))}
    </>
  );
}

function GroupDialog({
  group,
  open,
  onClose,
  leadId,
  projectId,
  photos,
  checklist,
  canUpload,
  canDelete,
}: {
  group: PhotoGroup;
  open: boolean;
  onClose: () => void;
  leadId: string;
  projectId?: string | null;
  photos: GroupPhoto[];
  checklist: PhotoChecklist | null;
  canUpload: boolean;
  canDelete: boolean;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{def.label}</DialogTitle>
        </DialogHeader>

        {useChecklist ? (
          // Real templated checklist (slots + per-slot Add) for this group.
          <div className="max-h-[72vh] overflow-y-auto pr-1">
            <ProjectPhotos projectId={projectId!} checklists={[checklist!]} />
          </div>
        ) : (
          <>
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
              <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {photos.map((p) => (
                  <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                    <a href={`/portal/files/${p.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/portal/files/${p.id}`} alt={p.name} className="size-full object-cover" />
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
