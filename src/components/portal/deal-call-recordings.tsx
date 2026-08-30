"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Upload, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CALL_GROUPS, CALL_GROUP_KEYS, type CallGroup } from "@/lib/call-groups";
import { DOWNLOAD_BUTTON_CLASS, FileDownloadLink } from "./file-download";
import { uploadFileAction, deleteFileAction } from "@/server/modules/files/actions";

export type CallRecording = { id: string; name: string; group: CallGroup };

/**
 * Dedicated upload slot for the QC Call recording on a deal. One audio recording
 * per slot — re-uploading replaces it (handled server-side).
 *
 * Rendered inside the Call Recordings folder in Documents & Files. The folder
 * header already names it, so there is no heading here — the folder is the
 * heading.
 */
export function DealCallRecordings({
  leadId,
  recordings,
  canUpload,
  canDelete,
}: {
  leadId: string;
  recordings: CallRecording[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {CALL_GROUP_KEYS.map((g) => (
        <CallSlot
          key={g}
          group={g}
          leadId={leadId}
          recording={recordings.find((r) => r.group === g) ?? null}
          canUpload={canUpload}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}

function CallSlot({
  group,
  leadId,
  recording,
  canUpload,
  canDelete,
}: {
  group: CallGroup;
  leadId: string;
  recording: CallRecording | null;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const label = CALL_GROUPS[group].label;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("leadId", leadId);
    fd.set("category", group);
    const res = await uploadFileAction(fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res.ok) {
      toast.success(`${label} recording saved`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function remove() {
    if (!recording) return;
    if (!confirm(`Delete the ${label.toLowerCase()} recording?`)) return;
    const res = await deleteFileAction(recording.id);
    if (res.ok) {
      toast.success("Deleted");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Phone className="size-3.5 text-gold" /> {label}
        </span>
        {recording && canDelete && (
          <button onClick={remove} aria-label={`Delete ${label} recording`}>
            <Trash2 className="size-4 text-destructive" />
          </button>
        )}
      </div>

      {recording ? (
        <div className="space-y-2">
          <audio controls preload="none" src={`/portal/files/${recording.id}`} className="w-full" />
          <p className="truncate text-xs text-muted-foreground" title={recording.name}>
            {recording.name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* The player streams it; this saves it — a QC call that has to go
                to a lender or a carrier leaves as a file, not as a tab. */}
            <FileDownloadLink
              id={recording.id}
              name={recording.name}
              filename={recording.name}
              label="Download"
              className={DOWNLOAD_BUTTON_CLASS}
            />
            {canUpload && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Replace
              </Button>
            )}
          </div>
        </div>
      ) : canUpload ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Upload recording
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">No recording yet.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}
