"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { DOWNLOAD_BUTTON_CLASS, FileDownloadLink } from "./file-download";

export type AttachmentFile = { id: string; name: string };
export type AttachmentGroup = { label: string; files: AttachmentFile[] };

/**
 * Every photo in a set, listed as individually downloadable attachments.
 *
 * The checklist above this is built for capture: it is a grid of thumbnails
 * organised by what still needs shooting. That is the wrong shape for the other
 * half of the job — pulling the photos back out one at a time to hand to a
 * lender, an adjuster or a manufacturer, each one named so the person on the
 * other end knows what they are looking at without opening it.
 *
 * So the same files render a second way here: one row per photo, under the
 * label of the slot it was shot for, with its own Download. The name is the
 * FileAsset's — `uploadFileAction` already stamps the slot's label on a
 * checklist photo, so "Roof from the back — showing the opposite roof plane.jpg"
 * is what lands in the downloads folder, not "IMG_4821.jpg".
 */
export function PhotoAttachments({ groups }: { groups: AttachmentGroup[] }) {
  const withFiles = groups.filter((g) => g.files.length > 0);
  const total = withFiles.reduce((n, g) => n + g.files.length, 0);
  if (total === 0) return null;

  return (
    <div data-testid="photo-attachments" className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip className="size-3.5 text-muted-foreground" />
          Attachments
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {total}
          </span>
        </p>
        <p className="text-[11px] leading-tight text-muted-foreground">
          Each photo downloads on its own, named for the slot it was taken in.
        </p>
      </div>

      <ul className="divide-y divide-border/70">
        {withFiles.map((group) =>
          group.files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 py-2">
              <a
                href={`/portal/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0"
                title="Open full size"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/portal/files/${file.id}`}
                  alt=""
                  className="size-10 rounded-md border border-border object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </a>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{file.name}</p>
                {/* The row's name is the filename, which usually repeats the
                    slot — but not for a bulk upload that predates the
                    checklist, and that is exactly when knowing the group
                    matters. */}
                <p className="truncate text-[11px] leading-tight text-muted-foreground">{group.label}</p>
              </div>
              <FileDownloadLink
                id={file.id}
                name={file.name}
                filename={file.name}
                label="Download"
                className={DOWNLOAD_BUTTON_CLASS}
              />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * The small Download on a photo thumbnail. Kept as its own name because the
 * checklist grids reach for it by that name; it is the shared control underneath.
 */
export function PhotoDownloadButton({ id, name, className }: { id: string; name: string; className?: string }) {
  return <FileDownloadLink id={id} name={name} filename={name} className={className} />;
}
