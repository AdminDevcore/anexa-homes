"use client";

import * as React from "react";
import { Loader2, AlertCircle } from "lucide-react";

// pdf.js is loaded LAZILY, on the client only. Importing it at module scope
// evaluates browser globals (e.g. DOMMatrix) that don't exist during SSR, which
// would crash any page that renders this component server-side.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((lib) => {
      // Serve the worker locally (copied to /public, version-matched via the
      // copy-pdf-worker script) so rendering never depends on a CDN.
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsPromise;
}

/** Renders a single page of a PDF (by URL) into a canvas that fills its parent's width. */
export function PdfCanvas({ url, page, className }: { url: string; page: number; className?: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise: Promise<unknown> } | null = null;
    setStatus("loading");

    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled || !ref.current) return;
        const p = await pdf.getPage(page);
        if (cancelled || !ref.current) return;
        const canvas = ref.current;
        const parentWidth = canvas.parentElement?.clientWidth || 612;
        const base = p.getViewport({ scale: 1 });
        const scale = parentWidth / base.width;
        const viewport = p.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        renderTask = p.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) setStatus("ready");
      } catch (err) {
        // Don't fail silently — log it and show a fallback so a blank box is never
        // mistaken for "nothing happened".
        if (!cancelled && !String((err as Error)?.message ?? "").toLowerCase().includes("cancel")) {
          console.error("PDF render failed:", err);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel?.();
      } catch {
        /* noop */
      }
    };
  }, [url, page]);

  return (
    <>
      <canvas ref={ref} className={className} />
      {status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          {status === "loading" ? (
            <>
              <Loader2 className="size-5 animate-spin" /> Loading PDF…
            </>
          ) : (
            <>
              <AlertCircle className="size-5 text-destructive" />
              <span>Couldn&rsquo;t render the PDF preview.</span>
              <a href={url} target="_blank" rel="noreferrer" className="text-gold-muted underline">
                Open the PDF
              </a>
            </>
          )}
        </div>
      )}
    </>
  );
}
