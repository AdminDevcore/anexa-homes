/** True when a stored file's MIME type is a PDF. Tolerates casing and `; charset=…` suffixes. */
export function isPdfMime(mime: string | null | undefined): boolean {
  return (mime ?? "").trim().toLowerCase().startsWith("application/pdf");
}
