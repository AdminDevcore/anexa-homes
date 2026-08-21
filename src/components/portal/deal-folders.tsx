"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileSignature, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FALLBACK_FOLDER_KEY,
  folderKeyFor,
  foldersFor,
  packagesByFolder,
  visibleFiles,
  type DealFolder,
} from "@/lib/deal-folders";
import type { PhotoGroup } from "@/lib/photo-groups";
import type { CallGroup } from "@/lib/call-groups";
import type { PhotoChecklist } from "@/server/modules/photos/queries";
import { uploadFileAction, deleteFileAction, moveFileAction } from "@/server/modules/files/actions";
import { GROUP_KIND, PhotoGroupBody, type GroupPhoto } from "./deal-photos";
import { DealCallRecordings, type CallRecording } from "./deal-call-recordings";

export type FolderFile = {
  id: string;
  name: string;
  kind: string;
  category: string | null;
};

/** An e-signature package on this deal — a DocumentPackage row, not an upload. */
export type FolderPackage = {
  id: string;
  title: string;
  status: string;
  /** Destination folder, copied from the template at send time. */
  folderKey: string | null;
  /**
   * The countersigned PDF, once the package completes. The e-sign flow stores
   * it as a FileAsset, so without this the same contract arrives twice: once as
   * the package row, once as a loose file. See `signedFileIds` below.
   */
  signedFileId: string | null;
};

/**
 * Documents & Files as a folder grid — the Pipe "Cloud storage" layout.
 *
 * Two states, never both: the grid of folders, or one open folder. Which
 * content an open folder shows depends on the folder itself, so the photo
 * checklists and the QC-call slot keep their purpose-built UI instead of being
 * flattened into a generic file list.
 */
