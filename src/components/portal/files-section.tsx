"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Loader2, FileText, Trash2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";

export type FileItem = {
  id: string;
  name: string;
  kind: string;
  mimeType: string | null;
  uploadedBy?: string | null;
};

export function FilesSection({
  title = "Photos & Documents",
  files,
  projectId,
  leadId,
  canUpload,
  canDelete,
  headerActions,
}: {
  title?: string;
  files: FileItem[];
  projectId?: string;
  leadId?: string;
  canUpload: boolean;
  canDelete: boolean;
  headerActions?: React.ReactNode;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = React.useState(false);

  const photos = files.filter((f) => f.kind === "photo");
  const docs = files.filter((f) => f.kind !== "photo");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPending(true);
    const fd = new FormData();
    fd.append("file", file);
    if (projectId) fd.append("projectId", projectId);
    if (leadId) fd.append("leadId", leadId);
    const res = await uploadFileAction(fd);
    setPending(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res.ok) {
      toast.success("Uploaded");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this file?")) return;
    const res = await deleteFileAction(id);
    if (res.ok) {
      toast.success("Deleted");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold">
          <ImageIcon className="size-4 text-gold" /> {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {canUpload && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={onPick}
              />
              <Button size="sm" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Upload
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {files.length === 0 && (
          <p className="text-sm text-muted-foreground">No files yet.</p>
        )}

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((f) => (
              <div key={f.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                <a href={`/portal/files/${f.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/portal/files/${f.id}`} alt={f.name} className="size-full object-cover" />
                </a>
                {canDelete && (
                  <button
                    onClick={() => remove(f.id)}
                    className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {docs.length > 0 && (
          <ul className="divide-y divide-border">
            {docs.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2.5">
                <a href={`/portal/files/${f.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm hover:text-gold-muted">
                  <FileText className="size-4 text-muted-foreground" />
                  {f.name}
                </a>
                {canDelete && (
                  <button onClick={() => remove(f.id)} aria-label="Delete">
                    <Trash2 className="size-4 text-destructive" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
