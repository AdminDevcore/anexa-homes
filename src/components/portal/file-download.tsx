"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Take a file without opening it first.
 *
 * Every file row on a deal used to be a link that opened the document in a new
 * tab, which is the wrong verb half the time: a lender asking for the signed
 * contract, an adjuster asking for the scope, a manager collecting the permit
 * card — all of them want the PDF on disk, and "open it, then File → Save as,
 * then find where Chrome put it" is three steps for something that should be a
 * button.
 *
 * `?download=1` is what makes it a download rather than a view: the file route
 * answers with `Content-Disposition: attachment` and the file's real stored
 * name. That header is also why `filename` is only a hint here and may be left
 * off — the browser prefers the server's name over the anchor's, which is what
 * we want for a document whose display title (an e-sign package's, say) is not
 * its filename.
 *
 * No permission gate: this fetches the same URL the row already links to, and
 * the route authorises every read the same way whichever verb is asked for.
 * Anyone who can see the row can already open it — saving it is not a further
 * privilege.
 */
export function FileDownloadLink({
  id,
  name,
  filename,
  label,
  className,
  iconClassName,
}: {
  id: string;
  /** What this file is, for the accessible name — every button says "Download". */
  name: string;
  /** Filename hint for the browser. Omit to let the server name the file. */
  filename?: string;
  /** Visible text beside the icon. Omitted for the icon-only overlay on a photo. */
  label?: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <a
      href={`/portal/files/${id}?download=1`}
      download={filename}
      className={className}
      // The visible text is the same word on every row, so the accessible name
      // has to carry which file this one takes.
      aria-label={`Download ${name}`}
      title={`Download ${name}`}
    >
      <Download className={cn("size-3.5", iconClassName)} />
      {label}
    </a>
  );
}

/** The pill-shaped Download that sits at the end of a file row. */
export const DOWNLOAD_BUTTON_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted";

/** The small overlay Download on a photo thumbnail. */
export const DOWNLOAD_OVERLAY_CLASS =
  "absolute left-1 top-1 rounded-md bg-black/60 p-1 text-white transition-colors hover:bg-black/80";