export function DealFolders({
  leadId,
  projectId,
  vertical,
  files,
  packages = [],
  checklists = [],
  canUpload,
  canDelete,
}: {
  leadId: string;
  projectId?: string | null;
  vertical: string | null;
  files: FolderFile[];
  packages?: FolderPackage[];
  checklists?: PhotoChecklist[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const folders = foldersFor(vertical);
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  // A completed package's PDF is already on screen as the package row that
  // produced it, so it is not also listed as a loose file. See visibleFiles.
  const shown = React.useMemo(() => visibleFiles(files, packages), [files, packages]);

  // Every remaining file lands in exactly one folder; anything uncategorised or
  // carrying a key this vertical doesn't know falls into "Other" rather than
  // vanishing.
  const byFolder = React.useMemo(() => {
    const map = new Map<string, FolderFile[]>();
    for (const f of shown) {
      const key = folderKeyFor(vertical, f.category);
      const bucket = map.get(key);
      if (bucket) bucket.push(f);
      else map.set(key, [f]);
    }
    return map;
  }, [shown, vertical]);

  // Each package goes to the folder its template named; anything unconfigured
  // or unrecognised falls back to Contract, which is where every package lived
  // before routing existed.
  const pkgByFolder = React.useMemo(
    () => packagesByFolder(vertical, packages),
    [vertical, packages],
  );

  const open = openKey ? folders.find((f) => f.key === openKey) ?? null : null;

  if (open) {
    return (
      <div data-testid="deal-folders">
        <OpenFolder
          folder={open}
          files={byFolder.get(open.key) ?? []}
          packages={pkgByFolder.get(open.key) ?? []}
          folders={folders}
          leadId={leadId}
          projectId={projectId}
          checklists={checklists}
          canUpload={canUpload}
          canDelete={canDelete}
          onBack={() => setOpenKey(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="deal-folders">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((f) => {
          // A tile counts the packages routed to it as well as its files, so
          // the badge matches what you actually find when you open it.
          const count =
            (byFolder.get(f.key)?.length ?? 0) + (pkgByFolder.get(f.key)?.length ?? 0);
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setOpenKey(f.key)}
              title={f.label}
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/60"
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                <Icon className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                {/* The name wraps rather than truncating: these are legal
                    document titles, and "Conditional Waiver & Release (Final
                    Pa…" is not the same document as the one beside it. */}
                <div className="flex items-start gap-2">
                  <span className="text-sm font-medium">{f.label}</span>
                  <span className="mt-0.5 shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{f.hint}</p>
              </div>
            </button>
          );
        })}
      </div>

      {canUpload && <UploadToFolder leadId={leadId} projectId={projectId} folders={folders} />}
    </div>
  );
}

/** One open folder: a way back, what it holds, and how to add to it. */
function OpenFolder({
  folder,
  files,
  packages,
  folders,
  leadId,
  projectId,
  checklists,
  canUpload,
  canDelete,
  onBack,
}: {
  folder: DealFolder;
  files: FolderFile[];
  packages: FolderPackage[];
  folders: DealFolder[];
  leadId: string;
  projectId?: string | null;
  checklists: PhotoChecklist[];
  canUpload: boolean;
  canDelete: boolean;
  onBack: () => void;
}) {
  const Icon = folder.icon;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> All folders
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{folder.label}</span>
        </div>
        <p className="w-full text-[11px] leading-tight text-muted-foreground sm:w-auto sm:flex-1">
          {folder.hint}
        </p>
      </div>

      {folder.special === "photos" ? (
        <PhotoGroupBody
          inline
          group={folder.key as PhotoGroup}
          leadId={leadId}
          projectId={projectId}
          photos={files.map((f) => ({ id: f.id, name: f.name, group: folder.key as PhotoGroup }) satisfies GroupPhoto)}
          checklist={checklists.find((c) => c.kind === GROUP_KIND[folder.key as PhotoGroup]) ?? null}
          canUpload={canUpload}
          canDelete={canDelete}
        />
      ) : folder.special === "calls" ? (
        <DealCallRecordings
          leadId={leadId}
          recordings={files.map((f) => ({ id: f.id, name: f.name, group: folder.key as CallGroup }) satisfies CallRecording)}
          canUpload={canUpload}
          canDelete={canDelete}
        />
      ) : (
        <GenericFolder
          folderKey={folder.key}
          files={files}
          packages={packages}
          folders={folders}
          leadId={leadId}
          projectId={projectId}
          canUpload={canUpload}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}

/** The default folder body: photos as thumbnails, documents as rows. */
function GenericFolder({
  folderKey,
  files,
  packages,
  folders,
  leadId,
  projectId,
  canUpload,
  canDelete,
}: {
  folderKey: string;
  files: FolderFile[];
  packages: FolderPackage[];
  folders: DealFolder[];
  leadId: string;
  projectId?: string | null;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const photos = files.filter((f) => f.kind === "photo");
  const docs = files.filter((f) => f.kind !== "photo");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    setBusy(true);
    let failed = 0;
    for (const file of Array.from(picked)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("leadId", leadId);
      if (projectId) fd.set("projectId", projectId);
      fd.set("category", folderKey);
      const res = await uploadFileAction(fd);
      if (!res.ok) failed += 1;
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (failed) toast.error(`${failed} file(s) failed to upload.`);
    else toast.success(`${picked.length} file(s) uploaded`);
    router.refresh();
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
    <div className="space-y-4">
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={onPick}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Upload here
          </Button>
        </>
      )}

      {/* E-signature packages, above the uploads in the same folder. They link
          out to the signer rather than to a stored file, and carry a status
          instead of a delete — so they render as their own rows, not as part
          of the file list. */}
      {packages.length > 0 && (
        <ul className="space-y-2">
          {packages.map((d) => (
            <li key={d.id}>
              <Link
                href={`/portal/documents/${d.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:border-gold/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileSignature className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{d.title}</span>
                </span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">
                  {d.status.replace(/_/g, " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 && packages.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">This folder is empty.</p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((f) => (
            <div key={f.id} className="space-y-1">
              <div className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                <a href={`/portal/files/${f.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/portal/files/${f.id}`} alt={f.name} className="size-full object-cover" loading="lazy" decoding="async" />
                </a>
                {canDelete && (
                  <button
                    onClick={() => remove(f.id)}
                    className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Delete ${f.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {canDelete && (
                <MoveControl file={f} folders={folders} currentKey={folderKey} className="w-full" />
              )}
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <ul className="divide-y divide-border">
          {docs.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2.5">
              <a
                href={`/portal/files/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-2 text-sm hover:text-gold-muted"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </a>
              <div className="flex shrink-0 items-center gap-2">
                {canDelete && <MoveControl file={f} folders={folders} currentKey={folderKey} />}
                {canDelete && (
                  <button onClick={() => remove(f.id)} aria-label={`Delete ${f.name}`}>
                    <Trash2 className="size-4 text-destructive" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Refile one document. Every file uploaded before folders existed sits in
 * "Other", so this is the tool that empties it.
 *
 * Folders backed by a purpose-built UI (the photo checklists, the call slot)
 * are not offered as destinations: a PDF filed under `survey` would render as a
 * broken thumbnail in a photo grid.
 */
function MoveControl({
  file,
  folders,
  currentKey,
  className,
}: {
  file: FolderFile;
  folders: DealFolder[];
  currentKey: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const targets = folders.filter((f) => !f.special && f.key !== currentKey);

  async function move(e: React.ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value;
    if (!target) return;
    setBusy(true);
    const res = await moveFileAction(file.id, target);
    setBusy(false);
    e.target.value = "";
    if (res.ok) {
      toast.success("Moved");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <select
      aria-label={`Move ${file.name} to another folder`}
      defaultValue=""
      disabled={busy}
      onChange={move}
      className={cn(
        "rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground",
        className
      )}
    >
      <option value="">Move to…</option>
      {targets.map((f) => (
        <option key={f.key} value={f.key}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The header Upload path. A file has to land somewhere, so this asks which
 * folder rather than dropping it into an untyped pile — the whole point of the
 * grid. Defaults to Other, which is always a truthful answer.
 */
function UploadToFolder({
  leadId,
  projectId,
  folders,
}: {
  leadId: string;
  projectId?: string | null;
  folders: DealFolder[];
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState(FALLBACK_FOLDER_KEY);
  const [busy, setBusy] = React.useState(false);

  // Same rule as MoveControl: the checklist/call folders own their own uploader.
  const targets = folders.filter((f) => !f.special);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    setBusy(true);
    let failed = 0;
    for (const file of Array.from(picked)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("leadId", leadId);
      if (projectId) fd.set("projectId", projectId);
      fd.set("category", target);
      const res = await uploadFileAction(fd);
      if (!res.ok) failed += 1;
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (failed) {
      toast.error(`${failed} file(s) failed to upload.`);
    } else {
      toast.success(`${picked.length} file(s) uploaded`);
      setOpen(false);
    }
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" /> Upload a file
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload a file</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Folder
              </span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {targets.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={onPick}
            />
            <Button disabled={busy} onClick={() => inputRef.current?.click()} className="w-full">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Choose file
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
